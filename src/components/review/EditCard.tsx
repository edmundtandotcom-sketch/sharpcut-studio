import { Play } from 'lucide-react';
import type { Cut } from '../../types';
import { formatTime } from '../../lib/time';
import { CUT_TYPE_META } from './cutTypeMeta';
import { Switch } from './Switch';

interface Props {
  cut: Cut;
  onToggle: () => void;
  onPlayContext: () => void;
}

/** One suggested-edit card: type badge, timestamp, duration removed, transcript context, active toggle, play-context. */
export function EditCard({ cut, onToggle, onPlayContext }: Props) {
  const meta = CUT_TYPE_META[cut.type];
  const Icon = meta.icon;
  const removedS = Math.max(0, cut.end - cut.start);

  return (
    <li
      className={[
        'rounded-xl border bg-surface p-4 shadow-sm transition-opacity',
        cut.active ? 'border-border' : 'border-border/60 opacity-60',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={[
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
              meta.badgeClass,
            ].join(' ')}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {meta.label}
          </span>
          <span className="tabular-nums text-xs text-muted">
            {formatTime(cut.start)}&ndash;{formatTime(cut.end)}
          </span>
        </div>
        <Switch
          checked={cut.active}
          onChange={onToggle}
          label={`${cut.active ? 'Deactivate' : 'Activate'} ${meta.label.toLowerCase()} cut at ${formatTime(cut.start)}`}
        />
      </div>

      <p className="mt-2 text-xs text-muted">
        Removes <span className="font-semibold text-ink">{removedS.toFixed(1)}s</span>
        {cut.reason ? <> &middot; {cut.reason}</> : null}
      </p>

      {cut.transcriptContext && (
        <p className="mt-2 line-clamp-2 rounded-lg bg-bg px-3 py-2 text-xs italic leading-relaxed text-ink/80">
          &ldquo;{cut.transcriptContext}&rdquo;
        </p>
      )}

      <button
        type="button"
        onClick={onPlayContext}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-bg"
      >
        <Play className="h-3.5 w-3.5" aria-hidden="true" />
        Play context
      </button>
    </li>
  );
}
