// ============================================================================
// lib/textMeasure.ts — REAL text measurement for caption single-line fitting.
//
// Captions are always rendered on ONE non-wrapping line, so the number of words
// per cue has to be chosen from how wide the text ACTUALLY is — not from an
// average-characters-per-word heuristic. A flat heuristic ignores letter case
// (several presets force ALL CAPS, whose glyphs are meaningfully wider) and
// per-word length variance ("extraordinarily" is not "a"), which is exactly how
// captions ended up overflowing the frame edge in vertical formats.
//
// This module owns a single reused <canvas> 2D context and a memoised
// em-width cache. Widths are measured once per (weight, family, text) at a
// reference font size and stored in EM units, because canvas advance width is
// linear in font size — so the same cache entry serves every caption size.
//
// DOM-optional: every entry point degrades to "cannot measure" when there is no
// document (SSR / worker), and callers fall back to the old heuristic. In this
// app (Vite SPA, main thread) measurement is always available: the studio
// preview and lib/exportPlan.ts both run on the main thread — only the FFmpeg
// encode itself is delegated to workers/ffmpeg.worker.ts.
// ============================================================================

import type { CaptionCase, CaptionStyle } from '../types';
import {
  applyCase,
  getCaptionRenderSpec,
  CAPTION_BASE_FRACTION,
  CAPTION_SAFE_X,
  DEFAULT_CAPTION_FRAME_ASPECT,
} from './captionLayout';

// ---------------------------------------------------------------------------
// Canvas singleton
// ---------------------------------------------------------------------------

// `undefined` = not probed yet, `null` = probed and unavailable.
let ctx: CanvasRenderingContext2D | null | undefined;

function getCtx(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  try {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      ctx = null;
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  return ctx ?? null;
}

/** True when canvas text measurement is available in this environment. */
export function canMeasureText(): boolean {
  return getCtx() !== null;
}

// ---------------------------------------------------------------------------
// Memoised measurement
// ---------------------------------------------------------------------------

/** Reference size the cache measures at; widths are stored as em multiples. */
const REF_PX = 100;
const CACHE_MAX = 20000;
const cache = new Map<string, number>();

/**
 * Drop every memoised width. Call this when the set of loaded webfonts changes
 * (fonts that were not yet loaded measure with the fallback face).
 */
export function resetTextMeasureCache(): void {
  cache.clear();
}

/** Advance width of `text` in em units (multiples of the font size). NaN if unmeasurable. */
export function measureTextEm(text: string, fontFamily: string, fontWeight: number): number {
  const c = getCtx();
  if (!c) return Number.NaN;
  const key = `${fontWeight}|${fontFamily}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  c.font = `${fontWeight} ${REF_PX}px ${fontFamily}`;
  const em = c.measureText(text).width / REF_PX;
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, em);
  return em;
}

/**
 * Rendered advance width of `text` in px. Canvas does not apply CSS
 * letter-spacing, so it is added manually (one advance per character, matching
 * how the browser lays the string out).
 */
export function measureTextWidth(
  text: string,
  fontPx: number,
  fontFamily: string,
  fontWeight: number,
  letterSpacingEm: number,
): number {
  const em = measureTextEm(text, fontFamily, fontWeight);
  if (!Number.isFinite(em)) return Number.NaN;
  return em * fontPx + letterSpacingEm * fontPx * text.length;
}

// ---------------------------------------------------------------------------
// Caption line fitter
// ---------------------------------------------------------------------------

/**
 * Reference frame height the fit is computed at.
 *
 * Font size AND usable width both scale linearly with frame height, so the fit
 * is resolution-invariant: a fixed reference height plus the real frame aspect
 * yields the SAME word grouping the real output resolution would. Using one
 * reference for both call sites is what guarantees preview and export produce
 * identical cues — that consistency is the requirement, not any resolution.
 */
export const CAPTION_FIT_REF_HEIGHT = 1080;

export interface CaptionLineFitter {
  /** Px of horizontal room the caption text row actually has. */
  usableWidthPx: number;
  /** Px gap the overlay renders between words (matches CaptionOverlay). */
  gapPx: number;
  /** The case that will really be rendered (preset uppercaseDefault composed in). */
  caseMode: CaptionCase;
  /** Measured width of one word AFTER the case transform. NaN if unmeasurable. */
  wordWidthPx(word: string): number;
}

/**
 * Build a fitter for a resolved caption style at a given frame aspect (W/H).
 * Returns null when canvas measurement is unavailable, so callers can fall back
 * to the legacy words-per-cue heuristic.
 */
export function createCaptionLineFitter(
  style: CaptionStyle,
  frameAspect: number = DEFAULT_CAPTION_FRAME_ASPECT,
): CaptionLineFitter | null {
  if (!canMeasureText()) return null;

  const h = CAPTION_FIT_REF_HEIGHT;
  const aspect =
    Number.isFinite(frameAspect) && frameAspect > 0 ? frameAspect : DEFAULT_CAPTION_FRAME_ASPECT;
  const w = h * aspect;

  const spec = getCaptionRenderSpec(style, h * CAPTION_BASE_FRACTION);

  // Room the text row loses to the block chrome the overlay/ASS actually draw.
  const boxed =
    spec.boxMode === 'block' || spec.boxMode === 'banner' || spec.boxMode === 'lowerThird';
  const paddingPx = boxed ? spec.paddingX * 2 : 0;
  const edgePx = spec.accentEdge ? Math.max(3, Math.round(spec.fontSizePx * 0.16)) : 0;
  // 'bar' presets pad the highlighted word on both sides (CaptionOverlay), so
  // the row grows by that much whenever a word is lit.
  const barPx = spec.boxMode === 'bar' ? spec.fontSizePx * 0.14 * 2 : 0;
  // 'perWord' pads EVERY word — charged per word below, not once here.
  const perWordPadPx = spec.boxMode === 'perWord' ? spec.paddingX * 0.5 * 2 : 0;

  const usableWidthPx = Math.max(
    spec.fontSizePx,
    (1 - 2 * CAPTION_SAFE_X) * w - paddingPx - edgePx - barPx,
  );

  const caseMode: CaptionCase =
    style.case === 'original' && spec.preset.uppercaseDefault ? 'upper' : style.case;
  const letterSpacingEm = spec.preset.letterSpacingEm;

  return {
    usableWidthPx,
    // CaptionOverlay lays words out in a flex row with this gap instead of a
    // rendered space; ASS joins with a space of comparable width.
    gapPx: spec.fontSizePx * 0.28,
    caseMode,
    wordWidthPx(word: string): number {
      const text = measureTextWidth(
        applyCase(word, caseMode),
        spec.fontSizePx,
        spec.fontFamily,
        spec.fontWeight,
        letterSpacingEm,
      );
      return Number.isFinite(text) ? text + perWordPadPx : text;
    },
  };
}
