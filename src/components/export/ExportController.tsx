import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { StudioSettings } from '../../types';
import {
  memoryRisk,
  startExport,
  type ExportHandle,
  type ExportResultFile,
} from '../../lib/exportEngine';
import { bridgeAvailable, startBridgeExport } from '../../lib/localBridge';
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

  // Store-backed rather than component-local: anything that could navigate
  // away from this page (the back-to-Backdrop bar in the local Studio shell)
  // has to be able to see that an export is in flight, and `requested` is
  // consumed the instant the engine starts.
  const running = useAppStore((s) => s.exportJob.running);
  const setRunning = useAppStore((s) => s.setExportRunning);
  const startRef = useRef(0);
  const handleRef = useRef<ExportHandle | null>(null);
  // Local Studio shell only. `forceBrowser` is set by the "Retry in browser
  // engine" escape hatch; `usedBridge` records which engine the failed run used
  // so that button is only offered when it is actually the fix.
  const forceBrowserRef = useRef(false);
  const [usedBridge, setUsedBridge] = useState(false);

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
      // A success clears the browser-engine override, so the next export gets
      // the fast path again rather than being stuck on the fallback for the tab.
      forceBrowserRef.current = false;
      setAppState('complete');
    },
    [setExportResults, setExportProgress, setAppState],
  );

  const beginExport = useCallback(async () => {
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

    // Native export bridge (local Studio shell only). The plan is built the same
    // way either way; the bridge just runs it on the native ffmpeg binary, which
    // is 10-30x faster than ffmpeg.wasm. bridgeAvailable() is false on the
    // deployed site by construction — the origin check fails before any request.
    const useBridge = !forceBrowserRef.current && (await bridgeAvailable());

    // wasm's ~2 GB address space is the only reason this warning exists; the
    // native engine has no such ceiling, so don't nag when it is doing the work.
    if (!useBridge) {
      const risk = memoryRisk(file, studio.mode);
      if (risk && !window.confirm(risk)) return; // user declined the large export
    }

    // Clear any previous run's output before starting.
    for (const r of st.exportJob.resultUrls) URL.revokeObjectURL(r.url);
    setExportResults([]);
    setExportError(null);

    startRef.current = Date.now();
    setRunning(true);
    setUsedBridge(useBridge);
    setExportProgress({ stage: 'Preparing', pct: 0, elapsedS: 0 });

    const run = useBridge ? startBridgeExport : startExport;
    handleRef.current = run(deps, {
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
    void beginExport();
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
      onUseBrowserEngine={
        usedBridge
          ? () => {
              forceBrowserRef.current = true;
              setExportError(null);
              requestExport();
            }
          : undefined
      }
      onClose={() => {
        setExportError(null);
        setExportProgress(null);
        setRunning(false);
      }}
    />
  );
}
