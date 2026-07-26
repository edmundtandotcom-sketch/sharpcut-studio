// ============================================================================
// lib/ffmpegFilters.ts — deterministic FFmpeg filtergraph + argument builders.
//
// PURE module (no React, no ffmpeg imports). Every string here is a function of
// its inputs only, so the same ExportPlan always produces byte-identical
// commands. The export worker (workers/ffmpeg.worker.ts) executes what these
// build; the ASS caption pass is generated separately in lib/assSubtitles.ts.
//
// Time model: all effect times arrive in SOURCE seconds; callers convert to
// segment-local OUTPUT time before asking for a zoom expression (see zoomExpr).
// ============================================================================

import type { OutputFormat, Quality, TransitionType, ZoomEffect } from '../types';

/** Round to 4 dp so generated expressions are stable and readable. */
export function r(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

/** Nearest even integer >= 2 (H.264 requires even dimensions). */
export function even(n: number): number {
  const v = Math.max(2, Math.round(n));
  return v % 2 === 0 ? v : v + 1;
}

export interface Dims {
  w: number;
  h: number;
}

// Cap the long edge so wasm never has to encode more than 1080p-class frames
// (protects memory/time on 4K sources); canonical social dimensions otherwise.
const MAX_LONG_EDGE = 1920;

/**
 * Output pixel dimensions for a format. Vertical -> 1080x1920, landscape ->
 * 1920x1080, original -> source dims. The long edge is capped (downscale-only)
 * and both dimensions are forced even.
 */
export function outputDims(format: OutputFormat, srcW: number, srcH: number): Dims {
  const sw = srcW > 0 ? srcW : 1280;
  const sh = srcH > 0 ? srcH : 720;
  let w: number;
  let h: number;
  if (format === 'vertical') {
    w = 1080;
    h = 1920;
  } else if (format === 'landscape') {
    w = 1920;
    h = 1080;
  } else {
    w = sw;
    h = sh;
  }
  const long = Math.max(w, h);
  if (long > MAX_LONG_EDGE) {
    const k = MAX_LONG_EDGE / long;
    w *= k;
    h *= k;
  }
  return { w: even(w), h: even(h) };
}

// ---------------------------------------------------------------------------
// Zoom — crop-safe, time-windowed scale expressed as a per-frame crop factor.
// These constants MIRROR components/studio/previewEffects.ts so the burned zoom
// matches the studio preview. Keep them in sync if either changes.
// ---------------------------------------------------------------------------

const ZOOM_HOLD_S = 0.45;
const ZOOM_OUT_PEAK = 1.08;
const ZOOM_MIN_PEAK = 1.06;

function zoomPeak(z: ZoomEffect): number {
  if (z.type === 'zoomOut') return ZOOM_OUT_PEAK;
  return Math.max(ZOOM_MIN_PEAK, z.scale > 1 ? z.scale : 1.12);
}

/**
 * Build the crop-divisor expression `z(t)` (>= 1) for a segment's zoom pulses,
 * where `t` is OUTPUT seconds relative to the segment start (post-setpts).
 * Used as `crop=iw/(z):ih/(z):(iw-iw/(z))/2:(ih-ih/(z))/2,scale=W:H` so the
 * frame is always fully covered (never exposes edges). Returns null when the
 * segment has no active (non-reset) zooms.
 */
export function zoomExpr(zooms: ZoomEffect[], segStartSource: number, speed: number): string | null {
  const rate = speed > 0 ? speed : 1;
  const terms: string[] = [];
  for (const z of zooms) {
    if (z.type === 'reset') continue;
    const t0 = (z.atSource - segStartSource) / rate; // segment-local output seconds
    const ramp = Math.max(0.05, z.durationMs / 1000);
    const hold = ZOOM_HOLD_S;
    const peak = zoomPeak(z);
    const t1 = t0 + ramp;
    const t2 = t0 + ramp + hold;
    const t3 = t2 + ramp;
    const up = `1+${r(peak - 1)}*(t-${r(t0)})/${r(ramp)}`;
    const down = `1+${r(peak - 1)}*(1-(t-${r(t2)})/${r(ramp)})`;
    const pulse = `if(between(t,${r(t0)},${r(t3)}),if(lt(t,${r(t1)}),${up},if(lt(t,${r(t2)}),${r(peak)},${down})),1)`;
    terms.push(pulse);
  }
  if (terms.length === 0) return null;
  let expr = terms[0];
  for (let i = 1; i < terms.length; i++) expr = `max(${expr},${terms[i]})`;
  return `max(1,${expr})`;
}

// ---------------------------------------------------------------------------
// Per-segment video / audio filter chains.
// ---------------------------------------------------------------------------

export interface SegmentVideoParams {
  speed: number;
  dims: Dims;
  /** Horizontal crop fraction of overflow (0 left .. 1 right). */
  cropXf: number;
  /** Vertical crop fraction of overflow (0 top .. 1 bottom). */
  cropYf: number;
  /** Force this fps (needed so xfade timebases match). null keeps source fps. */
  fps: number | null;
  /** Zoom divisor expression from zoomExpr(), or null. */
  zoom: string | null;
}

/**
 * Video filter chain for one kept segment:
 *   setpts (speed) -> [fps] -> scale-to-fill + crop-to-format -> [zoom] -> yuv420p
 */
export function segmentVideoFilter(p: SegmentVideoParams): string {
  const { w, h } = p.dims;
  const parts: string[] = [];
  parts.push(`setpts=(PTS-STARTPTS)/${r(p.speed > 0 ? p.speed : 1)}`);
  if (p.fps) parts.push(`fps=${p.fps}`);
  // Scale so the source fully covers WxH, then crop to exact WxH at position.
  parts.push(`scale=${w}:${h}:force_original_aspect_ratio=increase`);
  parts.push('setsar=1');
  parts.push(`crop=${w}:${h}:(iw-${w})*${r(clamp01(p.cropXf))}:(ih-${h})*${r(clamp01(p.cropYf))}`);
  if (p.zoom) {
    parts.push(`crop=iw/(${p.zoom}):ih/(${p.zoom}):(iw-iw/(${p.zoom}))/2:(ih-ih/(${p.zoom}))/2`);
    parts.push(`scale=${w}:${h}`);
  }
  parts.push('format=yuv420p');
  return parts.join(',');
}

/** atempo stages: single stage covers 0.5..2; chain for extreme speeds. */
export function atempoStages(speed: number): number[] {
  let s = speed > 0 ? speed : 1;
  const out: number[] = [];
  while (s > 2.0) {
    out.push(2.0);
    s /= 2.0;
  }
  while (s < 0.5) {
    out.push(0.5);
    s *= 2.0;
  }
  out.push(r(s));
  return out;
}

/** Audio filter chain: tempo change (natural pitch) + async resample. */
export function segmentAudioFilter(speed: number): string {
  const stages = atempoStages(speed).map((s) => `atempo=${r(s)}`);
  return [...stages, 'aresample=async=1:first_pts=0'].join(',');
}

// ---------------------------------------------------------------------------
// Encoding args per quality tier.
// ---------------------------------------------------------------------------

const QUALITY: Record<Quality, { crf: number; preset: string }> = {
  standard: { crf: 23, preset: 'veryfast' },
  high: { crf: 19, preset: 'medium' },
  source: { crf: 17, preset: 'medium' },
};

/** libx264 + AAC encode args for a quality tier. */
export function encodeArgs(quality: Quality): string[] {
  const q = QUALITY[quality] ?? QUALITY.high;
  return [
    '-c:v',
    'libx264',
    '-preset',
    q.preset,
    '-crf',
    String(q.crf),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart',
  ];
}

/** Video-only encode args (audio handled separately), for the caption pass. */
export function videoEncodeArgs(quality: Quality): string[] {
  const q = QUALITY[quality] ?? QUALITY.high;
  return [
    '-c:v',
    'libx264',
    '-preset',
    q.preset,
    '-crf',
    String(q.crf),
    '-pix_fmt',
    'yuv420p',
  ];
}

// ---------------------------------------------------------------------------
// Transition (xfade) mapping.
// ---------------------------------------------------------------------------

interface XfadeMap {
  name: string;
  fallback: string;
}

// SPEC preset -> xfade transition. cleanBlur -> hblur (an xfade enum, present
// whenever xfade itself is compiled); fallback to fade for safety.
const XFADE: Record<TransitionType, XfadeMap> = {
  none: { name: 'fade', fallback: 'fade' },
  quickFade: { name: 'fade', fallback: 'fade' },
  flash: { name: 'fadewhite', fallback: 'fade' },
  dipToBlack: { name: 'fadeblack', fallback: 'fade' },
  quickPush: { name: 'slideleft', fallback: 'fade' },
  crossDissolve: { name: 'dissolve', fallback: 'fade' },
  cleanBlur: { name: 'hblur', fallback: 'fade' },
};

export function xfadeName(type: TransitionType): string {
  return (XFADE[type] ?? XFADE.quickFade).name;
}

export function xfadeFallback(type: TransitionType): string {
  return (XFADE[type] ?? XFADE.quickFade).fallback;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}
