// ============================================================================
// lib/assSubtitles.ts — deterministic ASS (Advanced SubStation Alpha) generator
// for the libass burn-in pass. PURE module (no React, no ffmpeg).
//
// Consumes OUTPUT-timeline cues (lib/captionTiming.buildCaptionCues) + the
// CaptionStyle + the shared preset spec table (lib/captionLayout.CAPTION_PRESETS)
// so the burned captions match the studio preview. PlayRes matches the export
// frame so sizes/positions map 1:1.
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
import { CAPTION_PRESETS, applyCase, wordsPerLine, wrapWords } from './captionLayout';
import type { Dims } from './ffmpegFilters';

// Base caption height fraction at 100% — matches CaptionOverlay's baseFraction.
const BASE_FRACTION = 0.055;
// Safe horizontal margin (fraction of width) so text never hits the frame edge.
const SAFE_X = 0.06;
// Vertical margin (fraction of height) for top/bottom anchored captions.
const SAFE_V = 0.08;

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

/** Numpad alignment: [center|left] x [top|center|bottom]. */
function alignment(align: 'center' | 'left', pos: CaptionStyle['position']): number {
  const col = align === 'left' ? 0 : 1; // left -> 1/4/7, center -> 2/5/8
  if (pos === 'top') return 7 + col;
  if (pos === 'center' || pos === 'custom') return 4 + col;
  return 1 + col; // bottom
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
  const { w, h } = dims;

  const fontSize = Math.max(10, Math.round(h * BASE_FRACTION * (style.sizePct / 100)));
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
  const borderStyle = boxed ? 3 : 1;
  const outlineColour = boxed ? bgCol : outlineCol;
  const outlineW = boxed
    ? Math.max(2, Math.round(fontSize * 0.2 * (preset.paddingScale || 1)))
    : preset.usesOutline
      ? Math.max(1, Math.round(fontSize * 0.06))
      : 0;
  const shadow = boxed ? 0 : preset.usesOutline ? Math.max(0, Math.round(fontSize * 0.03)) : 0;
  const backColour = boxed ? bgCol : '&H64000000'; // soft shadow otherwise

  const bold = (preset.fontWeight || 700) >= 700 ? -1 : 0;
  const spacing = Math.round((preset.letterSpacingEm || 0) * fontSize);
  const align = alignment(preset.align, style.position);
  const marginL = Math.round(w * SAFE_X);
  const marginR = Math.round(w * SAFE_X);
  const marginV =
    style.position === 'center' || style.position === 'custom' ? 0 : Math.round(h * SAFE_V);

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
  // Position override for custom vertical placement.
  const customY = style.position === 'custom' ? Math.round((clampPct(style.customYPct) / 100) * h) : null;
  const posX = preset.align === 'left' ? marginL : Math.round(w / 2);
  const posOverride = customY != null ? `\\pos(${posX},${customY})` : '';

  const events: string[] = [];

  for (const cue of cues) {
    if (!cue.words.length) continue;

    if (style.preset === 'wordPop') {
      // One word at a time.
      for (let i = 0; i < cue.words.length; i++) {
        const wd = cue.words[i];
        const next = cue.words[i + 1];
        const end = next ? next.start : cue.end;
        if (end <= wd.start) continue;
        const lead = `{${posOverride}${fadeMs ? `\\fad(${fadeMs},0)` : ''}}`;
        const text = escapeText(applyCase(wd.text, effectiveCase));
        events.push(dialogue(wd.start, end, `${lead}${text}`));
      }
      continue;
    }

    const lead = `{${posOverride}${fadeMs ? `\\fad(${fadeMs},0)` : ''}}`;

    if (highlight) {
      // Karaoke \k fill; each word's highlight fills the gap to the next word.
      const lineGroups = wrapWords(
        cue.words.map((wd, i) => ({ wd, i })),
        wordsPerLine(style.sizePct),
      );
      const lineStrs = lineGroups.map((line) =>
        line
          .map(({ wd, i }) => {
            const next = cue.words[i + 1];
            const hEnd = next ? next.start : cue.end;
            const k = Math.max(1, Math.round((hEnd - wd.start) * 100));
            return `{\\k${k}}${escapeText(applyCase(wd.text, effectiveCase))}`;
          })
          .join(' '),
      );
      events.push(dialogue(cue.start, cue.end, `${lead}${lineStrs.join('\\N')}`));
      continue;
    }

    // Static text with word-group line wrapping.
    const lines = wrapWords(cue.words, wordsPerLine(style.sizePct)).map((line) =>
      line.map((wd) => escapeText(applyCase(wd.text, effectiveCase))).join(' '),
    );
    events.push(dialogue(cue.start, cue.end, `${lead}${lines.join('\\N')}`));
  }

  return `${header}\n${events.join('\n')}\n`;
}

function dialogue(start: number, end: number, text: string): string {
  return `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${text}`;
}

function clampPct(v: number): number {
  return Math.min(96, Math.max(4, Number.isFinite(v) ? v : 85));
}
