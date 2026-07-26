import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Segment } from '../../types';
import { keptDuration, outputToSource, sourceToOutput } from '../../lib/cuts';

/** Stable playback actions (all useCallback-memoised) — safe to pass to memoised sections. */
export interface PreviewActions {
  play: () => void;
  seekOutput: (t: number) => void;
  seekSource: (t: number) => void;
  playRange: (startSource: number, endSource: number) => void;
}

export interface PreviewController extends PreviewActions {
  videoRef: RefObject<HTMLVideoElement>;
  playing: boolean;
  /** Output-timeline position (seconds, after cuts + speed). Throttled. */
  outputTime: number;
  /** Underlying source-time position (seconds). Throttled. */
  sourceTime: number;
  outputDuration: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekOutput: (t: number) => void;
  seekSource: (t: number) => void;
  /** Play only [startSource, endSource] then pause (clip / block preview). */
  playRange: (startSource: number, endSource: number) => void;
}

/**
 * Drives the studio preview video: applies playbackRate = speed, skips removed
 * gaps during playback, and reports output/source time (throttled to keep the
 * settings column from re-rendering at 60fps).
 */
export function usePreviewController(
  segments: Segment[],
  speed: number,
): PreviewController {
  const videoRef = useRef<HTMLVideoElement>(null);
  const segsRef = useRef<Segment[]>(segments);
  const speedRef = useRef<number>(speed);
  const boundRef = useRef<{ start: number; end: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastPushRef = useRef<number>(0);

  const [playing, setPlaying] = useState(false);
  const [sourceTime, setSourceTime] = useState(0);
  const [outputTime, setOutputTime] = useState(0);

  const outputDuration = keptDuration(segments) / (speed > 0 ? speed : 1);

  useEffect(() => {
    segsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    speedRef.current = speed;
    const v = videoRef.current;
    if (v) v.playbackRate = speed > 0 ? speed : 1;
  }, [speed]);

  const pushTime = useCallback((src: number, force = false) => {
    const now = performance.now();
    if (!force && now - lastPushRef.current < 60) return;
    lastPushRef.current = now;
    setSourceTime(src);
    setOutputTime(sourceToOutput(src, segsRef.current, speedRef.current));
  }, []);

  const stopRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const pause = useCallback(() => {
    const v = videoRef.current;
    if (v) v.pause();
    boundRef.current = null;
    setPlaying(false);
    stopRaf();
    if (v) pushTime(v.currentTime, true);
  }, [pushTime, stopRaf]);

  const tick = useCallback(() => {
    const v = videoRef.current;
    const segs = segsRef.current;
    if (!v || segs.length === 0) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    const t = v.currentTime;
    const bound = boundRef.current;

    // Bounded (clip/block) preview reached its end.
    if (bound && t >= bound.end - 0.02) {
      pause();
      return;
    }

    // Skip removed gaps: if not inside any kept segment, jump forward.
    let inSeg = false;
    for (const s of segs) {
      if (t >= s.start - 0.001 && t < s.end) {
        inSeg = true;
        break;
      }
    }
    if (!inSeg) {
      const next = segs.find((s) => s.start > t - 0.001);
      if (next && (!bound || next.start < bound.end)) {
        v.currentTime = next.start;
      } else {
        // Past all kept content (or past the bound) → stop at the end.
        v.pause();
        boundRef.current = null;
        setPlaying(false);
        stopRaf();
        pushTime(segs[segs.length - 1].end, true);
        return;
      }
    }

    pushTime(v.currentTime);
    rafRef.current = requestAnimationFrame(tick);
  }, [pause, pushTime, stopRaf]);

  const play = useCallback(() => {
    const v = videoRef.current;
    const segs = segsRef.current;
    if (!v || segs.length === 0) return;
    // If at/after the end, restart from the first kept segment.
    const atEnd = v.currentTime >= segs[segs.length - 1].end - 0.02;
    if (atEnd) v.currentTime = segs[0].start;
    // If currently in a gap, snap into kept content.
    let inSeg = false;
    for (const s of segs) if (v.currentTime >= s.start && v.currentTime < s.end) inSeg = true;
    if (!inSeg) {
      const next = segs.find((s) => s.start >= v.currentTime) ?? segs[0];
      v.currentTime = next.start;
    }
    v.playbackRate = speedRef.current > 0 ? speedRef.current : 1;
    void v.play();
    setPlaying(true);
    stopRaf();
    rafRef.current = requestAnimationFrame(tick);
  }, [stopRaf, tick]);

  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [pause, play, playing]);

  const seekSource = useCallback(
    (t: number) => {
      const v = videoRef.current;
      if (!v) return;
      boundRef.current = null;
      v.currentTime = Math.max(0, t);
      pushTime(Math.max(0, t), true);
    },
    [pushTime],
  );

  const seekOutput = useCallback(
    (t: number) => {
      const src = outputToSource(t, segsRef.current, speedRef.current);
      seekSource(src);
    },
    [seekSource],
  );

  const playRange = useCallback(
    (startSource: number, endSource: number) => {
      const v = videoRef.current;
      if (!v) return;
      boundRef.current = { start: startSource, end: endSource };
      v.currentTime = Math.max(0, startSource);
      v.playbackRate = speedRef.current > 0 ? speedRef.current : 1;
      void v.play();
      setPlaying(true);
      stopRaf();
      rafRef.current = requestAnimationFrame(tick);
    },
    [stopRaf, tick],
  );

  // Cleanup on unmount.
  useEffect(() => stopRaf, [stopRaf]);

  return {
    videoRef,
    playing,
    outputTime,
    sourceTime,
    outputDuration,
    play,
    pause,
    toggle,
    seekOutput,
    seekSource,
    playRange,
  };
}
