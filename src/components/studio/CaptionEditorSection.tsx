import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  PenLine,
  Play,
  Redo2,
  Replace,
  Undo2,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { Section } from './settingsPrimitives';
import { formatTimecode } from './studioUtils';
import type { PreviewActions } from './usePreviewController';

interface Props {
  controller: PreviewActions;
  activeBlockId: string | null;
}

const ROW_H = 116;
const VIEWPORT_H = 520;
const VIRTUALIZE_ABOVE = 60;

export function CaptionEditorSection({ controller, activeBlockId }: Props) {
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
                          : 'border-border bg-surface',
                    ].join(' ')}
                    onFocusCapture={() => setSelected(idx)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="tabular-nums text-[11px] font-semibold text-muted">
                        {formatTimecode(b.start)} – {formatTimecode(b.end)}
                      </span>
                      <div className="flex items-center gap-2">
                        {empty && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-danger">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Empty
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
                    <textarea
                      value={b.text}
                      onChange={(e) => updateBlock(b.id, e.target.value)}
                      rows={2}
                      aria-label={`Caption text for block at ${formatTimecode(b.start)}`}
                      className="mt-1.5 w-full resize-none rounded-md border border-border bg-bg/50 px-2 py-1.5 text-sm text-ink focus:bg-surface"
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
