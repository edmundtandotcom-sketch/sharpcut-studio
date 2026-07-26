// ============================================================================
// lib/cuts.ts — THE time model. Every later phase (captions, transitions,
// zooms, export) maps source<->output time through keptSegments +
// sourceToOutput / outputToSource. Do not fork these.
//
// Contract (docs/ARCHITECTURE.md "Time model"):
//   - All Cut/CaptionBlock/ZoomEffect times are SOURCE seconds.
//   - keptSegments(cuts, duration) merges active cuts (sort + coalesce) and
//     returns the ordered kept Segment[] after subtraction from [0, duration].
//   - Output time = concatenated kept time / speed.
// ============================================================================

import type { Cut, Segment } from '../types';
import { clamp } from './time';

/** Kept slivers shorter than this are dropped (source seconds). */
const MIN_SEGMENT_S = 0.15;

/**
 * Merge the active cuts and subtract them from [0, duration], returning the
 * ordered kept segments. Overlapping active cuts are coalesced deterministically
 * (sort by start, coalesce). Kept slivers < 0.15s are dropped.
 */
export function keptSegments(cuts: Cut[], duration: number): Segment[] {
  if (!(duration > 0)) return [];

  const active = cuts
    .filter((c) => c.active && c.end > c.start)
    .map((c) => ({
      start: clamp(c.start, 0, duration),
      end: clamp(c.end, 0, duration),
    }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);

  // Coalesce overlapping / touching active cuts.
  const removed: { start: number; end: number }[] = [];
  for (const r of active) {
    const last = removed[removed.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      removed.push({ ...r });
    }
  }

  // Subtract removed ranges from [0, duration].
  const segments: Segment[] = [];
  let cursor = 0;
  let index = 0;
  for (const r of removed) {
    if (r.start > cursor) {
      const start = cursor;
      const end = r.start;
      if (end - start >= MIN_SEGMENT_S) {
        segments.push({ index: index++, start, end });
      }
    }
    cursor = Math.max(cursor, r.end);
  }
  if (duration - cursor >= MIN_SEGMENT_S) {
    segments.push({ index: index++, start: cursor, end: duration });
  }
  return segments;
}

/** Total kept source duration (before speed). */
export function keptDuration(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + (s.end - s.start), 0);
}

/**
 * Map a SOURCE-time instant into OUTPUT time (concatenated kept time / speed).
 * A source instant that falls inside a removed gap snaps to the end of the
 * preceding kept content (deterministic).
 */
export function sourceToOutput(t: number, segments: Segment[], speed: number): number {
  const rate = speed > 0 ? speed : 1;
  let concat = 0;
  for (const s of segments) {
    if (t >= s.end) {
      concat += s.end - s.start;
      continue;
    }
    if (t <= s.start) break; // in a removed gap before this segment
    concat += t - s.start; // inside this segment
    break;
  }
  return concat / rate;
}

/**
 * Map an OUTPUT-time instant back to SOURCE time. Inverse of sourceToOutput
 * on kept regions. Clamps past-the-end to the final segment end.
 */
export function outputToSource(t: number, segments: Segment[], speed: number): number {
  const rate = speed > 0 ? speed : 1;
  let target = t * rate; // concatenated source seconds
  let acc = 0;
  for (const s of segments) {
    const len = s.end - s.start;
    if (target <= acc + len) return s.start + Math.max(0, target - acc);
    acc += len;
  }
  const last = segments[segments.length - 1];
  return last ? last.end : 0;
}

/**
 * Resolve overlapping cuts into a non-overlapping list (sort by start, coalesce).
 * When cuts overlap, the union range takes the highest-confidence contributor's
 * type/reason/confidence/id, and is active if any contributor is active.
 * Used at suggestion-build time so the review list never shows overlapping cuts.
 */
export function coalesceCuts(cuts: Cut[]): Cut[] {
  const sorted = [...cuts]
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out: Cut[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.start <= last.end) {
      const winner = c.confidence > last.confidence ? c : last;
      out[out.length - 1] = {
        ...winner,
        start: Math.min(last.start, c.start),
        end: Math.max(last.end, c.end),
        active: last.active || c.active,
      };
    } else {
      out.push({ ...c });
    }
  }
  return out;
}
