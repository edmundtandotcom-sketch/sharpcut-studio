// ============================================================================
// lib/thumbnailRender.ts — canvas rendering for the Thumbnail selector
// (Export Studio section 9). Pure-ish helpers (DOM canvas APIs only, no React,
// no ffmpeg) so a chosen source frame or uploaded image renders at EXACTLY the
// export's output geometry: same outputDims() and the same scale-to-fill+crop
// positioning the FFmpeg pipeline applies in ffmpegFilters.segmentVideoFilter.
//
// The two pipelines are mathematically equivalent, just expressed differently:
// FFmpeg scales the whole frame up to cover WxH then crops the overflow at a
// position fraction. Canvas instead computes the matching SOURCE-space crop
// rectangle directly (`coverSourceRect`) and draws it in one `drawImage` call —
// same result, one less intermediate buffer. Keep the two in sync if either
// changes.
// ============================================================================

import type { CropSettings, OutputFormat } from '../types';
import { outputDims } from './ffmpegFilters';

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
}

export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Cover-fit source rectangle: the sub-rect of a `srcW x srcH` image/frame that,
 * scaled to `targetW x targetH`, fully covers the target with no letterboxing —
 * positioned by `xf`/`yf` (0..1 fraction of the croppable overflow, 0.5 =
 * centred), mirroring FFmpeg's `crop=(iw-w)*xf:(ih-h)*yf` after a scale-to-fill.
 */
export function coverSourceRect(
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
  xf = 0.5,
  yf = 0.5,
): SourceRect {
  if (srcW <= 0 || srcH <= 0 || targetW <= 0 || targetH <= 0) {
    return { sx: 0, sy: 0, sw: srcW, sh: srcH };
  }
  const targetAspect = targetW / targetH;
  const srcAspect = srcW / srcH;
  let sw: number;
  let sh: number;
  if (srcAspect > targetAspect) {
    // Source is relatively wider than the target — crop its left/right edges.
    sh = srcH;
    sw = srcH * targetAspect;
  } else {
    // Source is relatively taller (or equal) — crop its top/bottom edges.
    sw = srcW;
    sh = srcW / targetAspect;
  }
  const sx = (srcW - sw) * clamp01(xf);
  const sy = (srcH - sh) * clamp01(yf);
  return { sx, sy, sw, sh };
}

/**
 * Draw one video frame or image onto `canvas` at the export's output pixel
 * dimensions (`outputDims(format, naturalW, naturalH)`), applying the same
 * scale-to-fill + crop-position transform the FFmpeg export burns in. Resizes
 * the canvas to match. `cropEnabled` mirrors `studioUtils.formatCrops` — pass
 * `false` (uploads, or `original` format) to always centre.
 */
export function drawThumbnailFrame(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  naturalW: number,
  naturalH: number,
  format: OutputFormat,
  crop: CropSettings,
  cropEnabled: boolean,
): boolean {
  if (naturalW <= 0 || naturalH <= 0) return false;
  const dims = outputDims(format, naturalW, naturalH);
  canvas.width = dims.w;
  canvas.height = dims.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const xf = cropEnabled ? crop.xPct / 100 : 0.5;
  const yf = cropEnabled ? crop.yPct / 100 : 0.5;
  const { sx, sy, sw, sh } = coverSourceRect(naturalW, naturalH, dims.w, dims.h, xf, yf);
  ctx.clearRect(0, 0, dims.w, dims.h);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, dims.w, dims.h);
  return true;
}
