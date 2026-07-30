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
import {
  NoAudioError,
  TARGET_SAMPLE_RATE,
  chunkPcm,
  decodeAudioToPcm,
  type PcmChunk,
} from './audioDecode';
import { fingerprintKey, loadCheckpoint, saveChunk, saveStage } from './persist';
import {
  PACING_DEFAULTS,
  buildSuggestions,
  detectFillers,
  detectSilence,
  mergeChunkWords,
} from './suggest';

// ---- Chunking: two INDEPENDENT grids --------------------------------------
//
// (a) EXTRACT grid — how the FFmpeg worker pulls audio off a large file. Each
//     chunk costs one ffmpeg exec (seek + decode + FS round-trip), so this stays
//     coarse. It only affects extraction cost, never transcription accuracy.
const EXTRACT_CHUNK_LEN_S = 110;
const EXTRACT_OVERLAP_S = 5;
//
// (b) ASR grid — how the PCM is split for the Whisper worker. This MUST stay at
//     or under the model's own 30s window. transformers.js's ASR pipeline does
//     its OWN long-form re-chunking whenever the input is longer than
//     `chunk_length_s` (jump = window - 2*stride) and then stitches the
//     sub-windows back together with a longest-common-subsequence merge in
//     `tokenizer._decode_asr`. On real speech that merge silently DROPS whole
//     spans — a 110s chunk lost 10-28s stretches mid-chunk even though the same
//     audio transcribes perfectly when fed in as a single <=30s window. So we
//     make OUR chunking the only chunking: every buffer handed to the model is
//     short enough to be one single forward pass with no internal windowing.
//     28s (not 30s) leaves margin so float/rounding can never push a call over.
//
//     NOTE: this is a different bug from the chunk-SEAM garbling fixed earlier;
//     that was about the handover BETWEEN our chunks (see chunkSeamBoundary),
//     this is content lost INSIDE one of our chunks.
const CHUNK_LEN_S = 28;
// 4s handover window: mergeChunkWords picks the seam inside it by searching for
// the largest inter-word pause, so it needs to be wide enough to usually contain
// a real silence. ~17% extra audio per chunk — acceptable, and total model
// forward passes actually DROP versus the old scheme (the library's internal
// 20s jump produced more 30s windows than our 24s step does).
const CHUNK_OVERLAP_S = 4;

// Fast path (main-thread decodeAudioData) is only safe for smaller/shorter
// files — decodeAudioData loads the whole file into one ArrayBuffer and Chrome
// fails the decode on very large inputs. Above either bound we switch to the
// bounded-chunk FFmpeg extraction path (SPEC: >20-minute videos must use
// bounded-chunk audio analysis).
const SMALL_MAX_BYTES = 100 * 1024 * 1024; // 100 MB
const SMALL_MAX_DURATION_S = 12 * 60; // 12 minutes

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

// Singleton ffmpeg worker for the large-file audio-extraction path. Separate
// from the export worker so analysis and export never contend for one instance.
let ffmpegWorker: Worker | null = null;
function getFfmpegWorker(): Worker {
  if (!ffmpegWorker) {
    ffmpegWorker = new Worker(new URL('../workers/ffmpeg.worker.ts', import.meta.url), {
      type: 'module',
    });
  }
  return ffmpegWorker;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
}

interface ExtractChunkMsg {
  chunkIndex: number;
  start: number;
  total: number;
  pcm: Float32Array;
}

/**
 * Stage-1 large-file path: extract the audio track in bounded chunks via the
 * FFmpeg worker (EXTRACT grid), reconstructing the full 16kHz mono PCM by
 * writing each chunk's samples at their absolute offset — overlaps carry
 * identical audio, so overwriting is exact. Only one chunk's PCM is in flight
 * worker-side; each arriving buffer is copied into the master and dropped.
 *
 * The transcription chunks are NOT taken from this grid — the caller re-splits
 * the master PCM on the (much finer) ASR grid, so extraction cost and model
 * window size are decoupled.
 */
async function extractLargeAudio(
  file: File,
  duration: number,
  signal: AbortSignal,
  onChunk: (chunkIndex: number, total: number) => void,
  onPct: (pct: number) => void,
): Promise<{ pcm: Float32Array; sampleRate: number; writtenSamples: number }> {
  const sampleRate = TARGET_SAMPLE_RATE;
  const full = new Float32Array(Math.max(1, Math.ceil(duration * sampleRate)));
  let writtenSamples = 0;

  try {
    await runJob(
      getFfmpegWorker(),
      'extract-audio',
      { file, chunkS: EXTRACT_CHUNK_LEN_S, overlapS: EXTRACT_OVERLAP_S, duration },
      {
        signal,
        onProgress: (e) => {
          const d = e.data as ExtractChunkMsg | undefined;
          if (d && d.pcm) {
            const offset = Math.round(d.start * sampleRate);
            const room = full.length - offset;
            if (room > 0) {
              const src = d.pcm.length > room ? d.pcm.subarray(0, room) : d.pcm;
              full.set(src, offset);
              // A worker-side retry (MT hang → single-thread restart re-emits
              // chunks from 0) rewrites the same offsets, so max() not +=.
              writtenSamples = Math.max(writtenSamples, offset + src.length);
            }
            onChunk(d.chunkIndex, d.total);
          } else if (typeof e.pct === 'number') {
            onPct(e.pct);
          }
        },
      },
    );
  } catch (err) {
    // The worker signals a genuinely silent file with the typed 'no-audio'
    // message; surface it as NoAudioError so the UI is honest.
    if (err instanceof Error && err.message === 'no-audio') throw new NoAudioError();
    throw err;
  }

  return { pcm: full, sampleRate, writtenSamples };
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

  const emit = (
    stage: 1 | 2 | 3 | 4 | 5,
    stagePct: number,
    eta?: [number, number],
    labelOverride?: string,
  ): void => {
    onProgress({
      stage,
      stageLabel: labelOverride ?? STAGE_LABELS[stage - 1],
      pct: Math.round(overallPct(stage, stagePct)),
      elapsedS: (Date.now() - t0) / 1000,
      etaRangeS: eta,
    });
  };

  // ---- Stage 1: obtain 16kHz mono PCM + transcription chunks ---------------
  // Small/short files: fast main-thread decodeAudioData. Large/long files:
  // bounded-chunk extraction via the FFmpeg worker (decodeAudioData cannot
  // survive very large inputs — that failure was the reported bug).
  emit(1, 0);
  const useLargePath = file.size > SMALL_MAX_BYTES || meta.duration > SMALL_MAX_DURATION_S;
  let pcm: Float32Array;
  let sampleRate: number;
  let duration: number;
  // Samples of `pcm` that actually carry audio (the large path allocates from
  // the container duration, which can slightly over-run the real track).
  let audioSamples: number;
  if (useLargePath) {
    let extractLabel = STAGE_LABELS[0];
    const res = await extractLargeAudio(
      file,
      meta.duration,
      signal,
      (chunkIndex, total) => {
        extractLabel = `${STAGE_LABELS[0]} — chunk ${chunkIndex + 1}/${total}`;
        emit(1, ((chunkIndex + 1) / total) * 100, undefined, extractLabel);
      },
      (pct) => emit(1, pct, undefined, extractLabel),
    );
    pcm = res.pcm;
    sampleRate = res.sampleRate;
    duration = meta.duration;
    audioSamples = res.writtenSamples || res.pcm.length;
  } else {
    const decoded = await decodeAudioToPcm(file, (pct) => emit(1, pct), signal);
    pcm = decoded.pcm;
    sampleRate = decoded.sampleRate;
    duration = decoded.duration;
    audioSamples = decoded.pcm.length;
  }
  // Both paths split on the SAME ASR grid, so the model never has to re-window
  // internally (see CHUNK_LEN_S). subarray() is a view — chunkPcm copies.
  const chunks: PcmChunk[] = chunkPcm(
    audioSamples < pcm.length ? pcm.subarray(0, audioSamples) : pcm,
    sampleRate,
    CHUNK_LEN_S,
    CHUNK_OVERLAP_S,
  );
  throwIfAborted(signal);
  emit(1, 100);

  // Checkpointed words are stored per chunk INDEX, so the key must also pin the
  // chunk grid — changing CHUNK_LEN_S/CHUNK_OVERLAP_S remaps index -> time and
  // would otherwise resurrect stale, misaligned words for an already-seen file.
  const fpKey = `${fingerprintKey({
    fileName: meta.fileName,
    size: file.size,
    mtime: file.lastModified,
    duration,
  })}|c${CHUNK_LEN_S}x${CHUNK_OVERLAP_S}`;
  const checkpoint = await loadCheckpoint(fpKey);
  const savedWords = new Map(checkpoint.chunks);

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
