import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, RotateCcw } from 'lucide-react';
import type { Cut, CutType } from '../../types';
import { EditCard } from './EditCard';
import { FILTER_TABS } from './cutTypeMeta';

/** Approximate rendered card height (incl. gap) — used only for cheap windowed-scroll math. */
const ROW_HEIGHT = 176;
const VIRTUALIZE_THRESHOLD = 200;
const OVERSCAN = 4;

interface Props {
  cuts: Cut[];
  onToggle: (id: string) => void;
  onPlayContext: (cut: Cut) => void;
  onSelectAll: () => void;
  onRestoreAll: () => void;
}

/** Right column: heading, counts, select/restore all, type filters, independently-scrolling list. */
export function EditList({ cuts, onToggle, onPlayContext, onSelectAll, onRestoreAll }: Props) {
  const [filter, setFilter] = useState<'all' | CutType>('all');
  const listRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 0 });

  const sorted = useMemo(() => [...cuts].sort((a, b) => a.start - b.start), [cuts]);
  const filtered = useMemo(
    () => (filter === 'all' ? sorted : sorted.filter((c) => c.type === filter)),
    [sorted, filter],
  );
  const selectedCount = useMemo(() => cuts.filter((c) => c.active).length, [cuts]);
  const virtualize = filtered.length > VIRTUALIZE_THRESHOLD;

  // Simple slice-based windowing: only recompute the visible slice on scroll,
  // padded above/below with spacer height so total scroll extent is preserved.
  useEffect(() => {
    const el = listRef.current;
    if (!virtualize || !el) {
      setRange({ start: 0, end: filtered.length });
      return;
    }
    const update = () => {
      const start = Math.max(0, Math.floor(el.scrollTop / ROW_HEIGHT) - OVERSCAN);
      const visibleCount = Math.ceil(el.clientHeight / ROW_HEIGHT) + OVERSCAN * 2;
      setRange({ start, end: Math.min(filtered.length, start + visibleCount) });
    };
    update();
    el.addEventListener('scroll', update);
    return () => el.removeEventListener('scroll', update);
  }, [virtualize, filtered.length]);

  const visibleItems = virtualize ? filtered.slice(range.start, range.end) : filtered;
  const topPad = virtualize ? range.start * ROW_HEIGHT : 0;
  const bottomPad = virtualize ? Math.max(0, filtered.length - range.end) * ROW_HEIGHT : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-10 -mx-1 bg-bg/95 px-1 pb-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-ink">Suggested edits</h2>
          <span className="rounded-full bg-primarySoft px-2.5 py-1 text-xs font-semibold text-primary">
            {selectedCount} selected
          </span>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onSelectAll}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface"
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Select all
          </button>
          <button
            type="button"
            onClick={onRestoreAll}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Restore all
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter suggested edits by type">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={filter === tab.key}
              onClick={() => setFilter(tab.key)}
              className={[
                'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                filter === tab.key
                  ? 'bg-primary text-white'
                  : 'border border-border bg-surface text-muted hover:bg-bg',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={listRef} className="scrollbar-stable min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
        {filtered.length === 0 ? (
          <p className="px-1 py-8 text-center text-sm text-muted">No edits in this filter.</p>
        ) : (
          <ul className="space-y-3 pb-2" style={{ paddingTop: topPad, paddingBottom: bottomPad }}>
            {visibleItems.map((cut) => (
              <EditCard
                key={cut.id}
                cut={cut}
                onToggle={() => onToggle(cut.id)}
                onPlayContext={() => onPlayContext(cut)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
