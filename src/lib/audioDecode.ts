// ============================================================================
// lib/audioDecode.ts — decode a video file's audio to 16kHz mono Float32 PCM
// (main thread; keeps UI responsive because the heavy lifting is native
// decodeAudioData + OfflineAudioContext rendering) and split it into
// transcription chunks. Stage 1 of the analysis pipeline.
// ============================================================================

export const TARGET_SAMPLE_RATE = 16000;

export interface DecodedAudio {
  pcm: Float32Array; // mono, 16kHz
  sampleRate: number; // TARGET_SAMPLE_RATE
  duration: number; // seconds
}

/** Thrown when the file genuinely has no audio track. */
export class NoAudioError extends Error {
  constructor(message = 'This video has no audio track to analyse.') {
    super(message);
    this.name = 'NoAudioError';
  }
}

/**
 * Thrown when audio IS present but in-browser decoding failed (e.g. the file is
 * too large for a single decodeAudioData call, or the container/codec tripped
 * the decoder). Distinct from NoAudioError so the UI never misreports a
 * resource failure as "no audio track".
 */
export class DecodeError extends Error {
  constructor(
    message = "We couldn't decode this video's audio — the file may be too large for in-browser decoding; try a shorter export or re-encode.",
  ) {
    super(message);
    this.name = 'DecodeError';
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
}

type AudioCtor = typeof AudioContext;

function getAudioContextCtor(): AudioCtor {
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  const ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!ctor) throw new Error('Web Audio API is not available in this browser.');
  return ctor;
}

/**
 * Decode the file's audio to 16kHz mono PCM. Reports coarse progress 0..100.
 * The source ArrayBuffer is released as soon as decoding finishes.
 */
export async function decodeAudioToPcm(
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<DecodedAudio> {
  onProgress?.(2);
  let arrayBuffer: ArrayBuffer | null = await file.arrayBuffer();
  throwIfAborted(signal);
  onProgress?.(12);

  const Ctor = getAudioContextCtor();
  const decodeCtx = new Ctor();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  } catch {
    await decodeCtx.close().catch(() => {});
    // Audio presence was already confirmed at upload validation, so a decode
    // exception here is a resource/codec failure — NOT a missing audio track.
    throw new DecodeError();
  } finally {
    arrayBuffer = null; // release the source buffer
  }
  await decodeCtx.close().catch(() => {});
  throwIfAborted(signal);
  onProgress?.(55);

  if (decoded.length === 0 || decoded.duration === 0) throw new NoAudioError();

  // Resample to 16kHz mono via OfflineAudioContext (auto-downmixes to mono).
  const frameCount = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  throwIfAborted(signal);
  onProgress?.(100);

  const pcm = rendered.getChannelData(0);
  return { pcm, sampleRate: TARGET_SAMPLE_RATE, duration: decoded.duration };
}

export interface PcmChunk {
  index: number;
  start: number; // source seconds
  end: number;
  pcm: Float32Array; // a copy, so its buffer can be transferred to the worker
}

/**
 * Split PCM into chunks of <= chunkS seconds with overlapS seconds of overlap.
 * Each chunk's PCM is a fresh copy (slice) so its ArrayBuffer can be transferred
 * to the transcription worker without disturbing the master PCM (needed for
 * silence detection).
 */
export function chunkPcm(
  pcm: Float32Array,
  sampleRate: number,
  chunkS = 110,
  overlapS = 2,
): PcmChunk[] {
  const total = pcm.length / sampleRate;
  const step = Math.max(1, chunkS - overlapS);
  const chunks: PcmChunk[] = [];
  let index = 0;
  for (let start = 0; start < total; start += step) {
    const end = Math.min(start + chunkS, total);
    const a = Math.floor(start * sampleRate);
    const b = Math.floor(end * sampleRate);
    chunks.push({ index: index++, start, end, pcm: pcm.slice(a, b) });
    if (end >= total) break;
  }
  return chunks;
}
