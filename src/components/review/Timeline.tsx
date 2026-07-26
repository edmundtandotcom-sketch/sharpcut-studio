import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Cut } from '../../types';
import { clamp, formatTime } from '../../lib/time';

interface Props {
  duration: number;
  currentTime: number;
  /** Merged, active-only cut ranges (source seconds) — shaded translucent red. */
  activeRanges: Cut[];
  pendingIn: number | null;
  pendingOut: number | null;
  onSeek: (time: number) => void;
}

/** Custom click/drag/keyboard scrubber bar with cut shading, manual markers, and a playhead. */
export function Timeline({ duration, currentTime, activeRanges, pendingIn, pendingOut, onSeek }: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const safeDuration = duration > 0 ? duration : 1;

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return 0;
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      return ratio * safeDuration;
    },
    [safeDuration],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: globalThis.PointerEvent) => onSeek(timeFromClientX(e.clientX));
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, onSeek, timeFromClientX]);

  const pct = (t: number) => `${clamp((t / safeDuration) * 100, 0, 100)}%`;

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onSeek(clamp(currentTime - step, 0, duration));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onSeek(clamp(currentTime + step, 0, duration));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onSeek(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onSeek(duration);
    }
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    setDragging(true);
    onSeek(timeFromClientX(e.clientX));
  };

  const selRange =
    pendingIn != null && pendingOut != null
      ? { start: Math.min(pendingIn, pendingOut), end: Math.max(pendingIn, pendingOut) }
      : null;

  return (
    <div className="pt-3">
      <div
        ref={barRef}
        role="slider"
        tabIndex={0}
        aria-label="Video timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={formatTime(currentTime)}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        className="relative h-11 w-full touch-none select-none rounded-lg border border-border bg-border/30"
      >
        {activeRanges.map((r) => (
          <div
            key={r.id}
            aria-hidden="true"
            className="absolute inset-y-0 bg-danger/25"
            style={{ left: pct(r.start), width: pct(Math.max(0, r.end - r.start)) }}
          />
        ))}

        {selRange && (
          <div
            aria-hidden="true"
            className="absolute inset-y-0 bg-danger/40 ring-1 ring-inset ring-danger"
            style={{ left: pct(selRange.start), width: pct(Math.max(0, selRange.end - selRange.start)) }}
          />
        )}

        {pendingIn != null && (
          <div aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-danger" style={{ left: pct(pendingIn) }} />
        )}
        {pendingOut != null && (
          <div aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-danger" style={{ left: pct(pendingOut) }} />
        )}

        <div aria-hidden="true" className="absolute inset-y-0 w-px bg-ink" style={{ left: pct(currentTime) }} />
        <div
          aria-hidden="true"
          className="absolute -top-1 h-3 w-3 -translate-x-1/2 rounded-full bg-ink shadow"
          style={{ left: pct(currentTime) }}
        />
      </div>

      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>0:00</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
