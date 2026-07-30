import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  PenLine,
  Play,
  Redo2,
  Replace,
  Scissors,
  Undo2,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { wordSurvives } from '../../lib/captionTiming';
import type { Segment } from '../../types';
import { Section } from './settingsPrimitives';
import { formatTimecode } from './studioUtils';
import type { PreviewActions } from './usePreviewController';

interface Props {
  controller: PreviewActions;
  activeBlockId: string | null;
  /** Kept segments after active cuts — decides which caption words still render. */
  segments: Segment[];
}

const ROW_H = 138;
const VIEWPORT_H = 520;
const VIRTUALIZE_ABOVE = 60;

/** Per-block survival of the current cuts (see lib/captionTiming.wordSurvives). */
interface BlockRemoval {
  /** true/false per word in block.words — does it still render? */
  kept: boolean[];
  removedCount: number;
  /** No word survives: this block produces zero cues right now. */
  fullyRemoved: boolean;
}

export function CaptionEditorSection({ controller, activeBlockId, segments }: Props) {
  const blocks = useAppStore((s) => s.analysis.captionBlocks);
  const updateBlock = useAppStore((s) => s.updateCaptionBlock);
  const replaceAll = useAppStore((s) => s.replaceInCaptions);
  const undo = useAppStore((s) => s.undoCaptionEdit);
  const redo = useAppStore((s) => s.redoCaptionEdit);
  const canUndo = useAppStore((s) => s.captionEditor.past.length > 0);
  const canRedo = useAppStore((s) => s.captionEditor.future.length > 0);

  const [selected, setSelected] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [showFR, setShowFR] = useState(false);
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [lastReplace, setLastReplace] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualize = blocks.length > VIRTUALIZE_ABOVE;
  const total = blocks.length;

  const { start, end } = useMemo(() => {
    if (!virtualize) return { start: 0, end: total };
    const s = Math.max(0, Math.floor(scrollTop / ROW_H) - 3);
    const e = Math.min(total, Math.ceil((scrollTop + VIEWPORT_H) / ROW_H) + 3);
    return { start: s, end: e };
  }, [virtualize, scrollTop, total]);

  const visible = blocks.slice(start, end);

  // Which blocks/words are currently removed by active cuts. buildCaptionCues
  // silently drops these, so the editor has to say so — otherwise an edit to a
  // block inside a cut just vanishes with no explanation.
  const removal = useMemo(() => {
    const map = new Map<string, BlockRemoval>();
    let fullyRemovedBlocks = 0;
    for (const b of blocks) {
      const kept = b.words.map((w) => wordSurvives(w, segments));
      const removedCount = kept.reduce((n, k) => n + (k ? 0 : 1), 0);
      const fullyRemoved = b.words.length > 0 && removedCount === b.words.length;
      if (fullyRemoved) fullyRemovedBlocks++;
      if (removedCount > 0) map.set(b.id, { kept, removedCount, fullyRemoved });
    }
    return { map, fullyRemovedBlocks, affectedBlocks: map.size };
  }, [blocks, segments]);

  const gotoBlock = (idx: number) => {
    const b = blocks[idx];
    if (!b) return;
    setSelected(idx);
    controller.seekSource(b.start);
    if (virtualize && scrollRef.current) {
      scrollRef.current.scrollTop = idx * ROW_H - VIEWPORT_H / 2;
    }
  };

  const doReplace = () => {
    const n = replaceAll(find, replace);
    setLastReplace(n);
  };

  return (
    <Section
      step={5}
      title="Caption text editor"
      icon={PenLine}
      subtitle="Fix wording in timed blocks. Timing is preserved; karaoke re-syncs automatically."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => gotoBlock(Math.max(0, selected - 1))}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-bg"
        >
          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> Prev
        </button>
        <button
          type="button"
          onClick={() => gotoBlock(Math.min(total - 1, selected + 1))}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-bg"
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> Next
        </button>
        <span className="text-[11px] text-muted">
          Block {total ? selected + 1 : 0} of {total}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs font-semibold text-ink hover:bg-bg disabled:opacity-40"
            aria-label="Undo caption edit"
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs font-semibold text-ink hover:bg-bg disabled:opacity-40"
            aria-label="Redo caption edit"
          >
            <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setShowFR((v) => !v)}
            aria-pressed={showFR}
            className={[
              'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold',
              showFR ? 'border-primary bg-primarySoft text-primary' : 'border-border text-ink hover:bg-bg',
            ].join(' ')}
          >
            <Replace className="h-3.5 w-3.5" aria-hidden="true" /> Find
          </button>
        </div>
      </div>

      {showFR && (
        <div className="mb-3 rounded-lg border border-border bg-bg/60 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              type="text"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Find"
              aria-label="Find text"
              className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink"
            />
            <input
              type="text"
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder="Replace with"
              aria-label="Replace with text"
              className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink"
            />
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={doReplace}
              disabled={!find}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-40"
            >
              Replace all
            </button>
            {lastReplace != null && (
              <span className="text-[11px] text-muted">
                {lastReplace === 0 ? 'No matches' : `Replaced ${lastReplace} occurrence${lastReplace === 1 ? '' : 's'}`}
              </span>
            )}
          </div>
        </div>
      )}

      {removal.affectedBlocks > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-ink">
          <Scissors className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
          <span>
            <strong className="font-semibold">
              {removal.affectedBlocks} of {total} caption block
              {removal.affectedBlocks === 1 ? '' : 's'}
            </strong>{' '}
            {removal.affectedBlocks === 1 ? 'has' : 'have'} text inside removed sections
            {removal.fullyRemovedBlocks > 0 && (
              <> ({removal.fullyRemovedBlocks} removed entirely)</>
            )}
            . Struck-through words are not in the preview or the export. Restore the cut in
            Review to bring them back — your edits are kept either way.
          </span>
        </div>
      )}

      {total === 0 ? (
        <p className="text-xs text-muted">No caption blocks — this video has no detected speech.</p>
      ) : (
        <div
          ref={scrollRef}
          onScroll={(e) => virtualize && setScrollTop((e.target as HTMLDivElement).scrollTop)}
          className="overflow-y-auto scrollbar-stable"
          style={{ maxHeight: VIEWPORT_H }}
        >
          <div style={{ height: virtualize ? total * ROW_H : undefined, position: 'relative' }}>
            <div style={{ transform: virtualize ? `translateY(${start * ROW_H}px)` : undefined }}>
              {visible.map((b, i) => {
                const idx = start + i;
                const isActive = b.id === activeBlockId;
                const isSelected = idx === selected;
                const empty = b.text.trim() === '';
                const cut = removal.map.get(b.id);
                return (
                  <div
                    key={b.id}
                    style={virtualize ? { height: ROW_H } : undefined}
                    className={[
                      'mb-2 rounded-lg border p-2.5',
                      isActive
                        ? 'border-primary bg-primarySoft ring-1 ring-primary'
                        : isSelected
                          ? 'border-primary/50 bg-surface'
                          : cut?.fullyRemoved
                            ? 'border-warning/30 bg-warningSoft'
                            : 'border-border bg-surface',
                    ].join(' ')}
                    onFocusCapture={() => setSelected(idx)}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={[
                          'tabular-nums text-[11px] font-semibold text-muted',
                          cut?.fullyRemoved ? 'opacity-60' : '',
                        ].join(' ')}
                      >
                        {formatTimecode(b.start)} – {formatTimecode(b.end)}
                      </span>
                      <div className="flex items-center gap-2">
                        {empty && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-danger">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Empty
                          </span>
                        )}
                        {cut?.fullyRemoved && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning"
                            title="Removed by a cut — restore it in Review to include this caption"
                          >
                            <Scissors className="h-3 w-3" aria-hidden="true" /> Removed by a cut
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => controller.playRange(b.start, b.end)}
                          className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-ink hover:bg-bg"
                          aria-label={`Play block at ${formatTimecode(b.start)}`}
                        >
                          <Play className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    {/* Editing stays on the FULL block text — this strip only shows
                        which of those words currently survive the cuts. */}
                    {cut && (
                      <p className="mt-1 truncate text-[10px] leading-4 text-muted">
                        {b.words.map((w, wi) => (
                          <span
                            key={wi}
                            className={
                              cut.kept[wi] ? 'text-ink' : 'text-warning/70 line-through decoration-warning/60'
                            }
                          >
                            {w.text}{' '}
                          </span>
                        ))}
                      </p>
                    )}
                    {cut?.fullyRemoved && (
                      <p className="mt-0.5 text-[10px] leading-4 text-warning">
                        Removed by a cut — restore it in Review to include this caption. Your edit
                        is saved and will reappear.
                      </p>
                    )}
                    <textarea
                      value={b.text}
                      onChange={(e) => updateBlock(b.id, e.target.value)}
                      rows={2}
                      aria-label={`Caption text for block at ${formatTimecode(b.start)}${
                        cut?.fullyRemoved ? ' (currently removed by a cut)' : ''
                      }`}
                      className={[
                        'mt-1.5 w-full resize-none rounded-md border border-border bg-bg/50 px-2 py-1.5 text-sm text-ink focus:bg-surface',
                        cut?.fullyRemoved ? 'opacity-60 focus:opacity-100' : '',
                      ].join(' ')}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}
