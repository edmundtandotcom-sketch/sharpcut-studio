// ============================================================================
// lib/silenceDetect.ts — pure, unit-testable silence detection over 16kHz mono
// Float32 PCM using windowed RMS with an adaptive noise-floor threshold.
// ============================================================================

export interface SilenceRange {
  start: number; // source seconds
  end: number;
}

export interface SilenceOptions {
  sampleRate: number; // e.g. 16000
  minSilenceS: number; // minimum gap to qualify as removable silence
  keepBeforeS: number; // breathing room retained before the following speech
  keepAfterS: number; // breathing room retained after the preceding speech
  hopMs?: number; // RMS hop, default 50ms
  windowMs?: number; // RMS window, default = hop
  noiseFactor?: number; // threshold = noiseFloor * factor, default 1.8
  absFloor?: number; // absolute minimum threshold, default 0.0025
}

/** Post-trim minimum; removable slivers below this are discarded. */
const MIN_REMOVABLE_S = 0.12;

/**
 * Detect removable silence ranges. RMS is computed per hop window; the noise
 * floor is estimated as the 20th-percentile RMS (× noiseFactor). Contiguous
 * runs below threshold that last >= minSilenceS are candidate gaps, then
 * trimmed by the keep-margins so natural breathing room around speech is
 * preserved.
 */
export function detectSilence(pcm: Float32Array, opts: SilenceOptions): SilenceRange[] {
  const { sampleRate } = opts;
  const n = pcm.length;
  if (n === 0 || sampleRate <= 0) return [];

  const hopMs = opts.hopMs ?? 50;
  const hop = Math.max(1, Math.round((hopMs / 1000) * sampleRate));
  const win = Math.max(hop, Math.round(((opts.windowMs ?? hopMs) / 1000) * sampleRate));

  // Windowed RMS.
  const rms: number[] = [];
  for (let i = 0; i < n; i += hop) {
    const end = Math.min(i + win, n);
    let sum = 0;
    for (let j = i; j < end; j++) {
      const v = pcm[j];
      sum += v * v;
    }
    rms.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  if (rms.length === 0) return [];

  // Adaptive threshold from the 20th-percentile noise floor.
  const sorted = [...rms].sort((a, b) => a - b);
  const p20 = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
  const threshold = Math.max(p20 * (opts.noiseFactor ?? 1.8), opts.absFloor ?? 0.0025);

  const minFrames = Math.max(1, Math.ceil(opts.minSilenceS / (hopMs / 1000)));

  // Contiguous below-threshold runs.
  const raw: SilenceRange[] = [];
  let runStart = -1;
  for (let k = 0; k <= rms.length; k++) {
    const silent = k < rms.length && rms[k] < threshold;
    if (silent) {
      if (runStart < 0) runStart = k;
    } else if (runStart >= 0) {
      const frames = k - runStart;
      if (frames >= minFrames) {
        const startTime = (runStart * hop) / sampleRate;
        const endTime = Math.min(k * hop, n) / sampleRate;
        raw.push({ start: startTime, end: endTime });
      }
      runStart = -1;
    }
  }

  // Trim keep-margins: retain keepAfterS after the preceding speech and
  // keepBeforeS before the following speech.
  const trimmed: SilenceRange[] = [];
  for (const r of raw) {
    const start = r.start + opts.keepAfterS;
    const end = r.end - opts.keepBeforeS;
    if (end - start >= MIN_REMOVABLE_S) trimmed.push({ start, end });
  }
  return trimmed;
}
