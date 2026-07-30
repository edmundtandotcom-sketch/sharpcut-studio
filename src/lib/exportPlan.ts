// ============================================================================
// lib/exportPlan.ts — PURE, deterministic ExportPlan builder. Turns the store
// snapshot (kept segments + studio settings + caption blocks) into the exact
// per-segment FFmpeg commands, join plan, and ASS caption file(s) the export
// worker executes. No React, no ffmpeg, no side effects.
//
// Combined export passes (worker): render each kept segment -> join -> [caption
// burn]. Join is a concat-demuxer copy when there are no transitions; with
// transitions the segments are grouped into runs (concat copy) and the runs are
// chained with xfade/acrossfade. Captions burn in one final libass pass.
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
}

export interface XfadeStep {
  name: string; // primary xfade transition
  fallback: string; // safe transition if the build rejects the primary
  durationS: number;
}

// Per-pass encode args. The export is a CHAIN of encodes — combined:
// segment renders -> [xfade join] -> [caption burn]; clips: clip render ->
// [caption burn] — and only the LAST pass in the chain produces the file the
// user keeps. Every pass upstream of it is an intermediate that gets re-encoded
// and deleted, so it must not pay for the user's chosen x264 preset. The plan
// (which knows whether captions/transitions are on) resolves that here; the
// worker just uses the field named after the pass it is running.
interface PlanBase {
  width: number;
  height: number;
  /** FINAL-pass (video+audio) encode args. */
  encode: string[];
  /** FINAL-pass video-only encode args — used by the caption burn. */
  videoEncode: string[];
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
  ass: string | null; // full ASS file, or null when captions are off
  outputName: string;
}

export interface ClipItem {
  spec: SegmentSpec;
  ass: string | null;
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

function makeSegmentSpec(
  seg: Segment,
  outName: string,
  input: BuildPlanInput,
  dims: Dims,
  useFps: boolean,
): SegmentSpec {
  const speed = input.speed > 0 ? input.speed : 1;
  const cropping = formatCrops(input.format, input.srcWidth, input.srcHeight);
  const cropXf = cropping ? input.crop.xPct / 100 : 0.5;
  const cropYf = cropping ? input.crop.yPct / 100 : 0.5;
  const segZooms = input.zooms.filter((z) => z.segmentIndex === seg.index);
  const zoom = zoomExpr(segZooms, seg.start, speed);
  const vf = segmentVideoFilter({
    speed,
    dims,
    cropXf,
    cropYf,
    fps: useFps ? 30 : null,
    zoom,
  });
  const af = segmentAudioFilter(speed);
  const srcDuration = Math.max(0, seg.end - seg.start);
  return {
    srcStart: seg.start,
    srcDuration,
    outDuration: srcDuration / speed,
    vf,
    af,
    outName,
  };
}

/** Build the complete, deterministic export plan. */
export function buildExportPlan(input: BuildPlanInput): ExportPlan {
  const dims = outputDims(input.format, input.srcWidth, input.srcHeight);
  const captionsOn = input.caption.preset !== 'none';
  const fonts: FontAsset[] = captionsOn ? [fontAssetFor(input.caption.font)] : [];
  const assFamily = fonts[0]?.assFamily ?? 'Inter';
  const speed = input.speed > 0 ? input.speed : 1;

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

  // A pass is intermediate when something downstream re-encodes its output.
  const segmentsAreIntermediate = captionsOn || hasTransitions;

  const base: PlanBase = {
    width: dims.w,
    height: dims.h,
    encode: encodeArgs(input.quality),
    videoEncode: videoEncodeArgs(input.quality),
    segmentEncode: encodeArgs(input.quality, segmentsAreIntermediate),
    segmentVideoEncode: videoEncodeArgs(input.quality, segmentsAreIntermediate),
    // The join is final unless a caption burn follows it.
    joinEncode: encodeArgs(input.quality, captionsOn),
    joinVideoEncode: videoEncodeArgs(input.quality, captionsOn),
    fonts,
    hasAudio: input.hasAudio,
  };

  if (input.mode === 'clips') {
    const selected = new Set(input.selectedClipIndices);
    const chosen = input.segments.filter((s) => selected.has(s.index));
    const clips: ClipItem[] = chosen.map((seg, i) => {
      const spec = makeSegmentSpec(seg, `clip_src_${pad(i, 3)}.mp4`, input, dims, false);
      let ass: string | null = null;
      if (captionsOn) {
        // Rebase captions to this single clip's own timeline (starts at 0).
        const local: Segment[] = [{ index: 0, start: seg.start, end: seg.end }];
        const cues = buildCaptionCues(input.captionBlocks, local, speed, {
          sizePct: input.caption.sizePct,
          frameAspect: dims.w / dims.h,
          style: input.caption,
        });
        ass = buildAss(cues, input.caption, dims, assFamily);
      }
      return {
        spec,
        ass,
        outputName: `${input.baseName}-clip-${pad(i + 1, 2)}.mp4`,
      };
    });
    return { kind: 'clips', ...base, clips };
  }

  // ---- Combined -----------------------------------------------------------
  // (trByBoundary / hasTransitions were resolved above — they feed the
  // intermediate-vs-final encode decision.)
  const segs = input.segments;

  const segments: SegmentSpec[] = segs.map((seg, i) =>
    makeSegmentSpec(seg, `seg${pad(i, 3)}.mp4`, input, dims, hasTransitions),
  );

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

  let ass: string | null = null;
  if (captionsOn) {
    const cues = buildCaptionCues(input.captionBlocks, segs, speed, {
      sizePct: input.caption.sizePct,
      frameAspect: dims.w / dims.h,
      style: input.caption,
    });
    ass = buildAss(cues, input.caption, dims, assFamily);
  }

  return {
    kind: 'combined',
    ...base,
    segments,
    runs,
    xfades,
    hasTransitions,
    ass,
    outputName: `${input.baseName}-sharpcut.mp4`,
  };
}

/** Strip a file extension for use as the export base name. */
export function baseNameOf(fileName: string): string {
  const clean = fileName.replace(/\.[^./\\]+$/, '').trim();
  return clean.length ? clean : 'sharpcut';
}
