// ============================================================================
// lib/assSubtitles.ts — deterministic ASS (Advanced SubStation Alpha) generator
// for the libass burn-in pass. PURE module (no React, no ffmpeg).
//
// Consumes OUTPUT-timeline cues (lib/captionTiming.buildCaptionCues) + the
// CaptionStyle + the shared preset spec table (lib/captionLayout.CAPTION_PRESETS)
// so the burned captions match the studio preview. PlayRes matches the export
// frame so sizes/positions map 1:1.
//
// PARITY WITH THE PREVIEW (measured, not assumed — see README "Preview accuracy"):
//   - POSITION: every Dialogue carries \pos() with a MIDDLE alignment (4/5), so
//     the block's centre lands on captionAnchorPct(style) — byte-for-byte the
//     same anchor the overlay uses. No edge-to-margin anchoring anywhere.
//   - SIZE: ASS Fontsize = cssEmPx * CAPTION_FONTS[font].assLineEm, because
//     libass fills Fontsize with OS/2 window metrics rather than the em square.
//   - Every other length (outline, shadow, letter spacing, box padding) is
//     derived from the CSS em in frame pixels, from constants shared with the
//     overlay via lib/captionLayout.
//
// Per-preset-family approach (documented in the P5 handover):
//   - box none/bar     -> BorderStyle 1 (outline + soft shadow)
//   - box block/banner/lowerThird/perWord -> BorderStyle 3 (opaque box drawn in
//     the background colour, hugging the text)
//   - activeWordHighlight presets -> karaoke \k fill (Primary=accent turns on as
//     each word is spoken; Secondary=base text colour)
//   - wordPop -> one Dialogue per word (single word on screen, accent colour)
//   - everyone else -> static text in the text colour
//   - entrance -> \fad(inMs,0) from the preset animation
// ============================================================================

import type { CaptionStyle } from '../types';
import type { CaptionCue } from './captionTiming';
import {
  CAPTION_BASE_FRACTION,
  CAPTION_FONTS,
  CAPTION_LEFT_INSET,
  CAPTION_OUTLINE_EM,
  CAPTION_PRESETS,
  CAPTION_SAFE_X,
  CAPTION_SHADOW_EM,
  applyCase,
  captionAnchorPct,
  captionBoxHeightEm,
} from './captionLayout';
import type { Dims } from './ffmpegFilters';

interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number; // 0..1 (1 = opaque)
}

function parseColor(css: string): RGBA {
  const s = (css || '').trim();
  const rgba = s.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(',').map((p) => p.trim());
    return {
      r: clampByte(parseFloat(parts[0])),
      g: clampByte(parseFloat(parts[1])),
      b: clampByte(parseFloat(parts[2])),
      a: parts[3] != null ? clamp01(parseFloat(parts[3])) : 1,
    };
  }
  let hex = s.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length === 6 || hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    if ([r, g, b].every((n) => Number.isFinite(n))) return { r, g, b, a };
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}

/** ASS colour tag &HAABBGGRR (alpha inverted: 00 opaque .. FF transparent). */
function assColor(css: string): string {
  const c = parseColor(css);
  const aa = toHex(255 - Math.round(c.a * 255));
  return `&H${aa}${toHex(c.b)}${toHex(c.g)}${toHex(c.r)}`;
}

function toHex(n: number): string {
  const v = Math.min(255, Math.max(0, Math.round(n)));
  return v.toString(16).toUpperCase().padStart(2, '0');
}

function clampByte(n: number): number {
  return Math.min(255, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));
}
function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 1));
}

/** ASS timestamp H:MM:SS.cc (centiseconds). */
export function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(c)}`;
}
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Escape text for an ASS Dialogue field (neutralise override-block braces). */
function escapeText(s: string): string {
  return s.replace(/\\/g, '∖').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\r?\n/g, ' ');
}

function fadeInMs(animation: string): number {
  switch (animation) {
    case 'bannerIn':
      return 120;
    case 'pop':
      return 90;
    case 'bounce':
      return 130;
    case 'slideUp':
      return 150;
    case 'fade':
      return 160;
    default:
      return 0;
  }
}

/**
 * Alignment is ALWAYS the middle row (4 = middle-left, 5 = middle-centre) and
 * every Dialogue carries an explicit `\pos()`. That is what makes the export
 * match the preview: the preview centres the caption block on
 * captionAnchorPct(style), so the export has to anchor the same point rather
 * than pinning a top/bottom EDGE to a margin (which is what alignments 1/2 and
 * 7/8 do — and why bottom captions used to burn 5-9% of the frame height lower
 * than the preview showed, worsening as the caption got bigger).
 */
function alignment(align: 'center' | 'left'): number {
  return align === 'left' ? 4 : 5;
}

/**
 * Build the full ASS file for a set of OUTPUT-time cues.
 * @param cues   caption cues already mapped to output time (buildCaptionCues)
 * @param style  the caption style
 * @param dims   export frame dims (PlayResX/Y)
 * @param assFamily libass family name of the bundled font (from fontAssetFor)
 */
export function buildAss(cues: CaptionCue[], style: CaptionStyle, dims: Dims, assFamily: string): string {
  const preset = CAPTION_PRESETS[style.preset] ?? CAPTION_PRESETS.clean;
  const fontSpec = CAPTION_FONTS[style.font] ?? CAPTION_FONTS.modern;
  const { w, h } = dims;

  // `emPx` is the caption's CSS em in FRAME pixels — the exact number the
  // preview overlay uses (frameHeight * CAPTION_BASE_FRACTION * sizePct/100).
  // Everything measured in pixels below (outline, shadow, letter spacing, box
  // padding) is expressed against emPx, because ASS lengths are script pixels
  // and PlayRes == the frame.
  const emPx = Math.max(8, h * CAPTION_BASE_FRACTION * (style.sizePct / 100));
  // ...but ASS `Fontsize` is NOT the em: libass fills Fontsize with the face's
  // OS/2 window metrics, so it must be scaled up by the face's assLineEm or the
  // burned text comes out 24-43% smaller than the preview (see captionLayout).
  const fontSize = Math.max(10, Math.round(emPx * fontSpec.assLineEm));
  const effectiveCase: CaptionStyle['case'] =
    style.case === 'original' && preset.uppercaseDefault ? 'upper' : style.case;

  const boxed =
    preset.box === 'block' ||
    preset.box === 'banner' ||
    preset.box === 'lowerThird' ||
    preset.box === 'perWord';

  const textCol = assColor(style.colors.text);
  const accentCol = assColor(style.colors.accent);
  const outlineCol = assColor(style.colors.outline);
  const bgCol = assColor(style.colors.background);

  // Karaoke fill: unsung words show Secondary (base text), turn Primary (accent).
  const highlight = preset.activeWordHighlight && style.preset !== 'wordPop';
  const primary = highlight ? accentCol : textCol;
  const secondary = highlight ? textCol : textCol;

  // Box presets draw the background via the Outline colour with BorderStyle 3.
  // libass lays a BorderStyle-3 box out as (line box) + 2 x Outline, and its line
  // box is exactly `assLineEm` em tall. The preview's box is
  // CAPTION_LINE_HEIGHT + 2 x padding em tall. Solving the two for equal height
  // gives the Outline below; when libass' own line box is already taller than the
  // preview box (faces with generous window metrics, e.g. Poppins) the best
  // available match is no padding at all, hence the clamp at 0.
  const boxPadEm = Math.max(
    0,
    (captionBoxHeightEm(preset.paddingScale) - fontSpec.assLineEm) / 2,
  );
  const borderStyle = boxed ? 3 : 1;
  const outlineColour = boxed ? bgCol : outlineCol;
  const outlineW = boxed
    ? Math.round(emPx * boxPadEm)
    : preset.usesOutline
      ? Math.max(1, Math.round(emPx * CAPTION_OUTLINE_EM))
      : 0;
  const shadow = boxed
    ? 0
    : preset.usesOutline
      ? Math.max(0, Math.round(emPx * CAPTION_SHADOW_EM))
      : 0;
  const backColour = boxed ? bgCol : '&H64000000'; // soft shadow otherwise

  const bold = (preset.fontWeight || 700) >= 700 ? -1 : 0;
  const spacing = Math.round((preset.letterSpacingEm || 0) * emPx);
  const align = alignment(preset.align);
  // With an explicit \pos on every Dialogue these margins no longer move the
  // caption; they only bound line wrapping, which WrapStyle 2 already disables.
  // They are kept so a future multi-line mode still wraps inside the safe area.
  const marginL = Math.round(w * CAPTION_SAFE_X);
  const marginR = Math.round(w * CAPTION_SAFE_X);
  const marginV = 0;

  const styleLine = [
    'Style: Default',
    assFamily,
    String(fontSize),
    primary,
    secondary,
    outlineColour,
    backColour,
    String(bold),
    '0', // Italic
    '0', // Underline
    '0', // StrikeOut
    '100', // ScaleX
    '100', // ScaleY
    String(spacing),
    '0', // Angle
    String(borderStyle),
    String(outlineW),
    String(shadow),
    String(align),
    String(marginL),
    String(marginR),
    String(marginV),
    '1', // Encoding
  ].join(',');

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    styleLine,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  const fadeMs = fadeInMs(preset.animation);
  // ONE anchor rule for every position mode, identical to the preview overlay:
  // the caption block's CENTRE lands on captionAnchorPct(style) of frame height.
  // Alignment 4/5 makes \pos address the block's middle-left / middle-centre.
  const posY = Math.round((captionAnchorPct(style) / 100) * h);
  // A left-aligned block's LEFT EDGE sits on CAPTION_LEFT_INSET, same as the
  // preview's `left:6%`. For a BorderStyle-3 box libass draws the box `Outline`
  // px outside the text, so the text anchor shifts right by that much to put the
  // BOX edge (which is what the eye sees) on the inset.
  const posX =
    preset.align === 'left'
      ? Math.round(w * CAPTION_LEFT_INSET) + (boxed ? outlineW : 0)
      : Math.round(w / 2);
  const posOverride = `\\pos(${posX},${posY})`;

  const events: string[] = [];

  /**
   * Per-cue shrink (lib/captionTiming CaptionCue.scale) — the same factor the
   * preview overlay applies, expressed as libass \fscx/\fscy so a single
   * over-wide word stays inside the frame in the burned-in export too.
   */
  const scaleOverride = (cue: CaptionCue): string => {
    const s = Number.isFinite(cue.scale) && cue.scale > 0 ? cue.scale : 1;
    if (s >= 0.999) return '';
    const pct = Math.max(1, Math.round(s * 100));
    return `\\fscx${pct}\\fscy${pct}`;
  };

  for (const cue of cues) {
    if (!cue.words.length) continue;
    const fsc = scaleOverride(cue);

    if (style.preset === 'wordPop') {
      // One word at a time.
      for (let i = 0; i < cue.words.length; i++) {
        const wd = cue.words[i];
        const next = cue.words[i + 1];
        const end = next ? next.start : cue.end;
        if (end <= wd.start) continue;
        const lead = `{${posOverride}${fsc}${fadeMs ? `\\fad(${fadeMs},0)` : ''}}`;
        const text = escapeText(applyCase(wd.text, effectiveCase));
        events.push(dialogue(wd.start, end, `${lead}${text}`));
      }
      continue;
    }

    const lead = `{${posOverride}${fsc}${fadeMs ? `\\fad(${fadeMs},0)` : ''}}`;

    if (highlight) {
      // Karaoke \k fill on a SINGLE line (no \N); each word's highlight fills the
      // gap to the next word. The cue word count already fits the frame width.
      const line = cue.words
        .map((wd, i) => {
          const next = cue.words[i + 1];
          const hEnd = next ? next.start : cue.end;
          const k = Math.max(1, Math.round((hEnd - wd.start) * 100));
          return `{\\k${k}}${escapeText(applyCase(wd.text, effectiveCase))}`;
        })
        .join(' ');
      events.push(dialogue(cue.start, cue.end, `${lead}${line}`));
      continue;
    }

    // Static text on a SINGLE line (no \N) — one meaningful word group per cue.
    const line = cue.words
      .map((wd) => escapeText(applyCase(wd.text, effectiveCase)))
      .join(' ');
    events.push(dialogue(cue.start, cue.end, `${lead}${line}`));
  }

  return `${header}\n${events.join('\n')}\n`;
}

function dialogue(start: number, end: number, text: string): string {
  return `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${text}`;
}
