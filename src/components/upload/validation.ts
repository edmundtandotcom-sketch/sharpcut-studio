// ============================================================================
// components/upload/validation.ts — upload validation per SPEC State 1:
// file type, readable duration + dimensions, audio-track presence, size /
// memory-risk warnings, and corrupted-file detection. Never silently rejects;
// every failure carries a plain-language message + recovery action.
// ============================================================================

import type { ProjectMeta } from '../../types';

export interface ValidationSuccess {
  ok: true;
  meta: ProjectMeta;
  warnings: string[];
}
export interface ValidationFailure {
  ok: false;
  error: string;
  recovery: string;
}
export type ValidationResult = ValidationSuccess | ValidationFailure;

export const ACCEPTED_EXTENSIONS = ['.mp4', '.mov', '.webm', '.m4v'];
export const ACCEPT_ATTR = '.mp4,.mov,.webm,.m4v,video/mp4,video/quicktime,video/webm';
const MAX_RECOMMENDED_BYTES = 2 * 1024 ** 3; // 2 GB
const MAX_RECOMMENDED_SECONDS = 60 * 60; // 60 min
const AUDIO_DECODE_PROBE_LIMIT = 60 * 1024 * 1024; // decode-probe files up to 60MB

interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
}

function readVideoMetadata(objectUrl: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('metadata-timeout'));
    }, 20000);
    function cleanup() {
      window.clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
    }
    video.onloadedmetadata = () => {
      const meta = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      };
      cleanup();
      resolve(meta);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('metadata-error'));
    };
    video.src = objectUrl;
  });
}

type AudioResult = 'yes' | 'no' | 'unknown';

/** Definitive audio probe for smaller files: try to decode the audio track. */
async function decodeAudioProbe(file: File): Promise<AudioResult> {
  try {
    const buf = await file.arrayBuffer();
    const Ctor =
      (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return 'unknown';
    const ctx = new Ctor();
    try {
      const decoded = await ctx.decodeAudioData(buf);
      await ctx.close().catch(() => {});
      return decoded.length > 0 ? 'yes' : 'no';
    } catch {
      await ctx.close().catch(() => {});
      return 'no';
    }
  } catch {
    return 'unknown';
  }
}

/** Playback-based probe for large files (Chromium/Firefox heuristics). */
function playbackAudioProbe(objectUrl: string): Promise<AudioResult> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    (video as unknown as { playsInline: boolean }).playsInline = true;
    let settled = false;

    const check = (): AudioResult => {
      const el = video as unknown as {
        webkitAudioDecodedByteCount?: number;
        mozHasAudio?: boolean;
        audioTracks?: { length: number };
      };
      if (typeof el.webkitAudioDecodedByteCount === 'number') {
        return el.webkitAudioDecodedByteCount > 0 ? 'yes' : 'no';
      }
      if (typeof el.mozHasAudio === 'boolean') return el.mozHasAudio ? 'yes' : 'no';
      if (el.audioTracks && typeof el.audioTracks.length === 'number') {
        return el.audioTracks.length > 0 ? 'yes' : 'no';
      }
      return 'unknown';
    };

    const finish = (result: AudioResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      try {
        video.pause();
      } catch {
        /* ignore */
      }
      video.removeAttribute('src');
      video.load();
      resolve(result);
    };

    const timeout = window.setTimeout(() => finish(check()), 6000);
    video.oncanplay = () => {
      void video.play().catch(() => {});
    };
    video.ontimeupdate = () => {
      if (video.currentTime > 0.3) finish(check());
    };
    video.onerror = () => finish('unknown');
    video.src = objectUrl;
  });
}

async function probeHasAudio(file: File, objectUrl: string): Promise<AudioResult> {
  if (file.size <= AUDIO_DECODE_PROBE_LIMIT) {
    const result = await decodeAudioProbe(file);
    if (result !== 'unknown') return result;
  }
  return playbackAudioProbe(objectUrl);
}

/**
 * Validate a chosen video. `objectUrl` must be an object URL for `file`
 * (created by the caller so the same URL can be reused for the project).
 */
export async function validateVideoFile(
  file: File,
  objectUrl: string,
): Promise<ValidationResult> {
  const lower = file.name.toLowerCase();
  const extOk = ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
  const typeOk = file.type.startsWith('video/');
  if (!extOk && !typeOk) {
    return {
      ok: false,
      error: `"${file.name}" isn't a video type SharpCut can open.`,
      recovery: 'Choose an MP4, MOV, WebM, or M4V file.',
    };
  }

  const warnings: string[] = [];
  if (file.size > MAX_RECOMMENDED_BYTES) {
    warnings.push(
      'This file is over 2 GB. Very large videos can strain browser memory — if analysis fails, try a shorter clip or a lower-resolution re-export.',
    );
  }

  let metadata: VideoMetadata;
  try {
    metadata = await readVideoMetadata(objectUrl);
  } catch {
    return {
      ok: false,
      error: "We couldn't read this video.",
      recovery:
        'The file may be corrupted or use a codec this browser cannot open. Re-export it as an H.264 MP4 and try again.',
    };
  }

  const { duration, width, height } = metadata;
  if (!Number.isFinite(duration) || duration <= 0) {
    return {
      ok: false,
      error: "We couldn't read this video's length.",
      recovery: 'The file may be corrupted. Re-export it and try again.',
    };
  }
  if (duration > MAX_RECOMMENDED_SECONDS) {
    warnings.push(
      'This video is over 60 minutes. SharpCut works best with videos up to about 60 minutes — longer videos may run slowly or run out of memory.',
    );
  }

  const audio = await probeHasAudio(file, objectUrl);
  if (audio === 'no') {
    return {
      ok: false,
      error: 'This video has no audio track.',
      recovery:
        'SharpCut listens to speech to find cuts. Add narration/audio, or choose a video that contains speech.',
    };
  }

  const name = file.name.replace(/\.[^.]+$/, '') || file.name;
  return {
    ok: true,
    warnings,
    meta: {
      name,
      fileName: file.name,
      duration,
      width,
      height,
      hasAudio: true,
    },
  };
}
