// ============================================================================
// workers/workerClient.ts — typed promise wrapper around a Web Worker per the
// ARCHITECTURE.md protocol: request/response with message ids, progress events,
// AbortSignal cancellation, dedupe (same job type in-flight returns the same
// promise), and error surfacing.
//
// Wire protocol:
//   client -> worker: { id, kind:'run', type, payload } | { id, kind:'cancel' }
//   worker -> client: { id, kind:'progress', stage?, pct?, data? }
//                    | { id, kind:'result', payload? }
//                    | { id, kind:'error', message? }
// ============================================================================

import { id as makeId } from '../lib/time';

export interface WorkerProgress {
  stage?: string;
  pct?: number;
  data?: unknown;
}

export interface RunOptions {
  onProgress?: (p: WorkerProgress) => void;
  signal?: AbortSignal;
  /** Transferable objects (e.g. PCM chunk ArrayBuffers) to move, not copy. */
  transfer?: Transferable[];
}

type IncomingMessage =
  | { id: string; kind: 'progress'; stage?: string; pct?: number; data?: unknown }
  | { id: string; kind: 'result'; payload?: unknown }
  | { id: string; kind: 'error'; message?: string };

// Per-worker map of job type -> in-flight promise (dedupe).
const inflight = new WeakMap<Worker, Map<string, Promise<unknown>>>();

function getInflight(worker: Worker): Map<string, Promise<unknown>> {
  let map = inflight.get(worker);
  if (!map) {
    map = new Map();
    inflight.set(worker, map);
  }
  return map;
}

/**
 * Run a job on the worker and resolve with its result payload. Starting a job
 * type that is already running for the same worker is a no-op that returns the
 * existing in-flight promise.
 */
export function runJob<T = unknown>(
  worker: Worker,
  type: string,
  payload: unknown,
  opts: RunOptions = {},
): Promise<T> {
  const map = getInflight(worker);
  const existing = map.get(type);
  if (existing) return existing as Promise<T>;

  const jobId = makeId();

  const promise = new Promise<T>((resolve, reject) => {
    const onMessage = (ev: MessageEvent<IncomingMessage>) => {
      const m = ev.data;
      if (!m || m.id !== jobId) return;
      if (m.kind === 'progress') {
        opts.onProgress?.({ stage: m.stage, pct: m.pct, data: m.data });
      } else if (m.kind === 'result') {
        cleanup();
        resolve(m.payload as T);
      } else if (m.kind === 'error') {
        cleanup();
        const message = m.message || 'Worker error';
        if (message === 'cancelled') reject(new DOMException('cancelled', 'AbortError'));
        else reject(new Error(message));
      }
    };

    const onAbort = () => {
      try {
        worker.postMessage({ id: jobId, kind: 'cancel' });
      } catch {
        /* ignore */
      }
      cleanup();
      reject(new DOMException('cancelled', 'AbortError'));
    };

    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      opts.signal?.removeEventListener('abort', onAbort);
      map.delete(type);
    };

    worker.addEventListener('message', onMessage);

    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort();
        return;
      }
      opts.signal.addEventListener('abort', onAbort);
    }

    try {
      worker.postMessage({ id: jobId, kind: 'run', type, payload }, opts.transfer ?? []);
    } catch (err) {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });

  map.set(type, promise);
  // Safety net: ensure the dedupe slot clears once settled.
  void promise.catch(() => {}).finally(() => {
    if (map.get(type) === promise) map.delete(type);
  });
  return promise;
}
