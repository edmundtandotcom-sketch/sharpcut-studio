// ============================================================================
// workers/ffmpeg.worker.ts — the export engine, off the main thread.
//
// Speaks the workerClient protocol (see workers/workerClient.ts):
//   run:  { id, kind:'run', type:'export-combined'|'export-clips', payload:{plan,file} }
//   out:  { id, kind:'progress', stage, pct } | { id, kind:'result', payload } | { id, kind:'error', message }
//
// FFmpeg is lazy-loaded on first export: multithreaded @ffmpeg/core-mt when
// SharedArrayBuffer is available (needs COOP/COEP), else single-thread
// @ffmpeg/core with a "slower" note. Core assets are self-hosted (Vite ?url
// imports) — no CDN.
//
// Same worker-scope casting trick as transcribe.worker.ts to avoid pulling the
// webworker lib into the DOM tsconfig.
// ============================================================================

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { r } from '../lib/ffmpegFilters';
import type {
  ClipsPlan,
  CombinedPlan,
  ExportPlan,
  SegmentSpec,
} from '../lib/exportPlan';

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
}
const ctx = self as unknown as WorkerScope;

interface ExportRunMessage {
  id: string;
  kind: 'run';
  type: 'export-combined' | 'export-clips';
  payload: { plan: ExportPlan; file: File };
}
interface ExtractAudioRunMessage {
  id: string;
  kind: 'run';
  type: 'extract-audio';
  payload: { file: File; chunkS: number; overlapS: number; duration: number };
}
type RunMessage = ExportRunMessage | ExtractAudioRunMessage;
type Incoming = RunMessage | { kind: 'cancel' } | { kind?: string };

// 16kHz mono is the transcription/silence sample rate (matches audioDecode.ts).
const AUDIO_SAMPLE_RATE = 16000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ffmpeg: any = null;
let usingThreads = false;
let cancelled = false;
// Files written to the FFmpeg FS this job, deleted in the finally block.
const fsFiles = new Set<string>();
let fontsDirMade = false;

// ---- Hang watchdog --------------------------------------------------------
// The multithreaded core (@ffmpeg/core-mt) can DEADLOCK inside exec() on a bad
// filtergraph: no progress events, no log lines, no return — forever. The
// single-thread core fails cleanly (returns code 1) instead. So we run MT first
// for speed, but guard every exec with an activity watchdog. If an exec emits
// neither a 'progress' event nor a log line for HANG_MS, we treat the instance
// as hung, terminate it, and restart the whole job single-thread (once).
const HANG_MS = 45_000;
const WATCHDOG_TICK_MS = 5_000;
// Updated by BOTH the log and progress handlers in makeInstance(); the watchdog
// compares against it to detect a silent exec.
let lastActivityAt = 0;
// Session-sticky verdict: once MT has hung, every later export goes straight to
// single-thread. Persists for the life of the worker (i.e. the browser tab).
let mtHungOnce = false;

/** Thrown when the watchdog trips; distinguishes a hang from a clean failure. */
class HangError extends Error {
  constructor() {
    super('ffmpeg-hang');
    this.name = 'HangError';
  }
}

// Progress interpolation state for the currently-running exec.
let curLabel = 'Preparing';
let curBase = 0;
let curSpan = 0;
let curId = '';

function post(message: Record<string, unknown>, transfer?: Transferable[]): void {
  ctx.postMessage(message, transfer);
}

function emit(pct: number): void {
  if (!curId) return;
  post({ id: curId, kind: 'progress', stage: curLabel, pct: Math.max(0, Math.min(100, pct)) });
}

function throwIfCancelled(): void {
  if (cancelled) throw new DOMException('cancelled', 'AbortError');
}

/**
 * Self-hosted core asset URLs (public/ffmpeg/<dir>/). Same-origin so they load
 * cleanly under COOP/COEP with no CDN dependency. The @ffmpeg/ffmpeg class
 * worker itself is bundled by Vite from the "./worker" export.
 */
function coreUrls(threaded: boolean): { coreURL: string; wasmURL: string; workerURL: string } {
  const origin = typeof location !== 'undefined' ? location.origin : '';
  const b = import.meta.env.BASE_URL || '/';
  const dir = threaded ? 'core-mt' : 'core';
  const prefix = `${origin}${b}ffmpeg/${dir}/`;
  return {
    coreURL: `${prefix}ffmpeg-core.js`,
    wasmURL: `${prefix}ffmpeg-core.wasm`,
    workerURL: `${prefix}ffmpeg-core.worker.js`,
  };
}

// Ring buffer of recent FFmpeg log lines, appended to step failures so real
// encoder errors reach the UI instead of a bare exit code.
const logTail: string[] = [];
function pushLog(line: string): void {
  logTail.push(line);
  if (logTail.length > 40) logTail.shift();
}

async function makeInstance(threaded: boolean): Promise<unknown> {
  const f = new FFmpeg();
  f.on('log', (e: { message?: string }) => {
    lastActivityAt = Date.now(); // any log line counts as progress for the watchdog
    if (typeof e?.message === 'string') pushLog(e.message);
  });
  f.on('progress', (e: { progress?: number }) => {
    lastActivityAt = Date.now();
    const p = typeof e?.progress === 'number' ? e.progress : 0;
    emit((curBase + curSpan * Math.max(0, Math.min(1, p))) * 100);
  });
  const urls = coreUrls(threaded);
  if (threaded) {
    await f.load({ coreURL: urls.coreURL, wasmURL: urls.wasmURL, workerURL: urls.workerURL });
  } else {
    await f.load({ coreURL: urls.coreURL, wasmURL: urls.wasmURL });
  }
  return f;
}

async function ensureLoaded(): Promise<void> {
  if (ffmpeg) return;
  // Multithreaded first for speed — but only if SharedArrayBuffer exists AND MT
  // hasn't already hung this session. Once it hangs, we never trust it again.
  const hasSAB = typeof SharedArrayBuffer !== 'undefined';
  if (hasSAB && !mtHungOnce) {
    try {
      ffmpeg = await makeInstance(true);
      usingThreads = true;
      return;
    } catch {
      ffmpeg = null;
    }
  }
  ffmpeg = await makeInstance(false);
  usingThreads = false;
}

async function writeInput(file: File): Promise<void> {
  const data = await fetchFile(file);
  await ffmpeg.writeFile('input', data);
  fsFiles.add('input');
}

async function writeFonts(plan: ExportPlan): Promise<void> {
  if (!plan.fonts.length) return;
  if (!fontsDirMade) {
    try {
      await ffmpeg.createDir('fonts');
    } catch {
      /* dir may already exist */
    }
    fontsDirMade = true;
  }
  for (const font of plan.fonts) {
    const bytes = await fetchFile(font.url);
    const path = `fonts/${font.fsName}`;
    await ffmpeg.writeFile(path, bytes);
    fsFiles.add(path);
  }
}

async function writeText(name: string, content: string): Promise<void> {
  await ffmpeg.writeFile(name, new TextEncoder().encode(content));
  fsFiles.add(name);
}

/**
 * Race ffmpeg.exec against a hang watchdog. Resolves with exec's return value,
 * or rejects with HangError if no log/progress activity for HANG_MS. The exec
 * promise is abandoned on hang; the caller is expected to terminate the (dead)
 * instance rather than await it.
 */
function execWithWatchdog(args: string[]): Promise<unknown> {
  lastActivityAt = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  const watchdog = new Promise<never>((_, reject) => {
    timer = setInterval(() => {
      if (Date.now() - lastActivityAt >= HANG_MS) reject(new HangError());
    }, WATCHDOG_TICK_MS);
  });
  return Promise.race([ffmpeg.exec(args) as Promise<unknown>, watchdog]).finally(() => {
    if (timer !== undefined) clearInterval(timer);
  });
}

/** Run one exec as a progress step, advancing the running fraction. */
let doneUnits = 0;
let totalUnits = 1;
async function step(label: string, units: number, args: string[]): Promise<void> {
  throwIfCancelled();
  curLabel = label;
  curBase = doneUnits / totalUnits;
  curSpan = units / totalUnits;
  emit(curBase * 100);
  logTail.length = 0;
  const ret = await execWithWatchdog(args);
  throwIfCancelled();
  if (typeof ret === 'number' && ret !== 0) {
    const tail = logTail.slice(-12).join('\n');
    throw new Error(`FFmpeg step failed (${label}), code ${ret}\n${tail}`);
  }
  doneUnits += units;
  emit((doneUnits / totalUnits) * 100);
}

function segmentRenderArgs(spec: SegmentSpec, plan: ExportPlan): string[] {
  const args = ['-ss', String(r(spec.srcStart)), '-i', 'input', '-t', String(r(spec.srcDuration)), '-vf', spec.vf];
  if (plan.hasAudio) {
    args.push('-af', spec.af, ...plan.encode);
  } else {
    args.push('-an', ...plan.videoEncode, '-movflags', '+faststart');
  }
  args.push(spec.outName);
  return args;
}

/**
 * concat-demuxer stream copy of `files` into `out`, as one progress step.
 * The concat list file is deleted immediately after (it is tiny but keeping the
 * FS tidy avoids stale-name collisions across rolling batches).
 */
async function concatCopyStep(files: string[], out: string, units: number): Promise<void> {
  const list = files.map((f) => `file '${f}'`).join('\n') + '\n';
  const listName = `cc_${out}.txt`;
  await writeText(listName, list);
  fsFiles.add(out);
  await step('Joining segments', units, ['-f', 'concat', '-safe', '0', '-i', listName, '-c', 'copy', out]);
  await safeDelete(listName);
}

// Weight of each concat-copy step in the progress model (cheap stream copy).
const CONCAT_UNITS = 0.3;

// ---- Segment vault (FS eviction) -------------------------------------------
// Memory hygiene for long videos. The wasm32 address space (~2 GB, and for the
// multithreaded core a FIXED-maximum SharedArrayBuffer that cannot grow past its
// build-time cap) must hold: the input (573 MB for a 30-min clip, resident the
// whole render because every segment seeks into it) + every rendered segment +
// the join output. The emscripten heap only ever GROWS — but it REUSES freed
// MEMFS space. So the winning move is to remove each finished segment's bytes
// from the FS entirely the instant it is rendered, parking them in the worker's
// OWN JS heap (a separate address space from the wasm memory). During the render
// the FS then holds only: input + the one in-flight segment. At join time the
// payloads are written back and concat-copied into the final file.
//
// (A rolling concat — folding segments into one growing intermediate — does NOT
// help here: the rolling file keeps the same total bytes resident in the FS
// during the render, which is exactly where the OOM strikes.)
let vault: { name: string; data: Uint8Array }[] = [];

/** Move a just-rendered FS file into the worker JS heap and free its MEMFS bytes. */
async function evictToVault(name: string): Promise<void> {
  // Copy detaches from the MEMFS-backed buffer so deleteFile can reclaim it.
  const data = new Uint8Array((await ffmpeg.readFile(name)) as Uint8Array);
  await safeDelete(name);
  vault.push({ name, data });
}

/** Write the named vault entries back into the FS ahead of the join pass. */
async function restoreFromVault(names: string[]): Promise<void> {
  const want = new Set(names);
  for (const v of vault) {
    if (!want.has(v.name)) continue;
    await ffmpeg.writeFile(v.name, v.data);
    fsFiles.add(v.name);
  }
}

/** Drop a vault entry's JS-heap bytes once the join has consumed its FS copy. */
function releaseVault(name: string): void {
  const i = vault.findIndex((v) => v.name === name);
  if (i >= 0) vault.splice(i, 1);
}

// ---- Combined export -------------------------------------------------------

function buildXfadeGraph(
  runDurations: number[],
  xfades: CombinedPlan['xfades'],
  hasAudio: boolean,
  useFallback: boolean,
): { graph: string; vOut: string; aOut: string } {
  const k = runDurations.length;
  const vparts: string[] = [];
  const aparts: string[] = [];
  let vprev = '[0:v]';
  let aprev = '[0:a]';
  let acc = runDurations[0];
  for (let j = 1; j < k; j++) {
    const xf = xfades[j - 1];
    const name = useFallback ? xf.fallback : xf.name;
    const d = xf.durationS;
    const off = Math.max(0, acc - d);
    const vOut = j === k - 1 ? '[vout]' : `[vx${j}]`;
    vparts.push(`${vprev}[${j}:v]xfade=transition=${name}:duration=${r(d)}:offset=${r(off)}${vOut}`);
    vprev = vOut;
    if (hasAudio) {
      const aOut = j === k - 1 ? '[aout]' : `[ax${j}]`;
      aparts.push(`${aprev}[${j}:a]acrossfade=d=${r(d)}:c1=tri:c2=tri${aOut}`);
      aprev = aOut;
    }
    acc = acc + runDurations[j] - d;
  }
  const graph = [...vparts, ...aparts].join(';');
  return { graph, vOut: vprev, aOut: aprev };
}

/**
 * Join the rendered segments (currently parked in the vault) with transitions.
 * Each run's segment payloads are restored to the FS and concat-copied into a
 * run file (whose bytes are then released from the vault); the xfade/acrossfade
 * chain runs across those run files. Restoring run-by-run keeps the FS bounded to
 * the already-built run files + the current run's segments rather than every
 * segment at once. Primary transitions -> safe-mode fallback -> plain concat.
 */
async function joinWithTransitions(plan: CombinedPlan): Promise<void> {
  const runFiles: string[] = [];
  const runDurations: number[] = [];
  for (let j = 0; j < plan.runs.length; j++) {
    const idxs = plan.runs[j];
    const segNames = idxs.map((i) => plan.segments[i].outName);
    await restoreFromVault(segNames);
    runDurations.push(idxs.reduce((sum, i) => sum + plan.segments[i].outDuration, 0));
    if (segNames.length === 1) {
      // The restored segment IS the run file; its vault copy is now redundant.
      releaseVault(segNames[0]);
      runFiles.push(segNames[0]);
    } else {
      const runOut = `run${j}.mp4`;
      await concatCopyStep(segNames, runOut, CONCAT_UNITS);
      for (const n of segNames) {
        await safeDelete(n);
        releaseVault(n);
      }
      runFiles.push(runOut);
    }
  }
  vault = [];

  const inputs: string[] = [];
  for (const f of runFiles) inputs.push('-i', f);
  fsFiles.add('joined.mp4');

  const attempt = async (useFallback: boolean): Promise<void> => {
    const { graph, vOut, aOut } = buildXfadeGraph(runDurations, plan.xfades, plan.hasAudio, useFallback);
    const args = [...inputs, '-filter_complex', graph, '-map', vOut];
    if (plan.hasAudio) args.push('-map', aOut, ...plan.encode);
    else args.push('-an', ...plan.videoEncode, '-movflags', '+faststart');
    args.push('joined.mp4');
    await step(useFallback ? 'Joining segments (safe mode)' : 'Joining with transitions', runFiles.length, args);
  };

  try {
    await attempt(false);
  } catch {
    throwIfCancelled();
    try {
      await attempt(true);
    } catch {
      throwIfCancelled();
      // Last resort: drop transitions, plain-concat the run files (the raw
      // segments are already gone — folded into the run files by the roller).
      await concatCopyStep(runFiles, 'joined.mp4', Math.max(CONCAT_UNITS, runFiles.length * CONCAT_UNITS));
    }
  }
}

async function captionPass(input: string, ass: string, plan: ExportPlan, output: string): Promise<void> {
  await writeText('captions.ass', ass);
  const args = ['-i', input, '-vf', 'ass=captions.ass:fontsdir=fonts', ...plan.videoEncode];
  if (plan.hasAudio) args.push('-c:a', 'copy');
  else args.push('-an');
  args.push('-movflags', '+faststart', output);
  fsFiles.add(output);
  await step('Burning captions', Math.max(1, plan.fonts.length * 2), args);
}

async function runCombined(id: string, plan: CombinedPlan, file: File): Promise<void> {
  const N = plan.segments.length;
  // Weighted units: prepare (0.5) + N renders + join concats + caption pass.
  const joinUnits = plan.hasTransitions
    ? plan.runs.filter((r) => r.length > 1).length * CONCAT_UNITS + plan.runs.length
    : CONCAT_UNITS;
  const captionUnits = plan.ass ? Math.max(1, N * 0.6) : 0;
  totalUnits = 0.5 + N + joinUnits + captionUnits;
  doneUnits = 0;
  vault = [];

  curLabel = usingThreads ? 'Preparing' : 'Preparing — single-thread mode (slower)';
  emit(0);
  await writeInput(file);
  await writeFonts(plan);
  doneUnits = 0.5;
  emit((doneUnits / totalUnits) * 100);

  // Render every segment, evicting each to the worker JS heap the instant it is
  // done (see the segment-vault note). The FS holds only input + one segment,
  // so the render phase no longer accumulates toward the wasm memory ceiling.
  for (let i = 0; i < N; i++) {
    const spec = plan.segments[i];
    await step(`Rendering segment ${i + 1}/${N}`, 1, segmentRenderArgs(spec, plan));
    fsFiles.add(spec.outName);
    await evictToVault(spec.outName);
  }

  // (b) Free the input (the largest single block) before the join/caption pass.
  await safeDelete('input');

  if (plan.hasTransitions) {
    await joinWithTransitions(plan);
  } else {
    // Restore all segment payloads and concat-copy them into joined.mp4. This is
    // the one point that needs the full output resident (peak ≈ 2× output, with
    // the input already evicted). A single copy normalises even one segment.
    const names = plan.segments.map((s) => s.outName);
    await restoreFromVault(names);
    await concatCopyStep(names, 'joined.mp4', joinUnits);
    for (const n of names) {
      await safeDelete(n);
      releaseVault(n);
    }
    vault = [];
  }

  let finalName = 'joined.mp4';
  if (plan.ass) {
    await captionPass('joined.mp4', plan.ass, plan, plan.outputName);
    // (c) Free the pre-caption master as soon as the burn pass has read it,
    // before we read the final output — lowers peak FS during the caption pass.
    await safeDelete('joined.mp4');
    finalName = plan.outputName;
  }

  curLabel = 'Finishing';
  emit(99);
  const data = (await ffmpeg.readFile(finalName)) as Uint8Array;
  const copy = new Uint8Array(data); // detach from FS buffer for transfer
  post(
    { id, kind: 'result', payload: { files: [{ name: plan.outputName, data: copy }], threads: usingThreads } },
    [copy.buffer],
  );
}

// ---- Clips export ----------------------------------------------------------

async function runClips(id: string, plan: ClipsPlan, file: File): Promise<void> {
  const M = plan.clips.length;
  totalUnits = 0.5 + M * (1 + (plan.fonts.length ? 0.6 : 0));
  doneUnits = 0;

  curLabel = usingThreads ? 'Preparing' : 'Preparing — single-thread mode (slower)';
  emit(0);
  await writeInput(file);
  await writeFonts(plan);
  doneUnits = 0.5;
  emit((doneUnits / totalUnits) * 100);

  const files: { name: string; data: Uint8Array }[] = [];
  const transfer: Transferable[] = [];

  for (let i = 0; i < M; i++) {
    const clip = plan.clips[i];
    await step(`Rendering clip ${i + 1}/${M}`, 1, segmentRenderArgs(clip.spec, plan));
    fsFiles.add(clip.spec.outName);

    let out = clip.spec.outName;
    if (clip.ass) {
      await captionPass(clip.spec.outName, clip.ass, plan, clip.outputName);
      out = clip.outputName;
    }
    const data = (await ffmpeg.readFile(out)) as Uint8Array;
    const copy = new Uint8Array(data);
    files.push({ name: clip.outputName, data: copy });
    transfer.push(copy.buffer);

    // Free this clip's intermediates immediately (bound memory).
    await safeDelete(clip.spec.outName);
    if (clip.ass) await safeDelete(clip.outputName);
    await safeDelete('captions.ass');
  }

  // (P1b) `input` is needed for EVERY clip render, so it can only be freed after
  // the last clip. Drop it before we hand the results back.
  await safeDelete('input');

  post({ id, kind: 'result', payload: { files, threads: usingThreads } }, transfer);
}

async function safeDelete(name: string): Promise<void> {
  try {
    await ffmpeg.deleteFile(name);
  } catch {
    /* ignore */
  }
  fsFiles.delete(name);
}

async function cleanup(): Promise<void> {
  const names = Array.from(fsFiles);
  for (const name of names) await safeDelete(name);
  fsFiles.clear();
  vault = []; // release any parked segment payloads from the worker JS heap
}

// ---- Chunked audio extraction (analysis stage 1 for large/long videos) -----

/**
 * Probe the input for an audio stream. `-i input` with no output makes ffmpeg
 * exit non-zero, but it first logs the stream table to the log ring buffer.
 * We scan that tail for an "Audio" stream line. Returns true if one is found.
 */
async function probeHasAudioStream(): Promise<boolean> {
  logTail.length = 0;
  try {
    // Non-zero exit is expected (no output file); we only care about the log.
    // Force info-level logging so the input stream table is actually emitted
    // (some core builds default to a quieter level that hides it).
    await execWithWatchdog(['-hide_banner', '-loglevel', 'info', '-i', 'input']);
  } catch (err) {
    if (err instanceof HangError) throw err;
    // Any other rejection: fall through and inspect whatever was logged.
  }
  const streamLines = logTail.filter((l) => /Stream #/i.test(l));
  const hasAudio = streamLines.some((l) => /Audio/i.test(l));
  const hasVideo = streamLines.some((l) => /Video/i.test(l));
  // Only assert "no audio" when the probe positively saw stream lines with a
  // video stream but no audio stream. If the log was inconclusive (no stream
  // lines parsed at all — e.g. a log-format quirk), don't block: let the
  // extraction proceed and surface a real failure if one actually occurs.
  if (streamLines.length > 0 && hasVideo && !hasAudio) return false;
  return true;
}

/**
 * Extract the audio track as 16kHz mono f32le, one bounded chunk at a time.
 * Each chunk window is [i*(chunkS-overlapS), +chunkS]; overlaps let the caller
 * dedupe transcription drift. One chunk's PCM is in flight at a time (readFile
 * then delete), so worker-side memory stays bounded regardless of file length.
 */
async function runExtractAudio(id: string, payload: ExtractAudioRunMessage['payload']): Promise<void> {
  const { file, chunkS, overlapS, duration } = payload;
  curLabel = usingThreads ? 'Extracting audio' : 'Extracting audio — single-thread mode (slower)';
  emit(0);
  await writeInput(file);

  if (!(await probeHasAudioStream())) {
    // Typed signal so the UI can honestly say "no audio track" (not a failure).
    post({ id, kind: 'error', message: 'no-audio' });
    return;
  }

  const step = Math.max(1, chunkS - overlapS);
  const total = Math.max(1, Math.ceil(duration / step));
  for (let i = 0; i < total; i++) {
    throwIfCancelled();
    const start = i * step;
    if (start >= duration) break;
    // Let the ffmpeg progress handler interpolate the bar within this chunk.
    curBase = i / total;
    curSpan = 1 / total;
    logTail.length = 0;
    const outName = 'chunk.raw';
    fsFiles.add(outName);
    const ret = await execWithWatchdog([
      '-ss', String(r(start)),
      '-i', 'input',
      '-t', String(r(chunkS)),
      '-vn', '-ac', '1', '-ar', String(AUDIO_SAMPLE_RATE),
      '-f', 'f32le', outName,
    ]);
    throwIfCancelled();
    if (typeof ret === 'number' && ret !== 0) {
      const tail = logTail.slice(-12).join('\n');
      throw new Error(`FFmpeg audio extraction failed (chunk ${i + 1}/${total}), code ${ret}\n${tail}`);
    }
    const data = (await ffmpeg.readFile(outName)) as Uint8Array;
    // Detach from the FS buffer into a fresh, 4-byte-aligned ArrayBuffer so the
    // Float32Array view is valid and its buffer is transferable.
    const bytes = new Uint8Array(data);
    await safeDelete(outName);
    const usable = bytes.byteLength - (bytes.byteLength % 4);
    const pcm = new Float32Array(bytes.buffer, 0, usable / 4);
    post(
      {
        id,
        kind: 'progress',
        stage: 'extract',
        pct: Math.round(((i + 1) / total) * 100),
        data: { chunkIndex: i, start, total, pcm },
      },
      [pcm.buffer],
    );
  }

  post({ id, kind: 'result', payload: { chunkCount: total } });
}

/** One full job attempt: (re)load ffmpeg, then run the job from scratch. */
async function attemptJob(msg: RunMessage): Promise<void> {
  await ensureLoaded();
  throwIfCancelled();
  if (msg.type === 'extract-audio') {
    await runExtractAudio(msg.id, msg.payload);
  } else if (msg.type === 'export-clips') {
    await runClips(msg.id, msg.payload.plan as ClipsPlan, msg.payload.file);
  } else {
    await runCombined(msg.id, msg.payload.plan as CombinedPlan, msg.payload.file);
  }
}

/**
 * Tear down a hung/dead ffmpeg instance and reset ALL per-job state so the job
 * can be retried from the beginning. terminate() kills the ffmpeg worker and
 * its in-memory FS, so we must NOT try to deleteFile() anything — just drop the
 * bookkeeping. The retry re-writes input + fonts via runCombined/runClips.
 */
function resetForRetry(): void {
  if (ffmpeg) {
    try {
      ffmpeg.terminate();
    } catch {
      /* ignore */
    }
  }
  ffmpeg = null;
  usingThreads = false;
  fsFiles.clear();
  vault = [];
  fontsDirMade = false;
  doneUnits = 0;
  totalUnits = 1;
  logTail.length = 0;
}

/** Last few FFmpeg log lines, appended to every export error for diagnosis. */
function tailLog(): string {
  const tail = logTail.slice(-8);
  return tail.length ? `\n\nRecent log:\n${tail.join('\n')}` : '';
}

/**
 * Turn whatever was thrown into an honest, user-surfaced message. A NON-Error
 * throw (e.g. a wasm "abort"/emscripten string, or an OOM RuntimeError with no
 * clean `.message`) used to collapse to the opaque "Export failed." — instead we
 * stringify the value, add any `.message`, and ALWAYS append the log-ring tail.
 * When the cause looks like memory exhaustion we add the spec's guidance.
 */
function buildErrorMessage(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
  if (err instanceof HangError) {
    return 'Export stalled and could not recover. Please try again.' + tailLog();
  }
  let base: string;
  if (err instanceof Error) {
    base = err.message || err.name || String(err);
  } else {
    base = String(err);
    // Non-Error objects can still carry a useful `.message` (emscripten aborts).
    const m = (err as { message?: unknown })?.message;
    if (m != null && String(m) !== base) base = `${base} (${String(m)})`;
  }
  if (!base || base === '[object Object]') base = 'Export failed.';
  let message = base + tailLog();
  // Memory-exhaustion heuristic across the message AND the log tail: wasm OOM
  // surfaces as "abort", "OOM", "out of memory", or "Cannot enlarge memory".
  const haystack = `${base}\n${logTail.join('\n')}`;
  if (/\babort\b|OOM|out of memory|memory|Cannot enlarge|enlarge/i.test(haystack)) {
    message +=
      '\n\nThis looks like a memory limit. Try Individual clips mode, Standard quality, or a shorter video.';
  }
  return message;
}

async function handleRun(msg: RunMessage): Promise<void> {
  curId = msg.id;
  cancelled = false;
  try {
    try {
      await attemptJob(msg);
    } catch (err) {
      // MT hung inside exec: auto-recover once by restarting single-thread.
      if (err instanceof HangError && usingThreads && !cancelled) {
        mtHungOnce = true; // session-sticky: all later exports skip MT too
        resetForRetry();
        post({ id: msg.id, kind: 'progress', stage: 'Restarting in single-thread mode…', pct: 0 });
        await attemptJob(msg); // ensureLoaded now picks single-thread
      } else {
        throw err;
      }
    }
  } catch (err) {
    const message = buildErrorMessage(err);
    post({ id: msg.id, kind: 'error', message });
    // On cancel/terminate/hang the instance is dead — force a reload next time.
    if (message === 'cancelled' || err instanceof HangError) {
      ffmpeg = null;
      fontsDirMade = false;
    }
  } finally {
    if (ffmpeg) await cleanup();
    curId = '';
  }
}

ctx.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as Incoming;
  if (!msg) return;
  if (msg.kind === 'cancel') {
    cancelled = true;
    if (ffmpeg) {
      try {
        ffmpeg.terminate();
      } catch {
        /* ignore */
      }
      ffmpeg = null;
      fontsDirMade = false;
    }
    return;
  }
  if (msg.kind === 'run') {
    void handleRun(msg as RunMessage);
  }
};
