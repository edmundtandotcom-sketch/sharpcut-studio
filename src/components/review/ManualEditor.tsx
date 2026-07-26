import { AlertCircle, Flag, MapPin, Play, Scissors, Undo2, XCircle } from 'lucide-react';
import { formatTime } from '../../lib/time';

interface Props {
  pendingIn: number | null;
  pendingOut: number | null;
  manualCutCount: number;
  error: string | null;
  onSetIn: () => void;
  onSetOut: () => void;
  onClear: () => void;
  onJumpIn: () => void;
  onJumpOut: () => void;
  onPlaySelected: () => void;
  onRemove: () => void;
  onUndo: () => void;
}

/** SPEC "MANUAL MAIN-VIDEO EDITOR" panel: IN/OUT markers, selected range, and reversible removal. */
export function ManualEditor({
  pendingIn,
  pendingOut,
  manualCutCount,
  error,
  onSetIn,
  onSetOut,
  onClear,
  onJumpIn,
  onJumpOut,
  onPlaySelected,
  onRemove,
  onUndo,
}: Props) {
  const btn =
    'inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-ink hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40';
  const primaryBtn =
    'inline-flex items-center gap-1.5 rounded-lg bg-danger px-3 py-2 text-xs font-semibold text-white hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="mt-4 rounded-xl border border-danger/30 bg-danger/5 p-4">
      <h3 className="text-sm font-bold text-ink">Manual clip editor</h3>
      <p className="mt-1 text-xs text-muted">
        Move the playhead, mark an IN and OUT point, then remove the range in between.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={onSetIn}>
          <Flag className="h-3.5 w-3.5 text-danger" aria-hidden="true" /> Set IN
        </button>
        <button type="button" className={btn} onClick={onSetOut}>
          <Flag className="h-3.5 w-3.5 text-danger" aria-hidden="true" /> Set OUT
        </button>
        <button type="button" className={btn} onClick={onJumpIn} disabled={pendingIn == null}>
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> Jump to IN
        </button>
        <button type="button" className={btn} onClick={onJumpOut} disabled={pendingOut == null}>
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> Jump to OUT
        </button>
        <button
          type="button"
          className={btn}
          onClick={onPlaySelected}
          disabled={pendingIn == null || pendingOut == null}
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" /> Play selected range
        </button>
        <button type="button" className={btn} onClick={onClear} disabled={pendingIn == null && pendingOut == null}>
          <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Clear IN/OUT
        </button>
        <button type="button" className={btn} onClick={onUndo} disabled={manualCutCount === 0}>
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Undo last manual cut
        </button>
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs">
        <span className="text-muted">
          IN:{' '}
          <span className="font-semibold tabular-nums text-danger">
            {pendingIn != null ? formatTime(pendingIn) : '—'}
          </span>
        </span>
        <span className="text-muted">
          OUT:{' '}
          <span className="font-semibold tabular-nums text-danger">
            {pendingOut != null ? formatTime(pendingOut) : '—'}
          </span>
        </span>
      </div>

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <button
        type="button"
        className={`${primaryBtn} mt-3`}
        onClick={onRemove}
        disabled={pendingIn == null || pendingOut == null}
      >
        <Scissors className="h-3.5 w-3.5" aria-hidden="true" /> Remove selected range
      </button>
    </div>
  );
}
