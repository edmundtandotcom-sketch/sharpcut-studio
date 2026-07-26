import { memo, useMemo } from 'react';
import { Film, Layers, Play } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { Segment, WordStamp } from '../../types';
import { formatTime } from '../../lib/time';
import { sourceToOutput } from '../../lib/cuts';
import { Section, SelectCard } from './settingsPrimitives';
import type { PreviewActions } from './usePreviewController';

interface Props {
  controller: PreviewActions;
  segments: Segment[];
  speed: number;
  words: WordStamp[];
}

function snippet(words: WordStamp[], seg: Segment): string {
  const inSeg = words.filter((w) => w.start >= seg.start - 0.1 && w.start < seg.end);
  const text = inSeg.slice(0, 9).map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim();
  return text ? (inSeg.length > 9 ? `${text}…` : text) : 'No speech in this clip';
}

export const ModeSection = memo(function ModeSection({ controller, segments, speed, words }: Props) {
  const mode = useAppStore((s) => s.studio.mode);
  const selected = useAppStore((s) => s.studio.selectedClipIndices);
  const setMode = useAppStore((s) => s.studio.setMode);
  const toggleClip = useAppStore((s) => s.studio.toggleClipIndex);
  const setSelected = useAppStore((s) => s.studio.setSelectedClipIndices);

  const clips = useMemo(
    () =>
      segments.map((seg) => {
        const outStart = sourceToOutput(seg.start, segments, speed);
        const outEnd = sourceToOutput(seg.end, segments, speed);
        return {
          seg,
          outStart,
          outEnd,
          duration: outEnd - outStart,
          text: snippet(words, seg),
        };
      }),
    [segments, speed, words],
  );

  const allSelected = selected.length === segments.length && segments.length > 0;

  return (
    <Section
      step={1}
      title="Export mode"
      icon={Layers}
      subtitle="One combined video, or each kept section as its own clip."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectCard
          selected={mode === 'combined'}
          onClick={() => setMode('combined')}
          label="Full combined video"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Film className="h-4 w-4 text-primary" aria-hidden="true" />
            Full combined video
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-muted">
            Join every kept segment into one MP4.
          </span>
        </SelectCard>
        <SelectCard
          selected={mode === 'clips'}
          onClick={() => setMode('clips')}
          label="Individual clips"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Layers className="h-4 w-4 text-primary" aria-hidden="true" />
            Individual clips
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-muted">
            Export each kept section as a separate MP4.
          </span>
        </SelectCard>
      </div>

      {mode === 'clips' && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink">
              {selected.length} of {segments.length} clips selected
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSelected(allSelected ? [] : segments.map((s) => s.index))}
                className="text-xs font-semibold text-primary hover:underline"
              >
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
            </div>
          </div>
          <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1 scrollbar-stable">
            {clips.map(({ seg, outStart, outEnd, duration, text }) => {
              const isSel = selected.includes(seg.index);
              return (
                <li
                  key={seg.index}
                  className={[
                    'flex items-start gap-3 rounded-lg border p-2.5',
                    isSel ? 'border-primary/60 bg-primarySoft/50' : 'border-border bg-surface',
                  ].join(' ')}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggleClip(seg.index)}
                    aria-label={`Select clip ${seg.index + 1}`}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-ink">Clip {seg.index + 1}</span>
                      <span className="tabular-nums text-[11px] text-muted">
                        {formatTime(outStart)}–{formatTime(outEnd)} · {duration.toFixed(1)}s
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted">{text}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => controller.playRange(seg.start, seg.end)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-ink hover:bg-bg"
                    aria-label={`Preview clip ${seg.index + 1}`}
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Section>
  );
});
