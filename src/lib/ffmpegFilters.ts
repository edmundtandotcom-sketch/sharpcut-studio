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
import { zoomTargetScale } from './zoomSuggest';

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
// The held-punch model MIRRORS components/studio/previewEffects.zoomScaleAt so
// the burned zoom matches the studio preview. Keep them in sync if either
// changes; both resolve target levels via zoomSuggest.zoomTargetScale.
// ---------------------------------------------------------------------------

/**
 * Build the crop-divisor expression `z(t)` (>= 1) for a segment's zooms, where
 * `t` is OUTPUT seconds relative to the segment start (post-setpts). Each effect
 * fast-ramps from the previous held level to its target and then HOLDS that
 * tight crop until the next effect in the segment (or, for the final effect, the
 * segment end). Reset / Zoom Out release to 1.0.
 *
 * Used as `crop=iw/(z):ih/(z):(iw-iw/(z))/2:(ih-ih/(z))/2,scale=W:H` so the
 * frame is always fully covered (never exposes edges) and the crop stays centred
 * on the current frame. Returns null when the segment ends up at 1.0 throughout
 * (no visible zoom).
 */
export function zoomExpr(zooms: ZoomEffect[], segStartSource: number, speed: number): string | null {
  const rate = speed > 0 ? speed : 1;
  const levels = zooms
    .map((z) => ({
      t0: (z.atSource - segStartSource) / rate, // segment-local output seconds
      ramp: Math.max(0.05, z.durationMs / 1000),
      target: zoomTargetScale(z.type, z.scale),
    }))
    .sort((a, b) => a.t0 - b.t0);
  if (levels.length === 0) return null;
  // No visible zoom anywhere in the segment (e.g. a lone Reset).
  if (levels.every((l) => l.target <= 1.0001)) return null;

  // Build nested piecewise: for t before the first effect the scale is 1; each
  // effect owns [t0_i, t0_{i+1}) as a fast ramp from the previous level then a
  // held target; the last effect holds its target to the segment end.
  const within = (i: number): string => {
    const l = levels[i];
    const prev = i === 0 ? 1 : levels[i - 1].target;
    const t1 = l.t0 + l.ramp;
    const frac = `clip((t-${r(l.t0)})/${r(l.ramp)},0,1)`;
    const ramp = `${r(prev)}+${r(l.target - prev)}*${frac}`;
    return `if(lt(t,${r(t1)}),${ramp},${r(l.target)})`;
  };
  // Assemble from the last effect back to the first.
  let expr = within(levels.length - 1);
  for (let i = levels.length - 2; i >= 0; i--) {
    expr = `if(lt(t,${r(levels[i + 1].t0)}),${within(i)},${expr})`;
  }
  expr = `if(lt(t,${r(levels[0].t0)}),1,${expr})`;
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
    // Single-quote each arg: the zoom expression contains commas, which would
    // otherwise be parsed as filter-chain separators.
    parts.push(
      `crop='iw/(${p.zoom})':'ih/(${p.zoom})':'(iw-iw/(${p.zoom}))/2':'(ih-ih/(${p.zoom}))/2'`,
    );
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

// Quality tiers. CRF carries the quality differentiation between tiers; the
// x264 *preset* is deliberately kept fast across all of them.
//
// Why: this encoder is libx264 compiled to WebAssembly with no SIMD-wide native
// tuning, so the slower presets cost far more here than they do natively while
// buying the same marginal fidelity. `high` and `source` used to use `medium`,
// which made a 2-minute clip (8 segments + a full-length caption burn) take
// ~7-8 minutes in-browser — a real user reported exactly that pain. x264
// `veryfast` is typically 3-4× faster than `medium` at the same CRF for a
// modest size increase and a difference that is essentially invisible at these
// CRF levels on Reels/YouTube-bound footage (this tool is not an archival
// mastering path). `source` keeps one step of extra effort (`fast`) so the
// top tier still means something beyond its lower CRF.
const QUALITY: Record<Quality, { crf: number; preset: string }> = {
  standard: { crf: 23, preset: 'veryfast' },
  high: { crf: 19, preset: 'veryfast' },
  source: { crf: 17, preset: 'fast' },
};

// Preset for INTERMEDIATE passes — output that a later pass re-encodes and then
// throws away (segment renders before a caption burn, and the xfade join when a
// caption burn follows). The user's chosen preset buys nothing on a file that is
// about to be re-encoded, so intermediates always use the cheapest preset.
// CRF is deliberately left at the tier value: intermediate segments are held in
// memory for the whole render, so growing them (a lower CRF) would trade encode
// time for memory-ceiling risk on long videos.
const INTERMEDIATE_PRESET = 'veryfast';

function presetFor(quality: Quality, intermediate: boolean): { crf: number; preset: string } {
  const q = QUALITY[quality] ?? QUALITY.high;
  return intermediate ? { crf: q.crf, preset: INTERMEDIATE_PRESET } : q;
}

/**
 * libx264 + AAC encode args for a quality tier. Pass `intermediate` when the
 * output of this pass is re-encoded by a later pass (see INTERMEDIATE_PRESET).
 */
export function encodeArgs(quality: Quality, intermediate = false): string[] {
  const q = presetFor(quality, intermediate);
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
export function videoEncodeArgs(quality: Quality, intermediate = false): string[] {
  const q = presetFor(quality, intermediate);
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
