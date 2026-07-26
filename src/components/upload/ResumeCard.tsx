import { History, Trash2 } from 'lucide-react';
import type { ProjectSnapshotV1 } from '../../types';
import { formatTime } from '../../lib/time';

function formatSavedAt(ms: number): string {
  const d = new Date(ms);
  const diffMin = Math.round((Date.now() - ms) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface Props {
  snapshot: ProjectSnapshotV1;
  onResume: () => void;
  onDiscard: () => void;
}

/** SPEC "LOCAL PROJECT RECOVERY": offered on the upload screen when a saved
 * project exists. Never implies the video itself was saved — only that edit
 * decisions can be restored once the file is reselected. */
export function ResumeCard({ snapshot, onResume, onDiscard }: Props) {
  return (
    <div className="mx-auto mb-8 w-full max-w-lg rounded-2xl border border-primary/30 bg-primarySoft/50 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-white">
          <History className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 text-left">
          <p className="text-sm font-bold text-ink">Resume previous project?</p>
          <p className="mt-1 truncate text-sm font-medium text-ink">{snapshot.projectMeta.name}</p>
          <p className="mt-0.5 text-xs text-muted">
            {snapshot.fingerprint.fileName} &middot; {formatTime(snapshot.fingerprint.duration)} &middot; saved{' '}
            {formatSavedAt(snapshot.savedAt)}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Your edit decisions, captions, and studio settings were saved on this device. The video file
            itself wasn&rsquo;t &mdash; you&rsquo;ll be asked to reselect it.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onResume}
              className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary/90"
            >
              Resume
            </button>
            <button
              type="button"
              onClick={onDiscard}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-4 py-2 text-xs font-semibold text-ink hover:bg-bg"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Discard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
