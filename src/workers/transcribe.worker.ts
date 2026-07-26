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
  const attempts: { device: 'webgpu' | 'wasm'; dtype: string }[] = hasWebGPU
    ? [
        { device: 'webgpu', dtype: 'fp16' },
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
      asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', options);
      currentDevice = attempt.device;
      return asr;
    } catch (err) {
      lastErr = err;
      asr = null;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Failed to load the speech model.');
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out: any = await model(chunk.pcm, {
        return_timestamps: 'word',
        chunk_length_s: 30,
        language: 'english',
        task: 'transcribe',
      });

      const rawWords: unknown[] = Array.isArray(out?.chunks) ? out.chunks : [];
      const words = rawWords
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((w: any) => {
          const ts = Array.isArray(w?.timestamp) ? w.timestamp : [];
          const s = typeof ts[0] === 'number' ? ts[0] : NaN;
          const e = typeof ts[1] === 'number' ? ts[1] : s;
          return {
            text: String(w?.text ?? '').trim(),
            start: s + chunk.start,
            end: (Number.isFinite(e) ? e : s) + chunk.start,
          };
        })
        .filter((w) => w.text.length > 0 && Number.isFinite(w.start));

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
