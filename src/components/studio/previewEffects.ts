// Preview approximations for zoom + transition effects (SPEC "Preview
// Accuracy": close approximations, clearly flagged). All effect times are stored
// in SOURCE seconds and mapped to OUTPUT time here so they stay in sync after
// speed changes.

import type { Segment, TransitionPoint, TransitionType, ZoomEffect } from '../../types';
import { sourceToOutput } from '../../lib/cuts';
import { zoomTargetScale } from '../../lib/zoomSuggest';

function easeOut(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return 1 - (1 - c) * (1 - c);
}

/**
 * Crop-safe zoom scale (>= 1, never exposes empty edges) at an output-time
 * instant. Zooms are real punch-ins, not pulses: each effect fast-ramps to its
 * target level (transform-origin at the frame centre) and HOLDS that tight crop
 * until the next effect in the same segment, or the segment end (where it
 * returns to 1.0). Reset / Zoom Out release back to the full frame. Mirrors the
 * FFmpeg export math in lib/ffmpegFilters.zoomExpr so preview matches export.
 */
export function zoomScaleAt(
  zooms: ZoomEffect[],
  segments: Segment[],
  speed: number,
  outputTime: number,
): number {
  if (zooms.length === 0) return 1;

  // Find the kept segment (output-time window) containing this instant. Holds
  // are bounded by the segment: a punch never bleeds into the next segment.
  for (const seg of segments) {
    const segOut0 = sourceToOutput(seg.start, segments, speed);
    const segOut1 = sourceToOutput(seg.end, segments, speed);
    if (outputTime < segOut0 || outputTime > segOut1) continue;

    const segZooms = zooms
      .filter((z) => z.segmentIndex === seg.index)
      .map((z) => ({
        t0: sourceToOutput(z.atSource, segments, speed),
        ramp: Math.max(0.05, z.durationMs / 1000),
        target: zoomTargetScale(z.type, z.scale),
      }))
      .sort((a, b) => a.t0 - b.t0);
    if (segZooms.length === 0) return 1;

    let level = 1; // level before the first effect
    let scale = 1;
    for (let i = 0; i < segZooms.length; i++) {
      const z = segZooms[i];
      if (outputTime < z.t0) break; // this and later effects have not started
      if (outputTime <= z.t0 + z.ramp) {
        // Fast ramp from the previous held level to this effect's target.
        scale = level + (z.target - level) * easeOut((outputTime - z.t0) / z.ramp);
      } else {
        // Held tight crop until the next effect / segment end.
        scale = z.target;
      }
      level = z.target;
    }
    return Math.max(1, scale);
  }
  return 1;
}

export interface TransitionVisual {
  opacity: number;
  color: string;
  blurPx: number;
}

const TRANSITION_PEAK: Record<TransitionType, number> = {
  none: 0,
  quickFade: 0.85,
  flash: 0.9,
  dipToBlack: 1,
  quickPush: 0.7,
  crossDissolve: 0.7,
  cleanBlur: 0.55,
};

/**
 * Overlay visual for transitions at an output-time instant. The overlay opacity
 * peaks at the segment-join time (xfade-centred) and fades out either side.
 */
export function transitionVisualAt(
  transitions: TransitionPoint[],
  segments: Segment[],
  speed: number,
  outputTime: number,
): TransitionVisual {
  let best: TransitionVisual = { opacity: 0, color: '#000000', blurPx: 0 };
  for (const tr of transitions) {
    if (tr.type === 'none') continue;
    const seg = segments[tr.boundaryIndex];
    if (!seg) continue;
    const tb = sourceToOutput(seg.end, segments, speed);
    const half = Math.max(0.04, tr.durationMs / 1000);
    if (outputTime < tb - half || outputTime > tb + half) continue;
    const dist = Math.abs(outputTime - tb) / half; // 0 at centre, 1 at edges
    const tri = 1 - dist;
    const peak = TRANSITION_PEAK[tr.type];
    const opacity = tri * peak;
    const color = tr.type === 'flash' ? '#FFFFFF' : '#000000';
    const blurPx = tr.type === 'cleanBlur' ? tri * 10 : 0;
    if (opacity > best.opacity || blurPx > best.blurPx) {
      best = { opacity, color, blurPx };
    }
  }
  return best;
}
