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
  punchIn: 'Punch In',
  reset: 'Reset',
};

export const ZOOM_ORDER: ZoomType[] = ['punchIn', 'zoomIn', 'zoomOut', 'reset'];

/** Default target scale per zoom type (1 = no zoom). */
export const ZOOM_DEFAULT_SCALE: Record<ZoomType, number> = {
  zoomIn: 1.12,
  zoomOut: 0.9,
  punchIn: 1.18,
  reset: 1.0,
};

/** Default movement duration per zoom type (ms, fast 80–180 range). */
export const ZOOM_DEFAULT_MS: Record<ZoomType, number> = {
  zoomIn: 140,
  zoomOut: 140,
  punchIn: 110,
  reset: 120,
};

export interface SuggestZoomsOptions {
  /** Only segments longer than this (source seconds) get an auto-zoom. */
  minSegmentS?: number;
  /** How far into the segment (source seconds) the punch-in lands. */
  offsetS?: number;
  /** Hard cap on auto-placed zooms. */
  maxCount?: number;
}

/**
 * Suggest quick punch-in zooms for long segments. Density is capped and we
 * skip immediately-adjacent segments so zooms don't stack.
 */
export function suggestZooms(segments: Segment[], opts: SuggestZoomsOptions = {}): ZoomEffect[] {
  const minSegmentS = opts.minSegmentS ?? 8;
  const offsetS = opts.offsetS ?? 0.4;
  const maxCount = opts.maxCount ?? 10;

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
    lastUsedIndex = seg.index;
  }
  return out;
}
