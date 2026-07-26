import { useEffect } from 'react';
import { useAppStore, buildProjectSnapshot } from '../../store/useAppStore';
import { saveProjectSnapshot } from '../../lib/persist';

const AUTOSAVE_DEBOUNCE_MS = 2000;

/**
 * Mounted once in App (alongside ExportController). Renders nothing — pure
 * side effect: watches the parts of the store that make up a recoverable
 * project (analysis results, edits, studio settings) and, once a project
 * exists, debounce-saves a full snapshot to IndexedDB (SPEC "LOCAL PROJECT
 * RECOVERY"). Never touches the video file itself — that can't be durably
 * stored, so recovery always requires reselecting it.
 */
export function PersistenceController() {
  useEffect(() => {
    let timer: number | undefined;

    const flush = () => {
      const snapshot = buildProjectSnapshot(useAppStore.getState());
      if (snapshot) void saveProjectSnapshot(snapshot);
    };

    const schedule = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
    };

    const unsubscribe = useAppStore.subscribe((state, prev) => {
      // Nothing to recover before a video is loaded, and analysis is already
      // checkpointed separately (lib/persist chunk plumbing) — only save once
      // there's a project with actual edit/caption/studio state.
      if (!state.project.meta || state.appState === 'upload' || state.appState === 'analysis') {
        return;
      }
      const changed =
        state.project.meta !== prev.project.meta ||
        state.project.pacing !== prev.project.pacing ||
        state.analysis.words !== prev.analysis.words ||
        state.analysis.captionBlocks !== prev.analysis.captionBlocks ||
        state.edits.cuts !== prev.edits.cuts ||
        state.studio !== prev.studio ||
        state.appState !== prev.appState;
      if (changed) schedule();
    });

    return () => {
      unsubscribe();
      if (timer != null) window.clearTimeout(timer);
    };
  }, []);

  return null;
}
