// ============================================================================
// workers/transcribe.worker.ts — Whisper (base) speech-to-text via
// @huggingface/transformers v3, running off the main thread.
//
// TS/worker note: this project has a single tsconfig with the DOM lib, so we do
// NOT pull in `/// <reference lib="webworker" />` (its globals collide with DOM,
// the conflict P1 flagged). Instead we cast `self` to a minimal worker-scope
// shape. This keeps `npm run build` green under the existing tsconfig.
// ============================================================================

import { env, pipeline } from '@huggingface/transformers';

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
}
const ctx = self as unknown as WorkerScope;

// Models are fetched from the HF hub and cached by transformers.js itself.
env.allowLocalModels = false;

interface RunMessage {
  id: string;
  kind: 'run';
  type: string;
  payload: { chunks: { index: number; start: number; pcm: Float32Array }[] };
}
interface CancelMessage {
  kind: 'cancel';
}
type Incoming = RunMessage | CancelMessage | { kind?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let asr: any = null;
let currentDevice: 'webgpu' | 'wasm' | null = null;
let cancelled = false;

function post(message: Record<string, unknown>): void {
  ctx.postMessage(message);
}

async function loadModel(jobId: string): Promise<unknown> {
  if (asr) return asr;

  const hasWebGPU = typeof (navigator as unknown as { gpu?: unknown }).gpu !== 'undefined';
  // fp16 encoders are numerically unstable for whisper on some GPUs (garbage or
  // empty transcripts) — run the encoder at fp32, matching the official
  // transformers.js whisper-webgpu example.
  const attempts: { device: 'webgpu' | 'wasm'; dtype: string | Record<string, string> }[] = hasWebGPU
    ? [
        { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'fp32' } },
        { device: 'wasm', dtype: 'q8' },
      ]
    : [{ device: 'wasm', dtype: 'q8' }];

  let lastErr: unknown = null;
  for (const attempt of attempts) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const options: any = {
        device: attempt.device,
        dtype: attempt.dtype,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        progress_callback: (p: any) => {
          if (p && p.status === 'progress' && typeof p.progress === 'number') {
            post({ id: jobId, kind: 'progress', stage: 'model', pct: Math.round(p.progress) });
          }
        },
      };
      // The "_timestamped" export includes cross-attentions, required for word-level timestamps.
      asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base_timestamped', options);
      currentDevice = attempt.device;
      return asr;
    } catch (err) {
      lastErr = err;
      asr = null;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Failed to load the speech model.');
}

// Whisper's feature extractor has a fixed 30s receptive field, and it PADS
// anything shorter — so a sub-30s buffer is exactly one forward pass. We stay
// under this by construction (pipeline.ts CHUNK_LEN_S = 28).
const MODEL_WINDOW_S = 30;
const SAFE_WINDOW_S = 28;
const SAMPLE_RATE = 16_000;

/**
 * Split a chunk's PCM if it somehow exceeds the model window. This is a SAFETY
 * NET that should never fire: the pipeline guarantees <= 28s. Without it, an
 * over-long buffer would be silently TRUNCATED to 30s by the feature extractor
 * (audio lost with no error), which is the class of failure we are fixing.
 */
function splitToWindow(pcm: Float32Array): { offsetS: number; pcm: Float32Array }[] {
  if (pcm.length <= MODEL_WINDOW_S * SAMPLE_RATE) return [{ offsetS: 0, pcm }];
  const size = SAFE_WINDOW_S * SAMPLE_RATE;
  const parts: { offsetS: number; pcm: Float32Array }[] = [];
  for (let a = 0; a < pcm.length; a += size) {
    parts.push({ offsetS: a / SAMPLE_RATE, pcm: pcm.subarray(a, Math.min(a + size, pcm.length)) });
  }
  return parts;
}

async function transcribe(msg: RunMessage): Promise<void> {
  const jobId = msg.id;
  cancelled = false;
  try {
    const { chunks } = msg.payload;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (await loadModel(jobId)) as any;
    post({ id: jobId, kind: 'progress', stage: 'model', pct: 100 });

    const total = chunks.length;
    for (let i = 0; i < total; i++) {
      if (cancelled) {
        post({ id: jobId, kind: 'error', message: 'cancelled' });
        return;
      }
      const chunk = chunks[i];
      const words: { text: string; start: number; end: number }[] = [];
      for (const part of splitToWindow(chunk.pcm)) {
        // NOTE: `chunk_length_s` is deliberately NOT passed. Setting it makes
        // transformers.js run its own long-form windowing + longest-common-
        // subsequence re-stitching (_call_whisper -> tokenizer._decode_asr),
        // which silently drops whole spans of real speech. Omitting it takes
        // the single-forward-pass branch: stride [len,0,0], one generate(), no
        // merge. Safe because every buffer here is <= 28s by construction.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const out: any = await model(part.pcm, {
          return_timestamps: 'word',
          language: 'english',
          task: 'transcribe',
        });

        const offset = chunk.start + part.offsetS;
        const rawWords: unknown[] = Array.isArray(out?.chunks) ? out.chunks : [];
        for (const raw of rawWords) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const w = raw as any;
          const ts = Array.isArray(w?.timestamp) ? w.timestamp : [];
          const s = typeof ts[0] === 'number' ? ts[0] : NaN;
          const e = typeof ts[1] === 'number' ? ts[1] : s;
          const text = String(w?.text ?? '').trim();
          if (!text || !Number.isFinite(s)) continue;
          words.push({
            text,
            start: s + offset,
            end: (Number.isFinite(e) ? e : s) + offset,
          });
        }
      }

      post({
        id: jobId,
        kind: 'progress',
        stage: 'transcribe',
        pct: Math.round(((i + 1) / total) * 100),
        data: { chunkIndex: chunk.index, words },
      });
    }

    post({ id: jobId, kind: 'result', payload: { done: true, device: currentDevice } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transcription failed.';
    post({ id: jobId, kind: 'error', message });
  }
}

ctx.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as Incoming;
  if (!msg) return;
  if (msg.kind === 'cancel') {
    cancelled = true;
    return;
  }
  if (msg.kind === 'run' && (msg as RunMessage).type === 'transcribe') {
    void transcribe(msg as RunMessage);
  }
};
