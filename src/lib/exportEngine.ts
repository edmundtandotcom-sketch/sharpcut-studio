// ============================================================================
// lib/exportEngine.ts — main-thread orchestration for the FFmpeg export.
//
// Validates settings, builds the deterministic ExportPlan (lib/exportPlan.ts),
// and streams the job to workers/ffmpeg.worker.ts via the workerClient
// protocol. Keeps a singleton worker so the loaded ffmpeg core is reused across
// exports. Cancellation flows through an AbortController -> workerClient ->
// worker terminate.
//
// This module holds NO React; the ExportController component drives it.
// ============================================================================

import type {
  CaptionBlock,
  Cut,
  ProjectMeta,
  Segment,
  StudioSettings,
} from '../types';
import { keptSegments } from './cuts';
import { baseNameOf, buildExportPlan, type ExportPlan } from './exportPlan';
import { runJob } from '../workers/workerClient';

export interface ExportDeps {
  file: File;
  meta: ProjectMeta;
  cuts: Cut[];
  captionBlocks: CaptionBlock[];
  studio: StudioSettings;
}

export interface ExportResultFile {
  name: string;
  data: Uint8Array;
}

export interface ExportCallbacks {
  onProgress: (stage: string, pct: number) => void;
  onResult: (files: ExportResultFile[]) => void;
  onError: (message: string) => void;
}

export interface ExportHandle {
  cancel: () => void;
}

// wasm32 address space is ~2 GB; input + segments + output must fit. Warn when
// the input alone risks that budget (2.5x is a rough peak-usage multiplier).
const MEMORY_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
const MEMORY_MULTIPLIER = 2.5;

/** Non-null friendly message when the export is at risk of running out of memory. */
export function memoryRisk(file: File, mode: StudioSettings['mode']): string | null {
  if (file.size * MEMORY_MULTIPLIER <= MEMORY_LIMIT_BYTES) return null;
  const gb = (file.size / (1024 * 1024 * 1024)).toFixed(1);
  const suggestion =
    mode === 'combined'
      ? 'Consider switching to "Individual clips" mode or Standard quality, which use far less memory.'
      : 'Consider Standard quality, or export fewer clips at a time.';
  return `This is a large video (${gb} GB). A combined in-browser export may run out of memory and fail. ${suggestion} Continue anyway?`;
}

export interface Validation {
  ok: boolean;
  error?: string;
  segments: Segment[];
}

/** Validate export settings before doing any work. */
export function validateExport(deps: ExportDeps): Validation {
  const { meta, cuts, studio } = deps;
  const duration = meta?.duration ?? 0;
  if (!(duration > 0)) {
    return { ok: false, error: 'This project has no readable duration to export.', segments: [] };
  }
  const segments = keptSegments(cuts, duration);
  if (segments.length === 0) {
    return {
      ok: false,
      error: 'Nothing to export — every part of the video is inside a removed range. Restore some edits first.',
      segments: [],
    };
  }
  if (studio.mode === 'clips') {
    const valid = new Set(segments.map((s) => s.index));
    const chosen = studio.selectedClipIndices.filter((i) => valid.has(i));
    if (chosen.length === 0) {
      return {
        ok: false,
        error: 'Select at least one clip to export, or switch to Combined mode.',
        segments,
      };
    }
  }
  if (!(studio.speed > 0)) {
    return { ok: false, error: 'Playback speed must be greater than zero.', segments };
  }
  return { ok: true, segments };
}

export function buildPlanFor(deps: ExportDeps, segments: Segment[]): ExportPlan {
  const { meta, studio, captionBlocks } = deps;
  return buildExportPlan({
    mode: studio.mode,
    segments,
    selectedClipIndices: studio.selectedClipIndices,
    format: studio.format,
    speed: studio.speed,
    crop: studio.crop,
    quality: studio.quality,
    caption: studio.caption,
    transitions: studio.transitions,
    zooms: studio.zooms,
    captionBlocks,
    srcWidth: meta.width,
    srcHeight: meta.height,
    hasAudio: meta.hasAudio,
    baseName: baseNameOf(meta.fileName),
  });
}

// Singleton export worker (reused so the ffmpeg core stays warm).
let worker: Worker | null = null;
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/ffmpeg.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

/**
 * Start an export. Returns a handle whose cancel() aborts the running job.
 * Callers own store side effects (progress/results/error) via the callbacks.
 */
export function startExport(deps: ExportDeps, cb: ExportCallbacks): ExportHandle {
  const validation = validateExport(deps);
  if (!validation.ok) {
    cb.onError(validation.error ?? 'Export settings are invalid.');
    return { cancel: () => {} };
  }

  let plan: ExportPlan;
  try {
    plan = buildPlanFor(deps, validation.segments);
  } catch (err) {
    cb.onError(err instanceof Error ? err.message : 'Could not build the export plan.');
    return { cancel: () => {} };
  }

  const controller = new AbortController();
  const jobType = plan.kind === 'clips' ? 'export-clips' : 'export-combined';

  runJob<{ files: ExportResultFile[]; threads: boolean }>(
    getWorker(),
    jobType,
    { plan, file: deps.file },
    {
      signal: controller.signal,
      onProgress: (e) => cb.onProgress(e.stage ?? 'Working', typeof e.pct === 'number' ? e.pct : 0),
    },
  )
    .then((payload) => {
      if (!payload || !Array.isArray(payload.files) || payload.files.length === 0) {
        cb.onError('Export produced no output file.');
        return;
      }
      cb.onResult(payload.files);
    })
    .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') {
        cb.onError('cancelled');
      } else {
        cb.onError(err instanceof Error ? err.message : 'Export failed.');
      }
    });

  return { cancel: () => controller.abort() };
}
