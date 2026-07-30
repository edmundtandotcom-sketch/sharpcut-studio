// ============================================================================
// lib/captionLayout.ts — SINGLE SOURCE OF TRUTH for caption creative styling.
//
// This file owns:
//   - CAPTION_PRESETS: the data-driven preset spec table (12 presets). Preview
//     (P4) AND the FFmpeg/ASS export generator (P5) BOTH read this table so the
//     rendered preview matches the burned-in export. Do not fork these values.
//   - CAPTION_FONTS: CaptionFontId -> real @fontsource family stack + label.
//   - case transform (upper / lower / title / original)
//   - line wrapping by word groups + words-per-line reduction at larger sizes
//   - getCaptionRenderSpec(): resolves a CaptionStyle into concrete render
//     values (the thing the overlay consumes).
//   - getCaptionCss(): block-level CSSProperties convenience wrapper (P5 can
//     read the same numbers to build matching ASS styles).
//
// Pure module — NO React imports.
// ============================================================================

import type {
  CaptionCase,
  CaptionFontId,
  CaptionPresetId,
  CaptionStyle,
} from '../types';

// ---------------------------------------------------------------------------
// Fonts — map the 12 CaptionFontId values onto the @fontsource families P1
// installed (plus Inter for the "modern/clean" variants).
// ---------------------------------------------------------------------------

export interface CaptionFontSpec {
  id: CaptionFontId;
  label: string;
  /** CSS font-family stack (families are self-hosted via @fontsource). */
  stack: string;
  /** Default weight this face reads best at. */
  weight: number;
  /** ASS-side family name hint for P5 (the .ttf face name to load). */
  assFamily: string;
}

export const CAPTION_FONTS: Record<CaptionFontId, CaptionFontSpec> = {
  modern: { id: 'modern', label: 'Modern', stack: 'Inter, sans-serif', weight: 800, assFamily: 'Inter' },
  classic: {
    id: 'classic',
    label: 'Classic',
    stack: '"Playfair Display", Georgia, serif',
    weight: 700,
    assFamily: 'Playfair Display SemiBold',
  },
  impact: {
    id: 'impact',
    label: 'Impact',
    stack: '"Archivo Black", Impact, sans-serif',
    weight: 900,
    assFamily: 'Archivo Black',
  },
  editorial: {
    id: 'editorial',
    label: 'Editorial',
    stack: '"Playfair Display", Georgia, serif',
    weight: 600,
    assFamily: 'Playfair Display SemiBold',
  },
  creatorRounded: {
    id: 'creatorRounded',
    label: 'Creator Rounded',
    stack: 'Nunito, "Segoe UI", sans-serif',
    weight: 800,
    assFamily: 'Nunito ExtraBold',
  },
  reelsCondensed: {
    id: 'reelsCondensed',
    label: 'Reels Condensed',
    stack: '"Barlow Condensed", "Arial Narrow", sans-serif',
    weight: 700,
    assFamily: 'Barlow Condensed SemiBold',
  },
  heavyBlack: {
    id: 'heavyBlack',
    label: 'Heavy Black',
    stack: '"Archivo Black", Impact, sans-serif',
    weight: 900,
    assFamily: 'Archivo Black',
  },
  typewriter: {
    id: 'typewriter',
    label: 'Typewriter',
    stack: '"Courier Prime", "Courier New", monospace',
    weight: 700,
    assFamily: 'Courier Prime',
  },
  montserrat: {
    id: 'montserrat',
    label: 'Montserrat Bold',
    stack: 'Montserrat, sans-serif',
    weight: 700,
    assFamily: 'Montserrat',
  },
  bebas: {
    id: 'bebas',
    label: 'Bebas Condensed',
    stack: '"Bebas Neue", sans-serif',
    weight: 400,
    assFamily: 'Bebas Neue',
  },
  poppins: {
    id: 'poppins',
    label: 'Poppins Clean',
    stack: 'Poppins, sans-serif',
    weight: 700,
    assFamily: 'Poppins SemiBold',
  },
  oswald: {
    id: 'oswald',
    label: 'Oswald Creator',
    stack: 'Oswald, sans-serif',
    weight: 700,
    assFamily: 'Oswald SemiBold',
  },
};

export const CAPTION_FONT_ORDER: CaptionFontId[] = [
  'modern',
  'montserrat',
  'poppins',
  'oswald',
  'bebas',
  'reelsCondensed',
  'impact',
  'heavyBlack',
  'creatorRounded',
  'classic',
  'editorial',
  'typewriter',
];

// ---------------------------------------------------------------------------
// Preset spec table — the shared contract between preview and export.
// ---------------------------------------------------------------------------

/** How the caption background/box is drawn. */
export type CaptionBoxMode =
  | 'none' // text only (relies on outline for legibility)
  | 'block' // one rounded box hugging the whole cue
  | 'perWord' // a box behind each word
  | 'banner' // full-width coloured banner strip
  | 'bar' // highlight bar behind the active word only
  | 'lowerThird'; // left-anchored lower-third panel

/** Entrance / emphasis animation kind. */
export type CaptionAnimationKind =
  | 'none'
  | 'fade'
  | 'pop'
  | 'bounce'
  | 'slideUp'
  | 'wordByWord' // reveal one word at a time
  | 'bannerIn'; // banner slides/wipes in

export interface CaptionPresetSpec {
  id: CaptionPresetId;
  label: string;
  description: string;
  defaultFont: CaptionFontId;
  fontWeight: number;
  uppercaseDefault: boolean;
  letterSpacingEm: number;
  box: CaptionBoxMode;
  animation: CaptionAnimationKind;
  /** Highlight the currently-spoken word (karaoke behaviour). */
  activeWordHighlight: boolean;
  /** Colour roles this preset actually paints (drives which colour pickers matter). */
  usesBackground: boolean;
  usesOutline: boolean;
  usesAccent: boolean;
  /** Left accent edge (Brand Banner signature). */
  accentEdge: boolean;
  /** Text alignment inside the block. */
  align: 'center' | 'left';
  /** Relative padding multiplier (1 = normal). */
  paddingScale: number;
  borderRadiusPx: number;
  /** Preset-default colours applied on selection / reset-to-default. */
  defaultColors: { text: string; background: string; outline: string; accent: string };
}

/**
 * The 12 presets. Each is intentionally, visibly distinct (SPEC "Do not create
 * cosmetic cards that all map to the same output style").
 */
export const CAPTION_PRESETS: Record<CaptionPresetId, CaptionPresetSpec> = {
  none: {
    id: 'none',
    label: 'No captions',
    description: 'No captions burned into the video.',
    defaultFont: 'modern',
    fontWeight: 700,
    uppercaseDefault: false,
    letterSpacingEm: 0,
    box: 'none',
    animation: 'none',
    activeWordHighlight: false,
    usesBackground: false,
    usesOutline: false,
    usesAccent: false,
    accentEdge: false,
    align: 'center',
    paddingScale: 0,
    borderRadiusPx: 0,
    defaultColors: { text: '#FFFFFF', background: '#000000', outline: '#000000', accent: '#FFE800' },
  },
  clean: {
    id: 'clean',
    label: 'Clean',
    description: 'Simple white text on a soft dark pill. Understated and legible.',
    defaultFont: 'modern',
    fontWeight: 700,
    uppercaseDefault: false,
    letterSpacingEm: 0,
    box: 'block',
    animation: 'fade',
    activeWordHighlight: false,
    usesBackground: true,
    usesOutline: false,
    usesAccent: false,
    accentEdge: false,
    align: 'center',
    paddingScale: 1,
    borderRadiusPx: 10,
    defaultColors: { text: '#FFFFFF', background: 'rgba(23,32,51,0.82)', outline: '#000000', accent: '#FFE800' },
  },
  impactPop: {
    id: 'impactPop',
    label: 'Impact Pop',
    description: 'Heavy uppercase with a thick outline that pops on entry. No box.',
    defaultFont: 'impact',
    fontWeight: 900,
    uppercaseDefault: true,
    letterSpacingEm: 0.01,
    box: 'none',
    animation: 'pop',
    activeWordHighlight: false,
    usesBackground: false,
    usesOutline: true,
    usesAccent: false,
    accentEdge: false,
    align: 'center',
    paddingScale: 0.5,
    borderRadiusPx: 0,
    defaultColors: { text: '#FFFFFF', background: '#000000', outline: '#0B1020', accent: '#FFE800' },
  },
  karaoke: {
    id: 'karaoke',
    label: 'Karaoke',
    description: 'Words light up in the accent colour as they are spoken.',
    defaultFont: 'montserrat',
    fontWeight: 700,
    uppercaseDefault: false,
    letterSpacingEm: 0,
    box: 'none',
    animation: 'fade',
    activeWordHighlight: true,
    usesBackground: false,
    usesOutline: true,
    usesAccent: true,
    accentEdge: false,
    align: 'center',
    paddingScale: 0.5,
    borderRadiusPx: 0,
    defaultColors: { text: '#FFFFFF', background: '#000000', outline: '#0B1020', accent: '#FFE800' },
  },
  bounceBox: {
    id: 'bounceBox',
    label: 'Bounce Box',
    description: 'Rounded solid box that bounces in. Friendly, playful.',
    defaultFont: 'poppins',
    fontWeight: 700,
    uppercaseDefault: false,
    letterSpacingEm: 0,
    box: 'block',
    animation: 'bounce',
    activeWordHighlight: false,
    usesBackground: true,
    usesOutline: false,
    usesAccent: false,
    accentEdge: false,
    align: 'center',
    paddingScale: 1.2,
    borderRadiusPx: 18,
    defaultColors: { text: '#172033', background: '#FFE800', outline: '#000000', accent: '#355CFF' },
  },
  creatorOutline: {
    id: 'creatorOutline',
    label: 'Creator Outline',
    description: 'Rounded font with a bold outline and no box — reads on any footage.',
    defaultFont: 'creatorRounded',
    fontWeight: 800,
    uppercaseDefault: false,
    letterSpacingEm: 0,
    box: 'none',
    animation: 'pop',
    activeWordHighlight: false,
    usesBackground: false,
    usesOutline: true,
    usesAccent: false,
    accentEdge: false,
    align: 'center',
    paddingScale: 0.5,
    borderRadiusPx: 0,
    defaultColors: { text: '#FFFFFF', background: '#000000', outline: '#111827', accent: '#16A36A' },
  },
  highlightBar: {
    id: 'highlightBar',
    label: 'Highlight Bar',
    description: 'An accent bar sweeps behind the currently-spoken word.',
    defaultFont: 'oswald',
    fontWeight: 700,
    uppercaseDefault: true,
    letterSpacingEm: 0.02,
    box: 'bar',
    animation: 'fade',
    activeWordHighlight: true,
    usesBackground: false,
    usesOutline: true,
    usesAccent: true,
    accentEdge: false,
    align: 'center',
    paddingScale: 0.6,
    borderRadiusPx: 4,
    defaultColors: { text: '#FFFFFF', background: '#000000', outline: '#0B1020', accent: '#355CFF' },
  },
  brandBanner: {
    id: 'brandBanner',
    label: 'Brand Banner',
    description:
      'Coloured banner with an accent edge, active-word highlight and a quick entrance. Compact — never covers the speaker.',
    defaultFont: 'montserrat',
    fontWeight: 700,
    uppercaseDefault: true,
    letterSpacingEm: 0.01,
    box: 'banner',
    animation: 'bannerIn',
    activeWordHighlight: true,
    usesBackground: true,
    usesOutline: false,
    usesAccent: true,
    accentEdge: true,
    align: 'left',
    paddingScale: 0.9,
    borderRadiusPx: 6,
    defaultColors: { text: '#FFFFFF', background: '#355CFF', outline: '#000000', accent: '#FFE800' },
  },
  minimalEditorial: {
    id: 'minimalEditorial',
    label: 'Minimal Editorial',
    description: 'Elegant serif, generous letter-spacing, no box. Documentary feel.',
    defaultFont: 'editorial',
    fontWeight: 600,
    uppercaseDefault: false,
    letterSpacingEm: 0.04,
    box: 'none',
    animation: 'fade',
    activeWordHighlight: false,
    usesBackground: false,
    usesOutline: true,
    usesAccent: false,
    accentEdge: false,
    align: 'center',
    paddingScale: 0.4,
    borderRadiusPx: 0,
    defaultColors: { text: '#FFFFFF', background: '#000000', outline: '#0B1020', accent: '#FFE800' },
  },
  reelsPunch: {
    id: 'reelsPunch',
    label: 'Reels Punch',
    description: 'Condensed uppercase that punches in per cue. Active word in accent.',
    defaultFont: 'reelsCondensed',
    fontWeight: 700,
    uppercaseDefault: true,
    letterSpacingEm: 0.01,
    box: 'none',
    animation: 'pop',
    activeWordHighlight: true,
    usesBackground: false,
    usesOutline: true,
    usesAccent: true,
    accentEdge: false,
    align: 'center',
    paddingScale: 0.5,
    borderRadiusPx: 0,
    defaultColors: { text: '#FFFFFF', background: '#000000', outline: '#0B1020', accent: '#FF3B6B' },
  },
  wordPop: {
    id: 'wordPop',
    label: 'Word Pop',
    description: 'One or two words at a time, each popping in big and centred.',
    defaultFont: 'heavyBlack',
    fontWeight: 900,
    uppercaseDefault: true,
    letterSpacingEm: 0,
    box: 'none',
    animation: 'wordByWord',
    activeWordHighlight: true,
    usesBackground: false,
    usesOutline: true,
    usesAccent: true,
    accentEdge: false,
    align: 'center',
    paddingScale: 0.5,
    borderRadiusPx: 0,
    defaultColors: { text: '#FFFFFF', background: '#000000', outline: '#0B1020', accent: '#FFE800' },
  },
  lowerThird: {
    id: 'lowerThird',
    label: 'Lower Third',
    description: 'Left-anchored lower-third panel with an accent edge. Broadcast style.',
    defaultFont: 'poppins',
    fontWeight: 700,
    uppercaseDefault: false,
    letterSpacingEm: 0,
    box: 'lowerThird',
    animation: 'slideUp',
    activeWordHighlight: false,
    usesBackground: true,
    usesOutline: false,
    usesAccent: true,
    accentEdge: true,
    align: 'left',
    paddingScale: 0.9,
    borderRadiusPx: 6,
    defaultColors: { text: '#FFFFFF', background: 'rgba(11,16,32,0.9)', outline: '#000000', accent: '#FFE800' },
  },
};

export const CAPTION_PRESET_ORDER: CaptionPresetId[] = [
  'none',
  'clean',
  'impactPop',
  'karaoke',
  'bounceBox',
  'creatorOutline',
  'highlightBar',
  'brandBanner',
  'minimalEditorial',
  'reelsPunch',
  'wordPop',
  'lowerThird',
];

// ---------------------------------------------------------------------------
// Case transform
// ---------------------------------------------------------------------------

/** Apply caption letter-case. Title = lowercase the word, then capitalise its first letter. */
export function applyCase(text: string, mode: CaptionCase): string {
  switch (mode) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'title':
      return text.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    case 'original':
    default:
      return text;
  }
}

// ---------------------------------------------------------------------------
// Line wrapping / words-per-line reduction
// ---------------------------------------------------------------------------

/** Fewer words per line as caption size grows so text stays inside the frame. */
export function wordsPerLine(sizePct: number): number {
  if (sizePct >= 220) return 2;
  if (sizePct >= 160) return 3;
  if (sizePct >= 110) return 4;
  return 5;
}

// ---------------------------------------------------------------------------
// Single-line words-per-cue sizing model (SPEC "Caption size").
//
// Captions are ALWAYS a single line. Instead of shrinking letters or wrapping,
// we show FEWER words per cue as the size slider grows so the one line fits the
// video width with safe margins. The count is derived from a character-width
// heuristic (not bare magic numbers), so preview and export agree:
//
//   fontPx        = CAPTION_BASE_FRACTION * (sizePct/100) * frameHeight
//   usableWidthPx = (1 - 2*CAPTION_SAFE_X) * frameWidth
//   wordWidthPx   = AVG_WORD_CHARS * AVG_ADVANCE_EM * fontPx
//   maxWords      = usableWidthPx / wordWidthPx
//                 = K * frameAspect * (100/sizePct)   with  frameAspect = W/H
//
// frameAspect defaults to a moderate reference (leaning narrow) so a single
// line still fits typical vertical frames; callers that know the real output
// aspect (studio preview, export plan) pass it for exact per-format fitting.
// ---------------------------------------------------------------------------

/** Caption cap-height as a fraction of frame height at 100% (matches overlay + ASS). */
export const CAPTION_BASE_FRACTION = 0.055;
/** Safe horizontal margin each side, as a fraction of frame width (matches ASS SAFE_X). */
export const CAPTION_SAFE_X = 0.06;
/** Representative characters per word including a trailing space. */
const AVG_WORD_CHARS = 6;
/** Average glyph advance as a fraction of the font size (bold/wide caption faces). */
const AVG_ADVANCE_EM = 0.55;
/** Reference frame aspect (W/H) used when the caller does not supply one. */
export const DEFAULT_CAPTION_FRAME_ASPECT = 1.2;
/** Never show more than this many words on a single caption line. */
const MAX_WORDS_PER_CUE = 6;

/**
 * Words to show on a single caption line for a given size percentage and frame
 * aspect (width / height). Larger sizes -> fewer words; narrower frames (e.g.
 * 9:16) -> fewer words. Clamped to [1, MAX_WORDS_PER_CUE].
 */
export function wordsPerCueForSize(
  sizePct: number,
  frameAspect: number = DEFAULT_CAPTION_FRAME_ASPECT,
): number {
  const size = Number.isFinite(sizePct) && sizePct > 0 ? sizePct : 100;
  const aspect = Number.isFinite(frameAspect) && frameAspect > 0 ? frameAspect : DEFAULT_CAPTION_FRAME_ASPECT;
  const usableFracW = 1 - 2 * CAPTION_SAFE_X; // fraction of width available for text
  const wordWidthEm = AVG_WORD_CHARS * AVG_ADVANCE_EM; // word width in font-size units
  // maxWords = usableWidthPx / wordWidthPx, with fontPx = BASE_FRACTION*(size/100)*H
  // and usableWidthPx = usableFracW * aspect * H  ->  H cancels.
  const maxWords =
    (usableFracW * aspect) / (wordWidthEm * CAPTION_BASE_FRACTION * (size / 100));
  return Math.max(1, Math.min(MAX_WORDS_PER_CUE, Math.round(maxWords)));
}

/** Group a word list into balanced lines of at most `perLine` words. */
export function wrapWords<T>(words: T[], perLine: number): T[][] {
  if (perLine < 1) perLine = 1;
  const lines: T[][] = [];
  for (let i = 0; i < words.length; i += perLine) {
    lines.push(words.slice(i, i + perLine));
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Render spec — resolves a CaptionStyle into concrete numbers the overlay uses.
// ---------------------------------------------------------------------------

export interface CaptionRenderSpec {
  preset: CaptionPresetSpec;
  fontFamily: string;
  fontWeight: number;
  fontSizePx: number;
  letterSpacing: string;
  lineHeight: number;
  textColor: string;
  backgroundColor: string;
  outlineColor: string;
  accentColor: string;
  /** Ready-to-use CSS text-shadow value implementing the outline (or 'none'). */
  textShadow: string;
  boxMode: CaptionBoxMode;
  animation: CaptionAnimationKind;
  activeWordHighlight: boolean;
  accentEdge: boolean;
  align: 'center' | 'left';
  textTransform: 'uppercase' | 'lowercase' | 'capitalize' | 'none';
  paddingY: number;
  paddingX: number;
  borderRadius: number;
  wordsPerLine: number;
  perWordCap: number;
}

/** Multi-directional text outline as a CSS text-shadow string. */
function outlineShadow(color: string, px: number): string {
  if (px <= 0) return 'none';
  const o: string[] = [];
  const steps = [-px, 0, px];
  for (const dx of steps) {
    for (const dy of steps) {
      if (dx === 0 && dy === 0) continue;
      o.push(`${dx}px ${dy}px 0 ${color}`);
    }
  }
  // A soft drop for extra separation from busy footage.
  o.push(`0 ${Math.max(1, px)}px ${px * 2}px rgba(0,0,0,0.45)`);
  return o.join(', ');
}

/**
 * Resolve a CaptionStyle + a base font size (px, already scaled to the preview
 * or export frame) into concrete render values. `baseFontPx` is the size at
 * 100%; sizePct scales it.
 */
export function getCaptionRenderSpec(style: CaptionStyle, baseFontPx: number): CaptionRenderSpec {
  const preset = CAPTION_PRESETS[style.preset] ?? CAPTION_PRESETS.clean;
  const font = CAPTION_FONTS[style.font] ?? CAPTION_FONTS.modern;
  const fontSizePx = Math.max(8, (baseFontPx * style.sizePct) / 100);

  const caseMode: CaptionCase =
    style.case === 'original' && preset.uppercaseDefault ? 'upper' : style.case;
  const textTransform: CaptionRenderSpec['textTransform'] =
    caseMode === 'upper'
      ? 'uppercase'
      : caseMode === 'lower'
        ? 'lowercase'
        : caseMode === 'title'
          ? 'capitalize'
          : 'none';

  const outlinePx = preset.usesOutline ? Math.max(1, Math.round(fontSizePx * 0.045)) : 0;

  return {
    preset,
    fontFamily: font.stack,
    fontWeight: preset.fontWeight || font.weight,
    fontSizePx,
    letterSpacing: `${preset.letterSpacingEm}em`,
    lineHeight: 1.18,
    textColor: style.colors.text,
    backgroundColor: style.colors.background,
    outlineColor: style.colors.outline,
    accentColor: style.colors.accent,
    textShadow: outlineShadow(style.colors.outline, outlinePx),
    boxMode: preset.box,
    animation: preset.animation,
    activeWordHighlight: preset.activeWordHighlight,
    accentEdge: preset.accentEdge,
    align: preset.align,
    textTransform,
    paddingY: Math.round(fontSizePx * 0.28 * preset.paddingScale),
    paddingX: Math.round(fontSizePx * 0.5 * preset.paddingScale),
    borderRadius: preset.borderRadiusPx,
    wordsPerLine: wordsPerLine(style.sizePct),
    perWordCap: style.preset === 'wordPop' ? 2 : 0,
  };
}

/**
 * Block-level CSSProperties convenience (SPEC names `getCaptionCss(style,
 * fontScale)`). Preview and export both derive from these numbers so they match.
 * `fontScale` is the base font px at 100%.
 */
export function getCaptionCss(
  style: CaptionStyle,
  fontScale: number,
): Record<string, string | number> {
  const s = getCaptionRenderSpec(style, fontScale);
  return {
    fontFamily: s.fontFamily,
    fontWeight: s.fontWeight,
    fontSize: `${s.fontSizePx}px`,
    letterSpacing: s.letterSpacing,
    lineHeight: s.lineHeight,
    color: s.textColor,
    textTransform: s.textTransform,
    textAlign: s.align,
    textShadow: s.textShadow,
  };
}
