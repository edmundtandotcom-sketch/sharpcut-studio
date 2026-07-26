import { useEffect, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { ProjectSnapshotV1 } from '../../types';
import { clearProjectSnapshot, loadProjectSnapshot, parseProjectSnapshotFile } from '../../lib/persist';
import { ResumeCard } from './ResumeCard';
import { ReselectVideo } from './ReselectVideo';

interface Props {
  /** Fires whenever the reselect-video step opens/closes, so the parent can
   * hide the rest of the upload screen while it's focused on recovery. */
  onModeChange?: (active: boolean) => void;
}

/**
 * Owns SPEC "LOCAL PROJECT RECOVERY" end to end on the upload screen:
 * - checks IndexedDB for an autosaved snapshot and offers Resume/Discard;
 * - offers "Open project file" (a downloaded sharpcut-project.json);
 * - once the user commits to either, hands off to <ReselectVideo> to get the
 *   original video back before restoring state into the store.
 */
export function ProjectRecoveryPanel({ onModeChange }: Props) {
  const restoreFromSnapshot = useAppStore((s) => s.restoreFromSnapshot);
  const [autoSnapshot, setAutoSnapshot] = useState<ProjectSnapshotV1 | null>(null);
  const [pending, setPending] = useState<ProjectSnapshotV1 | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void loadProjectSnapshot().then((snap) => {
      if (!cancelled && snap) setAutoSnapshot(snap);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onDiscard = () => {
    void clearProjectSnapshot();
    setAutoSnapshot(null);
  };

  const onOpenFile = async (file: File) => {
    setOpenError(null);
    try {
      const snap = await parseProjectSnapshotFile(file);
      setPending(snap);
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : 'Could not open that project file.');
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void onOpenFile(file);
    e.target.value = '';
  };

  useEffect(() => {
    onModeChange?.(pending != null);
  }, [pending, onModeChange]);

  if (pending) {
    return (
      <ReselectVideo
        snapshot={pending}
        onCancel={() => setPending(null)}
        onResolved={({ file, videoUrl, meta }) => {
          restoreFromSnapshot({ snapshot: pending, file, videoUrl, meta });
          setPending(null);
          setAutoSnapshot(null);
        }}
      />
    );
  }

  return (
    <div>
      {autoSnapshot && (
        <ResumeCard snapshot={autoSnapshot} onResume={() => setPending(autoSnapshot)} onDiscard={onDiscard} />
      )}

      <div className="flex justify-center">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={onInputChange}
          aria-label="Open a saved project file"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primarySoft hover:underline"
        >
          <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
          Open project file&hellip;
        </button>
      </div>
      {openError && (
        <p role="alert" className="mt-2 text-center text-xs font-medium text-danger">
          {openError}
        </p>
      )}
    </div>
  );
}
