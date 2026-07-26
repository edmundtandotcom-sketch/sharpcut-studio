// ============================================================================
// lib/transitionsSuggest.ts — auto-suggest transitions at MAJOR cut boundaries.
//
// A "boundary" is the join between kept segment i and i+1 (boundaryIndex = i).
// The removed gap at that boundary = segments[i+1].start - segments[i].end.
// We only suggest at boundaries where a meaningful chunk was removed (topic /
// section change), or at evenly-spaced larger boundaries — never at every tiny
// cut (SPEC "avoid applying transitions at every tiny cut").
//
// Pure module — NO React imports.
// ============================================================================

import type { Segment, TransitionPoint, TransitionType } from '../types';
import { id } from './time';

/** Default, tasteful durations per transition type (ms, 80–250 range). */
export const TRANSITION_DEFAULT_MS: Record<TransitionType, number> = {
  none: 0,
  quickFade: 160,
  flash: 90,
  dipToBlack: 220,
  quickPush: 180,
  crossDissolve: 200,
  cleanBlur: 140,
};

export const TRANSITION_LABELS: Record<TransitionType, string> = {
  none: 'None',
  quickFade: 'Quick Fade',
  flash: 'Flash',
  dipToBlack: 'Dip to Black',
  quickPush: 'Quick Push',
  crossDissolve: 'Cross Dissolve',
  cleanBlur: 'Clean Blur',
};

export const TRANSITION_ORDER: TransitionType[] = [
  'none',
  'quickFade',
  'flash',
  'dipToBlack',
  'quickPush',
  'crossDissolve',
  'cleanBlur',
];

/** Removed-gap size (source seconds) at each interior boundary. */
export function boundaryGaps(segments: Segment[]): number[] {
  const gaps: number[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    gaps.push(Math.max(0, segments[i + 1].start - segments[i].end));
  }
  return gaps;
}

export interface SuggestTransitionsOptions {
  /** Minimum removed gap (source seconds) to treat a boundary as "major". */
  gapThresholdS?: number;
  /** Default transition type applied to suggested boundaries. */
  type?: TransitionType;
  /** Hard cap on how many transitions we auto-place. */
  maxCount?: number;
}

/**
 * Suggest transitions at major boundaries. A boundary qualifies when its
 * removed gap >= gapThresholdS. If that yields more than maxCount, keep the
 * boundaries with the largest gaps. Deterministic (sorted by boundary index).
 */
export function suggestTransitions(
  segments: Segment[],
  opts: SuggestTransitionsOptions = {},
): TransitionPoint[] {
  const gapThresholdS = opts.gapThresholdS ?? 1.5;
  const type = opts.type ?? 'quickFade';
  const maxCount = opts.maxCount ?? 12;

  const gaps = boundaryGaps(segments);
  const candidates = gaps
    .map((gap, boundaryIndex) => ({ boundaryIndex, gap }))
    .filter((c) => c.gap >= gapThresholdS);

  // If too many, keep the largest gaps.
  candidates.sort((a, b) => b.gap - a.gap);
  const kept = candidates.slice(0, maxCount);
  kept.sort((a, b) => a.boundaryIndex - b.boundaryIndex);

  return kept.map((c) => ({
    id: id(),
    boundaryIndex: c.boundaryIndex,
    type,
    durationMs: TRANSITION_DEFAULT_MS[type],
  }));
}

/** Apply one transition type to every interior boundary (capped). */
export function applyTypeToAllBoundaries(
  segments: Segment[],
  type: TransitionType,
  maxCount = 40,
): TransitionPoint[] {
  const count = Math.min(segments.length - 1, maxCount);
  const points: TransitionPoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({ id: id(), boundaryIndex: i, type, durationMs: TRANSITION_DEFAULT_MS[type] });
  }
  return points;
}
