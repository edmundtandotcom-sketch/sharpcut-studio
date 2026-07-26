import { memo, useMemo, useState } from 'react';
import { Play, Shuffle, Sparkles, Trash2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { Segment, TransitionPoint, TransitionType } from '../../types';
import { sourceToOutput } from '../../lib/cuts';
import { id as makeId } from '../../lib/time';
import {
  TRANSITION_DEFAULT_MS,
  TRANSITION_LABELS,
  TRANSITION_ORDER,
  applyTypeToAllBoundaries,
  suggestTransitions,
} from '../../lib/transitionsSuggest';
import { Section } from './settingsPrimitives';
import type { PreviewActions } from './usePreviewController';

interface Props {
  controller: PreviewActions;
  segments: Segment[];
  speed: number;
}

const MIN_GAP_SHOWN = 0.5;

export const TransitionsSection = memo(function TransitionsSection({ controller, segments, speed }: Props) {
  const transitions = useAppStore((s) => s.studio.transitions);
  const setTransitions = useAppStore((s) => s.studio.setTransitions);
  const [bulkType, setBulkType] = useState<TransitionType>('quickFade');

  const byBoundary = useMemo(() => {
    const m = new Map<number, TransitionPoint>();
    for (const t of transitions) m.set(t.boundaryIndex, t);
    return m;
  }, [transitions]);

  // Interior boundaries worth showing (meaningful removed gap).
  const boundaries = useMemo(() => {
    const list: { index: number; gap: number }[] = [];
    for (let i = 0; i < segments.length - 1; i++) {
      const gap = Math.max(0, segments[i + 1].start - segments[i].end);
      if (gap >= MIN_GAP_SHOWN || byBoundary.has(i)) list.push({ index: i, gap });
    }
    return list.sort((a, b) => b.gap - a.gap).slice(0, 40).sort((a, b) => a.index - b.index);
  }, [segments, byBoundary]);

  const setBoundaryType = (boundaryIndex: number, type: TransitionType) => {
    const next = transitions.filter((t) => t.boundaryIndex !== boundaryIndex);
    if (type !== 'none') {
      next.push({ id: makeId(), boundaryIndex, type, durationMs: TRANSITION_DEFAULT_MS[type] });
    }
    setTransitions(next.sort((a, b) => a.boundaryIndex - b.boundaryIndex));
  };

  const previewBoundary = (boundaryIndex: number) => {
    const seg = segments[boundaryIndex];
    if (!seg) return;
    const bOut = sourceToOutput(seg.end, segments, speed);
    controller.seekOutput(Math.max(0, bOut - 0.5));
    controller.play();
  };

  return (
    <Section
      step={6}
      title="Transitions"
      icon={Shuffle}
      subtitle="Short, tasteful transitions at major section changes — not every tiny cut."
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTransitions(suggestTransitions(segments))}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Apply suggested
        </button>
        <div className="inline-flex items-center gap-1 rounded-lg border border-border p-0.5">
          <select
            value={bulkType}
            onChange={(e) => setBulkType(e.target.value as TransitionType)}
            aria-label="Transition type to apply to all major boundaries"
            className="rounded-md bg-surface px-2 py-1 text-xs text-ink"
          >
            {TRANSITION_ORDER.filter((t) => t !== 'none').map((t) => (
              <option key={t} value={t}>
                {TRANSITION_LABELS[t]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setTransitions(applyTypeToAllBoundaries(segments, bulkType, boundaries.length || 40))}
            className="rounded-md px-2 py-1 text-xs font-semibold text-ink hover:bg-bg"
          >
            Apply to all
          </button>
        </div>
        {transitions.length > 0 && (
          <button
            type="button"
            onClick={() => setTransitions([])}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-bg"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Clear
          </button>
        )}
      </div>

      {boundaries.length === 0 ? (
        <p className="mt-4 text-xs text-muted">
          No major boundaries detected — transitions work best where larger gaps were removed.
        </p>
      ) : (
        <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1 scrollbar-stable">
          {boundaries.map(({ index, gap }) => {
            const tp = byBoundary.get(index);
            const type = tp?.type ?? 'none';
            return (
              <li key={index} className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2">
                <span className="w-24 shrink-0 text-[11px] text-muted">
                  Cut {index + 1}
                  <span className="block tabular-nums">−{gap.toFixed(1)}s gap</span>
                </span>
                <select
                  value={type}
                  onChange={(e) => setBoundaryType(index, e.target.value as TransitionType)}
                  aria-label={`Transition at boundary ${index + 1}`}
                  className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink"
                >
                  {TRANSITION_ORDER.map((t) => (
                    <option key={t} value={t}>
                      {TRANSITION_LABELS[t]}
                      {t !== 'none' ? ` · ${TRANSITION_DEFAULT_MS[t]}ms` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => previewBoundary(index)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-ink hover:bg-bg"
                  aria-label={`Preview transition at boundary ${index + 1}`}
                >
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
});
