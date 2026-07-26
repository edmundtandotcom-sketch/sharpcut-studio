import { useRef, useState } from 'react';
import { AlertTriangle, FileVideo, Loader2, RotateCcw, UploadCloud } from 'lucide-react';
import type { ProjectMeta, ProjectSnapshotV1 } from '../../types';
import { formatTime } from '../../lib/time';
import { ACCEPT_ATTR, validateVideoFile } from './validation';

const DURATION_TOLERANCE_S = 0.5;

interface Props {
  snapshot: ProjectSnapshotV1;
  onResolved: (args: { file: File; videoUrl: string; meta: ProjectMeta }) => void;
  onCancel: () => void;
}

type Phase = 'idle' | 'checking' | 'mismatch' | 'error';

/**
 * SPEC "LOCAL PROJECT RECOVERY": the browser cannot durably store the
 * original video file, so a recovered project (from IndexedDB autosave or an
 * opened project.json) always needs the user to reselect it. We validate the
 * reselected file the normal way, then confirm it's plausibly the same video
 * (name+size, or duration within 0.5s) before restoring. A mismatch never
 * silently proceeds — it's surfaced and requires an explicit override.
 */
export function ReselectVideo({ snapshot, onResolved, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<{ error: string; recovery: string } | null>(null);
  const [mismatchInfo, setMismatchInfo] = useState<string | null>(null);
  const pendingRef = useRef<{ file: File; videoUrl: string; meta: ProjectMeta } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { fingerprint, projectMeta } = snapshot;

  const handleFile = async (file: File) => {
    setPhase('checking');
    setError(null);
    setMismatchInfo(null);
    const objectUrl = URL.createObjectURL(file);
    try {
      const result = await validateVideoFile(file, objectUrl);
      if (!result.ok) {
        URL.revokeObjectURL(objectUrl);
        setError({ error: result.error, recovery: result.recovery });
        setPhase('error');
        return;
      }
      const nameSizeMatch = file.name === fingerprint.fileName && file.size === fingerprint.size;
      const durationMatch = Math.abs(result.meta.duration - fingerprint.duration) <= DURATION_TOLERANCE_S;

      if (nameSizeMatch || durationMatch) {
        onResolved({ file, videoUrl: objectUrl, meta: result.meta });
        return;
      }

      // Plausible mismatch — warn, but let the user override.
      pendingRef.current = { file, videoUrl: objectUrl, meta: result.meta };
      setMismatchInfo(
        `Expected "${fingerprint.fileName}" (${formatTime(fingerprint.duration)}), but this file is ` +
          `"${file.name}" (${formatTime(result.meta.duration)}).`,
      );
      setPhase('mismatch');
    } catch {
      URL.revokeObjectURL(objectUrl);
      setError({
        error: 'Something went wrong while checking this video.',
        recovery: 'Please try again, or choose a different file.',
      });
      setPhase('error');
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = '';
  };

  const useAnyway = () => {
    if (pendingRef.current) onResolved(pendingRef.current);
  };

  const chooseDifferent = () => {
    if (pendingRef.current) URL.revokeObjectURL(pendingRef.current.videoUrl);
    pendingRef.current = null;
    setMismatchInfo(null);
    setPhase('idle');
    inputRef.current?.click();
  };

  const checking = phase === 'checking';

  return (
    <div className="mx-auto mt-8 w-full max-w-lg rounded-2xl border border-primary/30 bg-primarySoft/40 p-6 text-center shadow-sm">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-white">
        <FileVideo className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-lg font-bold text-ink">
        Reselect the original video file to continue
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Your saved edits, transcript, and studio settings are ready to restore — but browsers can&rsquo;t
        keep the video file itself between sessions. Choose{' '}
        <span className="font-semibold text-ink">{fingerprint.fileName}</span> ({formatTime(fingerprint.duration)})
        to pick up where you left off.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        className="sr-only"
        onChange={onInputChange}
        aria-label="Reselect the original video file"
      />

      {phase === 'mismatch' ? (
        <div role="alert" className="mt-5 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-left text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
            <div>
              <p className="font-semibold text-ink">This doesn&rsquo;t look like the same video.</p>
              <p className="mt-0.5 text-muted">{mismatchInfo}</p>
              <p className="mt-1 text-muted">
                Timing may be slightly off if this isn&rsquo;t the exact original file.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={chooseDifferent}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface"
            >
              Choose a different file
            </button>
            <button
              type="button"
              onClick={useAnyway}
              className="rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            >
              Use this file anyway
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={checking}
          onClick={() => inputRef.current?.click()}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
        >
          {checking ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Checking video&hellip;
            </>
          ) : (
            <>
              <UploadCloud className="h-4 w-4" aria-hidden="true" />
              Choose video file
            </>
          )}
        </button>
      )}

      {phase === 'error' && error && (
        <div role="alert" className="mt-4 flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-left text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
          <div>
            <p className="font-semibold text-ink">{error.error}</p>
            <p className="mt-0.5 text-muted">{error.recovery}</p>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-muted">
        Project: <span className="font-medium text-ink">{projectMeta.name}</span>
      </p>

      <button
        type="button"
        onClick={onCancel}
        className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-ink hover:underline"
      >
        <RotateCcw className="h-3 w-3" aria-hidden="true" />
        Cancel and go back
      </button>
    </div>
  );
}
