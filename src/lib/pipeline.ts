// ============================================================================
// lib/pipeline.ts — the analysis pipeline orchestrator. Runs the 5 stages in
// order (decode -> load whisper -> transcribe+merge -> silence+filler ->
// build cuts), checkpointing each transcription chunk to IndexedDB so a
// cancel/crash/retry resumes rather than restarting.
// ============================================================================

import type {
  AnalysisProgress,
  CaptionBlock,
  Cut,
  PacingPreset,
  ProjectMeta,
  WordStamp,
} from '../types';
import { runJob } from '../workers/workerClient';
import { chunkPcm, decodeAudioToPcm } from './audioDecode';
import { fingerprintKey, loadCheckpoint, saveChunk, saveStage } from './persist';
import {
  PACING_DEFAULTS,
  buildSuggestions,
  detectFillers,
  detectSilence,
  mergeChunkWords,
} from './suggest';

const CHUNK_OVERLAP_S = 2;

/** Stage labels shown in the analysis UI (SPEC "Required processing stages"). */
export const STAGE_LABELS: string[] = [
  'Read audio track',
  'Load private speech AI',
  'Map words to the timeline',
  'Detect silence and filler words',
  'Build suggested cuts',
];

// Overall-progress weighting across the 5 stages (sums to 100).
const STAGE_WEIGHTS = [10, 20, 55, 8, 7];

function cumulativeBefore(stage: number): number {
  let sum = 0;
  for (let i = 0; i < stage - 1; i++) sum += STAGE_WEIGHTS[i];
  return sum;
}

function overallPct(stage: number, stagePct: number): number {
  const w = STAGE_WEIGHTS[stage - 1] ?? 0;
  return cumulativeBefore(stage) + (w * Math.min(100, Math.max(0, stagePct))) / 100;
}

export interface PipelineDeps {
  file: File;
  meta: ProjectMeta;
  pacing: PacingPreset;
  signal: AbortSignal;
}

export interface PipelineResult {
  words: WordStamp[];
  captionBlocks: CaptionBlock[];
  cuts: Cut[];
  duration: number;
}

// Singleton worker, reused across retries so the cached model isn't re-instantiated.
let transcribeWorker: Worker | null = null;
function getTranscribeWorker(): Worker {
  if (!transcribeWorker) {
    transcribeWorker = new Worker(new URL('../workers/transcribe.worker.ts', import.meta.url), {
      type: 'module',
    });
  }
  return transcribeWorker;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
}

/**
 * Run the full analysis pipeline. Emits AnalysisProgress via onProgress; the UI
 * owns the elapsed-second ticker, so elapsedS here is informational.
 */
export async function runAnalysis(
  deps: PipelineDeps,
  onProgress: (p: AnalysisProgress) => void,
): Promise<PipelineResult> {
  const { file, meta, pacing, signal } = deps;
  const t0 = Date.now();
  let transcribeStart = 0;

  const emit = (stage: 1 | 2 | 3 | 4 | 5, stagePct: number, eta?: [number, number]): void => {
    onProgress({
      stage,
      stageLabel: STAGE_LABELS[stage - 1],
      pct: Math.round(overallPct(stage, stagePct)),
      elapsedS: (Date.now() - t0) / 1000,
      etaRangeS: eta,
    });
  };

  // ---- Stage 1: decode audio to 16kHz mono PCM ----------------------------
  emit(1, 0);
  const { pcm, sampleRate, duration } = await decodeAudioToPcm(
    file,
    (pct) => emit(1, pct),
    signal,
  );
  throwIfAborted(signal);
  emit(1, 100);

  const fpKey = fingerprintKey({
    fileName: meta.fileName,
    size: file.size,
    mtime: file.lastModified,
    duration,
  });
  const checkpoint = await loadCheckpoint(fpKey);
  const savedWords = new Map(checkpoint.chunks);

  const chunks = chunkPcm(pcm, sampleRate, 110, CHUNK_OVERLAP_S);
  const pending = chunks.filter((c) => !savedWords.has(c.index));

  // ---- Stages 2 & 3: load whisper + transcribe pending chunks -------------
  emit(2, 0);
  if (pending.length > 0) {
    const worker = getTranscribeWorker();
    const transfer = pending.map((c) => c.pcm.buffer);
    await runJob(
      worker,
      'transcribe',
      { chunks: pending.map((c) => ({ index: c.index, start: c.start, pcm: c.pcm })) },
      {
        signal,
        transfer,
        onProgress: (e) => {
          if (e.stage === 'model') {
            emit(2, e.pct ?? 0);
            return;
          }
          if (e.stage === 'transcribe') {
            if (!transcribeStart) transcribeStart = Date.now();
            const d = e.data as { chunkIndex: number; words: WordStamp[] } | undefined;
            if (d) {
              savedWords.set(d.chunkIndex, d.words);
              void saveChunk(fpKey, d.chunkIndex, d.words);
            }
            const pct = e.pct ?? 0;
            let eta: [number, number] | undefined;
            const frac = pct / 100;
            if (frac >= 0.1) {
              const elapsed = (Date.now() - transcribeStart) / 1000;
              const remainingTranscribe = Math.max(0, elapsed / frac - elapsed);
              const remainingOther = 2 + duration * 0.001; // detection + build, rough
              const rem = remainingTranscribe + remainingOther;
              eta = [Math.round(rem * 0.7), Math.round(rem * 1.3)];
            }
            emit(3, pct, eta);
          }
        },
      },
    );
  } else {
    emit(3, 100);
  }
  throwIfAborted(signal);
  emit(3, 100);
  await saveStage(fpKey, 3);

  // Merge per-chunk words (drift-free overlap dedup).
  const ordered = chunks.map((c) => savedWords.get(c.index) ?? []);
  const words = mergeChunkWords(
    ordered,
    chunks.map((c) => c.start),
    CHUNK_OVERLAP_S,
  );

  // ---- Stage 4: silence + filler detection --------------------------------
  emit(4, 10);
  const p = PACING_DEFAULTS[pacing];
  const silence = detectSilence(pcm, {
    sampleRate,
    minSilenceS: p.minSilenceS,
    keepBeforeS: p.keepBeforeS,
    keepAfterS: p.keepAfterS,
  });
  throwIfAborted(signal);
  emit(4, 55);
  const fillers = detectFillers(words, { activeThreshold: p.fillerActiveThreshold });
  emit(4, 100);
  await saveStage(fpKey, 4);

  // ---- Stage 5: build suggested cuts + caption blocks ---------------------
  emit(5, 20);
  const { cuts, captionBlocks } = buildSuggestions({ words, silence, fillers, duration });
  emit(5, 100);
  await saveStage(fpKey, 5);

  return { words, captionBlocks, cuts, duration };
}
