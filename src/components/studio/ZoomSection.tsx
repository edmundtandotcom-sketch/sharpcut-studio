import { memo, useMemo } from 'react';
import { Play, Plus, Sparkles, Trash2, ZoomIn } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { Segment, ZoomEffect, ZoomType } from '../../types';
import { sourceToOutput } from '../../lib/cuts';
import { id as makeId } from '../../lib/time';
import { ZOOM_DEFAULT_MS, ZOOM_DEFAULT_SCALE, ZOOM_LABELS, ZOOM_ORDER, suggestZooms } from '../../lib/zoomSuggest';
import { formatTime } from '../../lib/time';
import { Section } from './settingsPrimitives';
import type { PreviewActions } from './usePreviewController';

interface Props {
  controller: PreviewActions;
  segments: Segment[];
  speed: number;
}

export const ZoomSection = memo(function ZoomSection({ controller, segments, speed }: Props) {
  const zooms = useAppStore((s) => s.studio.zooms);
  const setZooms = useAppStore((s) => s.studio.setZooms);

  const bySegment = useMemo(() => {
    // One row per segment. When a segment has a punch-in plus a later Reset
    // (auto-suggest on long segments), surface the punch-in as the segment's
    // primary effect so the dropdown reflects the visible zoom.
    const m = new Map<number, ZoomEffect>();
    for (const z of zooms) {
      const existing = m.get(z.segmentIndex);
      if (!existing || (existing.type === 'reset' && z.type !== 'reset')) {
        m.set(z.segmentIndex, z);
      }
    }
    return m;
  }, [zooms]);

  // Segments long enough to be candidates (plus any that already have a zoom).
  const candidates = useMemo(
    () => segments.filter((s) => s.end - s.start >= 3 || bySegment.has(s.index)),
    [segments, bySegment],
  );

  const setSegmentZoom = (seg: Segment, type: ZoomType | 'none') => {
    const next = zooms.filter((z) => z.segmentIndex !== seg.index);
    if (type !== 'none') {
      next.push({
        id: makeId(),
        segmentIndex: seg.index,
        atSource: Math.min(seg.end - 0.3, seg.start + 0.4),
        type,
        scale: ZOOM_DEFAULT_SCALE[type],
        durationMs: ZOOM_DEFAULT_MS[type],
      });
    }
    setZooms(next.sort((a, b) => a.segmentIndex - b.segmentIndex));
  };

  const previewZoom = (z: ZoomEffect) => {
    const out = sourceToOutput(z.atSource, segments, speed);
    controller.seekOutput(Math.max(0, out - 0.3));
    controller.play();
  };

  return (
    <Section
      step={7}
      title="Zoom effects"
      icon={ZoomIn}
      subtitle="Quick, punchy zooms on longer segments. Fast by design — never slow drifts."
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setZooms(suggestZooms(segments))}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Auto-suggest
        </button>
        {zooms.length > 0 && (
          <button
            type="button"
            onClick={() => setZooms([])}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-bg"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Clear
          </button>
        )}
        <span className="text-[11px] text-muted">{zooms.length} active</span>
      </div>

      {candidates.length === 0 ? (
        <p className="mt-4 text-xs text-muted">No segments long enough for a zoom effect.</p>
      ) : (
        <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1 scrollbar-stable">
          {candidates.map((seg) => {
            const z = bySegment.get(seg.index);
            const type: ZoomType | 'none' = z?.type ?? 'none';
            const outStart = sourceToOutput(seg.start, segments, speed);
            return (
              <li key={seg.index} className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2">
                <span className="w-24 shrink-0 text-[11px] text-muted">
                  Segment {seg.index + 1}
                  <span className="block tabular-nums">@ {formatTime(outStart)}</span>
                </span>
                <select
                  value={type}
                  onChange={(e) => setSegmentZoom(seg, e.target.value as ZoomType | 'none')}
                  aria-label={`Zoom for segment ${seg.index + 1}`}
                  className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink"
                >
                  <option value="none">No zoom</option>
                  {ZOOM_ORDER.map((t) => (
                    <option key={t} value={t}>
                      {ZOOM_LABELS[t]} · {ZOOM_DEFAULT_MS[t]}ms
                    </option>
                  ))}
                </select>
                {z ? (
                  <button
                    type="button"
                    onClick={() => previewZoom(z)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-ink hover:bg-bg"
                    aria-label={`Preview zoom on segment ${seg.index + 1}`}
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSegmentZoom(seg, 'punchIn')}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-ink hover:bg-bg"
                    aria-label={`Add zoom to segment ${seg.index + 1}`}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
});
