// Preview approximations for zoom + transition effects (SPEC "Preview
// Accuracy": close approximations, clearly flagged). All effect times are stored
// in SOURCE seconds and mapped to OUTPUT time here so they stay in sync after
// speed changes.

import type { Segment, TransitionPoint, TransitionType, ZoomEffect } from '../../types';
import { sourceToOutput } from '../../lib/cuts';

function easeOut(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return 1 - (1 - c) * (1 - c);
}

/**
 * Crop-safe zoom scale (>= 1, never exposes empty edges) at an output-time
 * instant. Every non-reset zoom is a quick punch pulse: scale up over its
 * duration, hold briefly, release back to 1.
 */
export function zoomScaleAt(
  zooms: ZoomEffect[],
  segments: Segment[],
  speed: number,
  outputTime: number,
): number {
  let scale = 1;
  for (const z of zooms) {
    if (z.type === 'reset') continue;
    const t0 = sourceToOutput(z.atSource, segments, speed);
    const ramp = Math.max(0.05, z.durationMs / 1000);
    const hold = 0.45;
    const win = ramp + hold + ramp;
    if (outputTime < t0 || outputTime > t0 + win) continue;
    const peak = z.type === 'zoomOut' ? 1.08 : Math.max(1.06, z.scale);
    let s = 1;
    if (outputTime <= t0 + ramp) {
      s = 1 + (peak - 1) * easeOut((outputTime - t0) / ramp);
    } else if (outputTime <= t0 + ramp + hold) {
      s = peak;
    } else {
      s = 1 + (peak - 1) * (1 - easeOut((outputTime - t0 - ramp - hold) / ramp));
    }
    scale = Math.max(scale, s);
  }
  return scale;
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
