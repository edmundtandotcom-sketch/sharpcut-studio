import { useCallback, useEffect, useRef } from 'react';
import type { OutputFormat, ProjectMeta } from '../../types';

/**
 * Target aspect ratio (width / height) for a chosen output format. `original`
 * uses the source dimensions.
 */
export function formatAspect(format: OutputFormat, meta: ProjectMeta | null): number {
  if (format === 'landscape') return 16 / 9;
  if (format === 'vertical') return 9 / 16;
  if (meta && meta.width > 0 && meta.height > 0) return meta.width / meta.height;
  return 16 / 9;
}

export const FORMAT_LABELS: Record<OutputFormat, string> = {
  original: 'Original',
  landscape: 'Horizontal 16:9',
  vertical: 'Vertical 9:16',
};

/**
 * True when the chosen format crops the source (source aspect differs from the
 * target enough to require repositioning). Drives whether crop controls show.
 */
export function formatCrops(format: OutputFormat, meta: ProjectMeta | null): boolean {
  if (format === 'original') return false;
  const src = meta && meta.width > 0 && meta.height > 0 ? meta.width / meta.height : 16 / 9;
  const target = formatAspect(format, meta);
  return Math.abs(src - target) > 0.02;
}

/**
 * CSS object-position for a cover-fit crop. object-fit:cover + object-position
 * `x% y%` matches the FFmpeg crop math exactly: the crop window position is a
 * percentage of the croppable overflow (0% = left/top edge, 100% = right/bottom).
 */
export function coverObjectPosition(xPct: number, yPct: number): string {
  return `${clampPct(xPct)}% ${clampPct(yPct)}%`;
}

function clampPct(v: number): number {
  return Math.min(100, Math.max(0, v));
}

/** Timecode with tenths, e.g. 1:04.3 — used by the caption editor. */
export function formatTimecode(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const tenths = Math.floor((safe * 10) % 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

/** Debounce a callback (default 150ms) — for sliders that mutate the store. */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs = 150,
): (...args: A) => void {
  const fnRef = useRef(fn);
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    [],
  );
  return useCallback(
    (...args: A) => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => fnRef.current(...args), delayMs);
    },
    [delayMs],
  );
}
