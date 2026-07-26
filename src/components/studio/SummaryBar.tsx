import { useMemo } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { Segment } from '../../types';
import { keptDuration, sourceToOutput } from '../../lib/cuts';
import { formatTime } from '../../lib/time';
import { FORMAT_LABELS } from './studioUtils';

interface Props {
  segments: Segment[];
  speed: number;
}

const QUALITY_LABELS = { standard: 'Standard', high: 'High', source: 'Source-conscious' } as const;

export function SummaryBar({ segments, speed }: Props) {
  const mode = useAppStore((s) => s.studio.mode);
  const format = useAppStore((s) => s.studio.format);
  const quality = useAppStore((s) => s.studio.quality);
  const selected = useAppStore((s) => s.studio.selectedClipIndices);
  const requested = useAppStore((s) => s.exportJob.requested);
  const exportError = useAppStore((s) => s.exportJob.error);
  const requestExport = useAppStore((s) => s.requestExport);

  const outputDuration = keptDuration(segments) / (speed > 0 ? speed : 1);

  const selectedDuration = useMemo(() => {
    if (mode !== 'clips') return 0;
    return segments
      .filter((s) => selected.includes(s.index))
      .reduce((sum, s) => sum + (sourceToOutput(s.end, segments, speed) - sourceToOutput(s.start, segments, speed)), 0);
  }, [mode, segments, selected, speed]);

  const noSegments = segments.length === 0;
  const clipsEmpty = mode === 'clips' && selected.length === 0;
  const disabled = noSegments || clipsEmpty;

  return (
    <div className="sticky bottom-0 -mx-1 mt-4 border-t border-border bg-surface/95 px-3 pb-3 pt-3 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <div className="rounded-xl border border-border bg-bg/70 p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>
            Output{' '}
            <strong className="tabular-nums text-ink">
              {formatTime(mode === 'clips' ? selectedDuration : outputDuration)}
            </strong>
            {mode === 'clips' && <span> · {selected.length} clip{selected.length === 1 ? '' : 's'}</span>}
          </span>
          <span>Mode <strong className="text-ink">{mode === 'clips' ? 'Clips' : 'Combined'}</strong></span>
          <span>Format <strong className="text-ink">{FORMAT_LABELS[format]}</strong></span>
          <span>Quality <strong className="text-ink">{QUALITY_LABELS[quality]}</strong></span>
        </div>

        <button
          type="button"
          onClick={requestExport}
          disabled={disabled}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {requested ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Export queued…
            </>
          ) : (
            <>
              <Download className="h-4 w-4" aria-hidden="true" />
              Export {mode === 'clips' ? `${selected.length || ''} clip${selected.length === 1 ? '' : 's'}`.trim() : 'video'}
            </>
          )}
        </button>

        {clipsEmpty && (
          <p className="mt-2 text-center text-[11px] text-danger">Select at least one clip to export.</p>
        )}
        {exportError && exportError !== 'cancelled' && (
          <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-center text-[11px] font-medium text-danger">
            {exportError}
          </p>
        )}
      </div>
    </div>
  );
}
