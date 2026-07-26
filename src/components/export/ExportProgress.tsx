import { AlertTriangle, Loader2, RotateCcw, X } from 'lucide-react';
import { formatTime } from '../../lib/time';

interface Props {
  stage: string;
  pct: number;
  elapsedS: number;
  error: string | null;
  onCancel: () => void;
  onRetry: () => void;
  onClose: () => void;
}

/**
 * Full-screen export overlay (SPEC "Export progress"): current stage, real %,
 * elapsed time, cancel, a do-not-close warning, and a failure card with retry.
 */
export function ExportProgress({ stage, pct, elapsedS, error, onCancel, onRetry, onClose }: Props) {
  const clamped = Math.max(0, Math.min(100, pct));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 px-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={error ? 'Export failed' : 'Exporting video'}
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-7 shadow-xl"
      >
        {error ? (
          <>
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-danger/10 text-danger">
              <AlertTriangle className="h-6 w-6" aria-hidden="true" />
            </span>
            <h2 className="mt-5 text-center text-xl font-extrabold text-ink">Export failed</h2>
            <p className="mt-2 text-center text-sm leading-relaxed text-muted">{error}</p>
            <p className="mt-3 rounded-lg bg-bg px-3 py-2 text-center text-xs text-muted">
              Your edit decisions are safe — nothing was lost. You can retry, or go back and switch to
              Standard quality or Individual clips.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-ink hover:bg-bg"
              >
                Back to studio
              </button>
              <button
                type="button"
                onClick={onRetry}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary/90"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Retry export
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primarySoft text-primary">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-ink">Exporting your video</h2>
                <p className="truncate text-xs text-muted">{stage}</p>
              </div>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between text-xs font-medium text-muted">
                <span className="tabular-nums text-ink">{Math.round(clamped)}%</span>
                <span className="tabular-nums">Elapsed {formatTime(elapsedS)}</span>
              </div>
              <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                  style={{ width: `${clamped}%` }}
                  role="progressbar"
                  aria-valuenow={Math.round(clamped)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
            </div>

            <p className="mt-4 rounded-lg bg-highlight/25 px-3 py-2 text-center text-xs font-medium text-ink">
              Keep this tab open until the export finishes.
            </p>

            <button
              type="button"
              onClick={onCancel}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-ink hover:bg-bg"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Cancel export
            </button>
          </>
        )}
      </div>
    </div>
  );
}
