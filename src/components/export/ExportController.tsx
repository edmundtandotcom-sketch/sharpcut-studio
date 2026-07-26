import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { StudioSettings } from '../../types';
import {
  memoryRisk,
  startExport,
  type ExportHandle,
  type ExportResultFile,
} from '../../lib/exportEngine';
import { ExportProgress } from './ExportProgress';

/** Pull just the StudioSettings fields out of the (action-augmented) slice. */
function pickStudio(s: StudioSettings): StudioSettings {
  return {
    mode: s.mode,
    selectedClipIndices: s.selectedClipIndices,
    format: s.format,
    speed: s.speed,
    caption: s.caption,
    transitions: s.transitions,
    zooms: s.zooms,
    crop: s.crop,
    quality: s.quality,
  };
}

/**
 * Mounted once in App. Observes exportJob.requested (the P4->P5 seam), drives
 * the FFmpeg export engine, mirrors progress/results/errors into the store, and
 * renders the export overlay. Kept separate from the 'complete' screen so the
 * overlay can appear over any app state.
 */
export function ExportController() {
  const requested = useAppStore((s) => s.exportJob.requested);
  const progress = useAppStore((s) => s.exportJob.progress);
  const error = useAppStore((s) => s.exportJob.error);

  const clearExportRequest = useAppStore((s) => s.clearExportRequest);
  const setExportProgress = useAppStore((s) => s.setExportProgress);
  const setExportResults = useAppStore((s) => s.setExportResults);
  const setExportError = useAppStore((s) => s.setExportError);
  const requestExport = useAppStore((s) => s.requestExport);
  const setAppState = useAppStore((s) => s.setAppState);

  const [running, setRunning] = useState(false);
  const startRef = useRef(0);
  const handleRef = useRef<ExportHandle | null>(null);

  const finishWithResults = useCallback(
    (files: ExportResultFile[]) => {
      // Revoke any prior blob URLs, then publish fresh ones.
      const prev = useAppStore.getState().exportJob.resultUrls;
      for (const r of prev) URL.revokeObjectURL(r.url);
      const urls = files.map((f) => ({
        name: f.name,
        url: URL.createObjectURL(new Blob([f.data as BlobPart], { type: 'video/mp4' })),
      }));
      setExportResults(urls);
      setRunning(false);
      setExportProgress(null);
      setAppState('complete');
    },
    [setExportResults, setExportProgress, setAppState],
  );

  const beginExport = useCallback(() => {
    const st = useAppStore.getState();
    const file = st.project.file;
    const meta = st.project.meta;
    if (!file || !meta) {
      setExportError('No video is loaded to export.');
      return;
    }
    const studio = pickStudio(st.studio);
    const deps = {
      file,
      meta,
      cuts: st.edits.cuts,
      captionBlocks: st.analysis.captionBlocks,
      studio,
    };

    const risk = memoryRisk(file, studio.mode);
    if (risk && !window.confirm(risk)) return; // user declined the large export

    // Clear any previous run's output before starting.
    for (const r of st.exportJob.resultUrls) URL.revokeObjectURL(r.url);
    setExportResults([]);
    setExportError(null);

    startRef.current = Date.now();
    setRunning(true);
    setExportProgress({ stage: 'Preparing', pct: 0, elapsedS: 0 });

    handleRef.current = startExport(deps, {
      onProgress: (stage, pct) =>
        setExportProgress({ stage, pct, elapsedS: (Date.now() - startRef.current) / 1000 }),
      onResult: (files) => finishWithResults(files),
      onError: (message) => {
        if (message === 'cancelled') {
          setRunning(false);
          setExportProgress(null);
        } else {
          setRunning(false);
          setExportError(message);
        }
      },
    });
  }, [finishWithResults, setExportError, setExportProgress, setExportResults]);

  // Trigger: consume the request flag, then run.
  useEffect(() => {
    if (!requested) return;
    clearExportRequest();
    beginExport();
  }, [requested, clearExportRequest, beginExport]);

  // Keep the elapsed clock moving between worker progress events.
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      const p = useAppStore.getState().exportJob.progress;
      if (p) setExportProgress({ ...p, elapsedS: (Date.now() - startRef.current) / 1000 });
    }, 1000);
    return () => window.clearInterval(t);
  }, [running, setExportProgress]);

  // Mirror export progress into the tab title (BUG B) so progress is visible
  // from the tab strip while this tab is in the background — where the elapsed
  // ticker is throttled. Driven by worker progress messages, not rAF/timers, so
  // it keeps advancing when hidden. Restored when the export ends or unmounts.
  const originalTitleRef = useRef<string | null>(null);
  useEffect(() => {
    if (running) {
      if (originalTitleRef.current === null) originalTitleRef.current = document.title;
      const pct = Math.round(Math.max(0, Math.min(100, progress?.pct ?? 0)));
      document.title = `▶ ${pct}% — SharpCut export`;
    } else if (originalTitleRef.current !== null) {
      document.title = originalTitleRef.current;
      originalTitleRef.current = null;
    }
  }, [running, progress?.pct]);
  useEffect(
    () => () => {
      if (originalTitleRef.current !== null) document.title = originalTitleRef.current;
    },
    [],
  );

  if (!running && !error) return null;

  return (
    <ExportProgress
      stage={progress?.stage ?? 'Preparing'}
      pct={progress?.pct ?? 0}
      elapsedS={progress?.elapsedS ?? 0}
      error={error}
      onCancel={() => handleRef.current?.cancel()}
      onRetry={() => {
        setExportError(null);
        requestExport();
      }}
      onClose={() => {
        setExportError(null);
        setExportProgress(null);
        setRunning(false);
      }}
    />
  );
}
