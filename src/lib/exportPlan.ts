// ============================================================================
// lib/exportPlan.ts — PURE, deterministic ExportPlan builder. Turns the store
// snapshot (kept segments + studio settings + caption blocks) into the exact
// per-segment FFmpeg commands, join plan, and ASS caption file(s) the export
// worker executes. No React, no ffmpeg, no side effects.
//
// Combined export passes (worker): render each kept segment -> join. Join is a
// concat-demuxer copy when there are no transitions; with transitions the
// segments are grouped into runs (concat copy) and the runs are chained with
// xfade/acrossfade.
//
// CAPTIONS BURN INSIDE THE SEGMENT RENDER, not in a separate full-length pass.
// Each segment carries its OWN ASS file holding only the cues that land inside
// its window, rebased so the segment starts at 0, and its own `ass=` filter at
// the end of the -vf chain. That removes an entire extra encode of the whole
// timeline (the old final "caption burn" pass) — roughly halving wall-clock for a
// captioned export — and, as a bonus, fixes caption drift after transitions:
// burned-in captions ride inside the segment's own frames, so the xfade overlap
// shifting later segments in the final timeline cannot desynchronise them.
// ============================================================================

import type {
  CaptionBlock,
  CaptionStyle,
  CropSettings,
  OutputFormat,
  Quality,
  Segment,
  TransitionPoint,
  ZoomEffect,
} from '../types';
import { buildCaptionCues } from './captionTiming';
import { buildAss } from './assSubtitles';
import { fontAssetFor, type FontAsset } from './captionFonts';
import {
  encodeArgs,
  outputDims,
  r,
  segmentAudioFilter,
  segmentVideoFilter,
  videoEncodeArgs,
  xfadeFallback,
  xfadeName,
  zoomExpr,
  type Dims,
} from './ffmpegFilters';

const XFADE_MIN_S = 0.05;
const XFADE_MAX_S = 1.0;

export interface SegmentSpec {
  srcStart: number; // source seconds
  srcDuration: number; // source seconds
  outDuration: number; // output seconds (srcDuration / speed) — for xfade offsets
  vf: string;
  af: string;
  outName: string;
  /**
   * ASS caption file content for THIS segment only — cues rebased so the
   * segment's own output timeline starts at 0. null when captions are off or no
   * cue lands inside this segment (then `vf` carries no `ass=` filter either).
   */
  ass: string | null;
  /** FS filename the worker must write `ass` to; referenced by `vf`. */
  assName: string | null;
}

export interface XfadeStep {
  name: string; // primary xfade transition
  fallback: string; // safe transition if the build rejects the primary
  durationS: number;
}

// Per-pass encode args. The export is a CHAIN of encodes — combined: segment
// renders -> [xfade join]; clips: one clip render each — and only the LAST pass
// in the chain produces the file the user keeps. Every pass upstream of it is an
// intermediate that gets re-encoded and deleted, so it must not pay for the
// user's chosen x264 preset. The plan (which knows whether transitions are on)
// resolves that here; the worker just uses the field named after the pass it is
// running.
//
// Captions no longer add a pass: they burn inside the segment/clip render, so a
// captioned export with no transitions makes the SEGMENT render the final
// quality pass (the join is a stream copy).
interface PlanBase {
  width: number;
  height: number;
  /** Segment / clip render pass (video+audio). */
  segmentEncode: string[];
  /** Segment / clip render pass, video-only (silent sources). */
  segmentVideoEncode: string[];
  /** xfade join pass (video+audio); combined-with-transitions only. */
  joinEncode: string[];
  /** xfade join pass, video-only. */
  joinVideoEncode: string[];
  fonts: FontAsset[]; // fonts to write into FFmpeg FS /fonts (0 or 1)
  hasAudio: boolean;
}

export interface CombinedPlan extends PlanBase {
  kind: 'combined';
  segments: SegmentSpec[];
  /** Groups of indices into `segments`; consecutive segments with no transition. */
  runs: number[][];
  /** length runs.length-1; transition between run i and run i+1. */
  xfades: XfadeStep[];
  hasTransitions: boolean;
  outputName: string;
}

export interface ClipItem {
  spec: SegmentSpec;
  outputName: string;
}

export interface ClipsPlan extends PlanBase {
  kind: 'clips';
  clips: ClipItem[];
}

export type ExportPlan = CombinedPlan | ClipsPlan;

export interface BuildPlanInput {
  mode: 'combined' | 'clips';
  segments: Segment[]; // kept segments (source time), full set
  selectedClipIndices: number[];
  format: OutputFormat;
  speed: number;
  crop: CropSettings;
  quality: Quality;
  caption: CaptionStyle;
  transitions: TransitionPoint[];
  zooms: ZoomEffect[];
  captionBlocks: CaptionBlock[];
  srcWidth: number;
  srcHeight: number;
  hasAudio: boolean;
  baseName: string; // original file name without extension
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** True when the format actually crops the source (drives crop position use). */
function formatCrops(format: OutputFormat, srcW: number, srcH: number): boolean {
  if (format === 'original') return false;
  const src = srcW > 0 && srcH > 0 ? srcW / srcH : 16 / 9;
  const target = format === 'vertical' ? 9 / 16 : 16 / 9;
  return Math.abs(src - target) > 0.02;
}

/**
 * ASS file for ONE segment's own window, or null when nothing lands in it.
 *
 * The rebasing trick: build the cues against a single-segment timeline
 * ([seg.start, seg.end] as the only kept range), so buildCaptionCues' output
 * time is measured from this segment's start rather than from the whole
 * export's. Words removed by cuts outside this window simply do not survive.
 * Karaoke \k values are per-Dialogue-line DURATIONS (centiseconds), so shifting
 * cue start/end is all the rebasing that is needed; the per-cue `scale`
 * (\fscx/\fscy) rides on the unchanged cue objects.
 */
function assForSegment(
  seg: Segment,
  input: BuildPlanInput,
  dims: Dims,
  assFamily: string,
): string | null {
  const speed = input.speed > 0 ? input.speed : 1;
  const local: Segment[] = [{ index: 0, start: seg.start, end: seg.end }];
  const cues = buildCaptionCues(input.captionBlocks, local, speed, {
    sizePct: input.caption.sizePct,
    frameAspect: dims.w / dims.h,
    style: input.caption,
  });
  if (cues.length === 0) return null;
  return buildAss(cues, input.caption, dims, assFamily);
}

function makeSegmentSpec(
  seg: Segment,
  outName: string,
  input: BuildPlanInput,
  dims: Dims,
  useFps: boolean,
  ass: string | null,
  assName: string | null,
): SegmentSpec {
  const speed = input.speed > 0 ? input.speed : 1;
  const cropping = formatCrops(input.format, input.srcWidth, input.srcHeight);
  const cropXf = cropping ? input.crop.xPct / 100 : 0.5;
  const cropYf = cropping ? input.crop.yPct / 100 : 0.5;
  const segZooms = input.zooms.filter((z) => z.segmentIndex === seg.index);
  const zoom = zoomExpr(segZooms, seg.start, speed);
  let vf = segmentVideoFilter({
    speed,
    dims,
    cropXf,
    cropYf,
    fps: useFps ? 30 : null,
    zoom,
  });
  // Burn this segment's captions in the SAME pass. Last in the chain: the frame
  // is already at the final WxH by then, which is what the ASS PlayRes assumes.
  // The `ass` arg uses ':' separators only and the filenames are comma-free, so
  // appending it to the comma-separated chain needs no extra quoting.
  if (ass && assName) vf = `${vf},ass=${assName}:fontsdir=fonts`;
  const af = segmentAudioFilter(speed);
  const srcDuration = Math.max(0, seg.end - seg.start);
  return {
    srcStart: seg.start,
    srcDuration,
    outDuration: srcDuration / speed,
    vf,
    af,
    outName,
    ass: ass && assName ? ass : null,
    assName: ass && assName ? assName : null,
  };
}

/** Build the complete, deterministic export plan. */
export function buildExportPlan(input: BuildPlanInput): ExportPlan {
  const dims = outputDims(input.format, input.srcWidth, input.srcHeight);
  const captionsOn = input.caption.preset !== 'none';
  const fonts: FontAsset[] = captionsOn ? [fontAssetFor(input.caption.font)] : [];
  const assFamily = fonts[0]?.assFamily ?? 'Inter';

  // Transition map is needed up front: it decides whether the segment renders
  // are intermediates (a later xfade join re-encodes them) or the final pass.
  const trByBoundary = new Map<number, TransitionPoint>();
  if (input.mode === 'combined') {
    for (const t of input.transitions) {
      if (t.type === 'none') continue;
      if (t.boundaryIndex >= 0 && t.boundaryIndex <= input.segments.length - 2) {
        trByBoundary.set(t.boundaryIndex, t);
      }
    }
  }
  const hasTransitions = trByBoundary.size > 0;

  // A pass is intermediate when something downstream re-encodes its output. With
  // captions burned in-render the ONLY downstream re-encode left is the xfade
  // join, so without transitions the segment render is the final quality pass.
  const segmentsAreIntermediate = hasTransitions;

  const base: PlanBase = {
    width: dims.w,
    height: dims.h,
    segmentEncode: encodeArgs(input.quality, segmentsAreIntermediate),
    segmentVideoEncode: videoEncodeArgs(input.quality, segmentsAreIntermediate),
    // Nothing follows the join any more — it is always the final pass.
    joinEncode: encodeArgs(input.quality),
    joinVideoEncode: videoEncodeArgs(input.quality),
    fonts,
    hasAudio: input.hasAudio,
  };

  if (input.mode === 'clips') {
    const selected = new Set(input.selectedClipIndices);
    const chosen = input.segments.filter((s) => selected.has(s.index));
    const clips: ClipItem[] = chosen.map((seg, i) => {
      // Captions are rebased to this clip's own timeline (starts at 0) and burn
      // inside the clip's single render pass.
      const ass = captionsOn ? assForSegment(seg, input, dims, assFamily) : null;
      const spec = makeSegmentSpec(
        seg,
        `clip_src_${pad(i, 3)}.mp4`,
        input,
        dims,
        false,
        ass,
        ass ? `captions-${pad(i, 3)}.ass` : null,
      );
      return {
        spec,
        outputName: `${input.baseName}-clip-${pad(i + 1, 2)}.mp4`,
      };
    });
    return { kind: 'clips', ...base, clips };
  }

  // ---- Combined -----------------------------------------------------------
  // (trByBoundary / hasTransitions were resolved above — they feed the
  // intermediate-vs-final encode decision.)
  const segs = input.segments;

  const segments: SegmentSpec[] = segs.map((seg, i) => {
    const ass = captionsOn ? assForSegment(seg, input, dims, assFamily) : null;
    return makeSegmentSpec(
      seg,
      `seg${pad(i, 3)}.mp4`,
      input,
      dims,
      hasTransitions,
      ass,
      ass ? `captions-${pad(i, 3)}.ass` : null,
    );
  });

  // Group into runs split at transition boundaries; collect xfade steps.
  const runs: number[][] = [];
  const xfades: XfadeStep[] = [];
  let cur: number[] = segments.length ? [0] : [];
  for (let i = 0; i < segments.length - 1; i++) {
    const tp = trByBoundary.get(i);
    if (tp) {
      runs.push(cur);
      cur = [i + 1];
      xfades.push({
        name: xfadeName(tp.type),
        fallback: xfadeFallback(tp.type),
        durationS: Math.min(XFADE_MAX_S, Math.max(XFADE_MIN_S, tp.durationMs / 1000)),
      });
    } else {
      cur.push(i + 1);
    }
  }
  if (cur.length) runs.push(cur);

  return {
    kind: 'combined',
    ...base,
    segments,
    runs,
    xfades,
    hasTransitions,
    outputName: `${input.baseName}-sharpcut.mp4`,
  };
}

/**
 * argv for ONE segment / clip render — the single source of truth for that
 * command. The wasm worker executes what this returns, and the native bridge
 * (BACKDROP/backdrop/sharpcut_export.py::_segment_args) mirrors it argument for
 * argument; keep the two in lockstep.
 *
 * ORDERING IS LOAD-BEARING: `-ss` AND `-t` are both INPUT options and must both
 * sit BEFORE `-i`. `spec.srcDuration` is a SOURCE-side window ("read this many
 * seconds starting at srcStart"), and only pre-`-i` does FFmpeg read it that
 * way. Placed after `-i`, `-t` caps the OUTPUT duration instead — silently
 * correct at speed == 1 (setpts is identity, so in == out) and wrong at every
 * other speed. At 1.5x the render kept going until it had EMITTED srcDuration
 * seconds, so it consumed 1.5x the intended source and came out 1.5x too long,
 * while `spec.outDuration` (srcDuration / speed) — which drives the xfade
 * offsets in the join — still described the correct, shorter segment. Result:
 * over-long segments, transitions landing in the wrong place, and a container
 * padded past its own video stream.
 *
 * Pre-input `-ss` keeps cuts frame-accurate here: FFmpeg seeks to the preceding
 * keyframe and then decodes-and-discards to the exact timestamp, and every
 * segment is re-encoded, so there is no keyframe-snapping penalty.
 */
export function segmentRenderArgs(spec: SegmentSpec, plan: ExportPlan): string[] {
  const args = [
    '-ss', String(r(spec.srcStart)),
    '-t', String(r(spec.srcDuration)),
    '-i', 'input',
    '-vf', spec.vf,
  ];
  if (plan.hasAudio) {
    args.push('-af', spec.af, ...plan.segmentEncode);
  } else {
    args.push('-an', ...plan.segmentVideoEncode, '-movflags', '+faststart');
  }
  args.push(spec.outName);
  return args;
}

/** Strip a file extension for use as the export base name. */
export function baseNameOf(fileName: string): string {
  const clean = fileName.replace(/\.[^./\\]+$/, '').trim();
  return clean.length ? clean : 'sharpcut';
}
