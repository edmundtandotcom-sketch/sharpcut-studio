// ============================================================================
// lib/zoomSuggest.ts — auto-suggest quick zoom effects on suitable segments.
//
// Longer kept segments (a speaker holding a point) get a quick punch-in near
// the start to add energy, with density capped so it never feels gimmicky.
// All zoom times are stored in SOURCE seconds and mapped to output time at
// render (SPEC "Synchronise effects after speed changes").
//
// Pure module — NO React imports.
// ============================================================================

import type { Segment, ZoomEffect, ZoomType } from '../types';
import { id } from './time';

export const ZOOM_LABELS: Record<ZoomType, string> = {
  zoomIn: 'Quick Zoom In',
  zoomOut: 'Quick Zoom Out',
  punchIn: 'Punch In — tight crop',
  reset: 'Reset',
};

export const ZOOM_ORDER: ZoomType[] = ['punchIn', 'zoomIn', 'zoomOut', 'reset'];

/**
 * Default target scale per zoom type (1 = no zoom). These are real punch-in
 * crops, not subtle pulses: punchIn lands on a clearly tighter frame that is
 * HELD until the next effect in the segment (or the segment end). zoomOut and
 * reset both return to the full 1.0 frame.
 */
export const ZOOM_DEFAULT_SCALE: Record<ZoomType, number> = {
  zoomIn: 1.3,
  zoomOut: 1.0,
  punchIn: 1.4,
  reset: 1.0,
};

/** Default movement duration per zoom type (ms, fast 80–180 range). */
export const ZOOM_DEFAULT_MS: Record<ZoomType, number> = {
  zoomIn: 140,
  zoomOut: 140,
  punchIn: 110,
  reset: 120,
};

/**
 * Resolved target scale for a zoom effect (the level it holds at). punchIn /
 * zoomIn hold at their configured scale (clamped >= 1 so the transform is always
 * crop-safe); zoomOut and reset release back to the full 1.0 frame. Shared by the
 * studio preview (previewEffects) and the FFmpeg export (ffmpegFilters) so the
 * burned zoom matches the preview exactly.
 */
export function zoomTargetScale(type: ZoomType, scale: number): number {
  if (type === 'reset' || type === 'zoomOut') return 1;
  return Math.max(1, Number.isFinite(scale) && scale > 0 ? scale : 1);
}

export interface SuggestZoomsOptions {
  /** Only segments longer than this (source seconds) get an auto-zoom. */
  minSegmentS?: number;
  /** How far into the segment (source seconds) the punch-in lands. */
  offsetS?: number;
  /** Hard cap on auto-placed zooms. */
  maxCount?: number;
  /**
   * Segments longer than this (source seconds) also get a later Reset so the
   * tight crop releases part-way through instead of holding the whole segment.
   */
  resetAfterS?: number;
  /** Source seconds the tight crop is held before the auto Reset releases it. */
  holdS?: number;
}

/**
 * Suggest quick punch-in zooms for long segments. Each eligible segment gets a
 * fast punch-in to a tight crop near its start; the crop then HOLDS until the
 * next effect in that segment or the segment end. On longer segments we also
 * place a later Reset so the punch releases part-way through rather than holding
 * for the entire clip. Density is capped and immediately-adjacent segments are
 * skipped so zooms don't stack.
 */
export function suggestZooms(segments: Segment[], opts: SuggestZoomsOptions = {}): ZoomEffect[] {
  const minSegmentS = opts.minSegmentS ?? 8;
  const offsetS = opts.offsetS ?? 0.4;
  const maxCount = opts.maxCount ?? 10;
  const resetAfterS = opts.resetAfterS ?? 16;
  const holdS = opts.holdS ?? 5;

  const out: ZoomEffect[] = [];
  let lastUsedIndex = -2;
  for (const seg of segments) {
    if (out.length >= maxCount) break;
    const len = seg.end - seg.start;
    if (len < minSegmentS) continue;
    if (seg.index - lastUsedIndex < 2) continue; // skip adjacent segments
    const atSource = Math.min(seg.end - 0.3, seg.start + offsetS);
    out.push({
      id: id(),
      segmentIndex: seg.index,
      atSource,
      type: 'punchIn',
      scale: ZOOM_DEFAULT_SCALE.punchIn,
      durationMs: ZOOM_DEFAULT_MS.punchIn,
    });
    // Long segment: release the tight crop part-way through with a Reset.
    if (len >= resetAfterS) {
      const resetAt = Math.min(seg.end - 0.5, atSource + holdS);
      if (resetAt > atSource + 0.2) {
        out.push({
          id: id(),
          segmentIndex: seg.index,
          atSource: resetAt,
          type: 'reset',
          scale: ZOOM_DEFAULT_SCALE.reset,
          durationMs: ZOOM_DEFAULT_MS.reset,
        });
      }
    }
    lastUsedIndex = seg.index;
  }
  return out;
}
