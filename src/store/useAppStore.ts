import { create } from 'zustand';
import { id as makeId } from '../lib/time';
import { retokenizeBlock } from '../lib/captionTiming';
import { clearProjectSnapshot } from '../lib/persist';
import {
  DEFAULT_STUDIO_SETTINGS,
  type AnalysisProgress,
  type AppState,
  type CaptionBlock,
  type CaptionStyle,
  type CropSettings,
  type Cut,
  type ExportMode,
  type ExportProgress,
  type OutputFormat,
  type PacingPreset,
  type ProjectMeta,
  type ProjectSnapshotV1,
  type Quality,
  type StudioSettings,
  type ThumbnailChoice,
  type TransitionPoint,
  type WordStamp,
  type ZoomEffect,
} from '../types';

interface ProjectSlice {
  file: File | null;
  videoUrl: string | null;
  meta: ProjectMeta | null;
  pacing: PacingPreset;
}

interface AnalysisSlice {
  progress: AnalysisProgress | null;
  words: WordStamp[];
  captionBlocks: CaptionBlock[];
  error: string | null;
}

interface EditsSlice {
  cuts: Cut[];
  setCuts: (cuts: Cut[]) => void;
  toggleCut: (cutId: string) => void;
  addManualCut: (start: number, end: number, reason?: string) => void;
  removeCut: (cutId: string) => void;
  setAllActive: (active: boolean) => void;
  undoLastManual: () => void;
}

interface StudioSlice extends StudioSettings {
  setSpeed: (speed: number) => void;
  setFormat: (format: OutputFormat) => void;
  setCaptionStyle: (partial: Partial<CaptionStyle>) => void;
  setCrop: (crop: CropSettings) => void;
  setTransitions: (transitions: TransitionPoint[]) => void;
  setZooms: (zooms: ZoomEffect[]) => void;
  setMode: (mode: ExportMode) => void;
  setQuality: (quality: Quality) => void;
  toggleClipIndex: (index: number) => void;
  setSelectedClipIndices: (indices: number[]) => void;
  /** Additive P4 state — NOT part of the locked StudioSettings shape (see
   * types.ts). The chosen Export Studio thumbnail, or null if none chosen. */
  thumbnail: ThumbnailChoice | null;
  setThumbnail: (thumbnail: ThumbnailChoice | null) => void;
}

interface ExportJobSlice {
  progress: ExportProgress | null;
  resultUrls: { name: string; url: string }[];
  error: string | null;
  // P4->P5 export seam: the Studio Export button flips `requested` true.
  // P5 (FFmpeg engine) observes this flag to start the real export job.
  requested: boolean;
}

// Caption text-editor undo/redo history (snapshots of analysis.captionBlocks).
interface CaptionEditorSlice {
  past: CaptionBlock[][];
  future: CaptionBlock[][];
}

export interface AppStore {
  appState: AppState;
  setAppState: (state: AppState) => void;

  project: ProjectSlice;
  setProjectFile: (file: File, videoUrl: string) => void;
  setProjectMeta: (meta: ProjectMeta) => void;
  setPacing: (pacing: PacingPreset) => void;

  analysis: AnalysisSlice;
  setAnalysisProgress: (progress: AnalysisProgress | null) => void;
  setAnalysisWords: (words: WordStamp[]) => void;
  setCaptionBlocks: (blocks: CaptionBlock[]) => void;
  setAnalysisError: (error: string | null) => void;

  edits: EditsSlice;

  studio: StudioSlice;

  // Caption text editor (additive P4 state) — mutates analysis.captionBlocks
  // through history-tracked actions so edits are undoable/redoable.
  captionEditor: CaptionEditorSlice;
  updateCaptionBlock: (blockId: string, text: string) => void;
  replaceInCaptions: (find: string, replace: string, caseSensitive?: boolean) => number;
  undoCaptionEdit: () => void;
  redoCaptionEdit: () => void;

  exportJob: ExportJobSlice;
  setExportProgress: (progress: ExportProgress | null) => void;
  setExportResults: (results: { name: string; url: string }[]) => void;
  setExportError: (error: string | null) => void;
  /** P4->P5 export seam. Studio Export button calls this; P5 engine reacts. */
  requestExport: () => void;
  clearExportRequest: () => void;

  /** P6 project recovery: apply a validated snapshot together with a freshly
   * reselected video file/URL/meta in one update, then land on 'review' or
   * 'studio' depending on where the snapshot was saved from. */
  restoreFromSnapshot: (args: {
    snapshot: ProjectSnapshotV1;
    file: File;
    videoUrl: string;
    meta: ProjectMeta;
  }) => void;

  resetProject: () => void;
}

const initialProject: ProjectSlice = {
  file: null,
  videoUrl: null,
  meta: null,
  pacing: 'youtube',
};

const initialAnalysis: AnalysisSlice = {
  progress: null,
  words: [],
  captionBlocks: [],
  error: null,
};

const initialExportJob: ExportJobSlice = {
  progress: null,
  resultUrls: [],
  error: null,
  requested: false,
};

const initialCaptionEditor: CaptionEditorSlice = { past: [], future: [] };

const CAPTION_HISTORY_LIMIT = 60;

// Tracks manual cut ids in insertion order so undoLastManual() knows what to pop.
let manualCutOrder: string[] = [];

export const useAppStore = create<AppStore>((set, get) => ({
  appState: 'upload',
  setAppState: (appState) => set({ appState }),

  project: initialProject,
  setProjectFile: (file, videoUrl) =>
    set((s) => ({ project: { ...s.project, file, videoUrl } })),
  setProjectMeta: (meta) => set((s) => ({ project: { ...s.project, meta } })),
  setPacing: (pacing) => set((s) => ({ project: { ...s.project, pacing } })),

  analysis: initialAnalysis,
  setAnalysisProgress: (progress) =>
    set((s) => ({ analysis: { ...s.analysis, progress } })),
  setAnalysisWords: (words) => set((s) => ({ analysis: { ...s.analysis, words } })),
  setCaptionBlocks: (captionBlocks) =>
    set((s) => ({ analysis: { ...s.analysis, captionBlocks } })),
  setAnalysisError: (error) => set((s) => ({ analysis: { ...s.analysis, error } })),

  edits: {
    cuts: [],
    setCuts: (cuts) => set((s) => ({ edits: { ...s.edits, cuts } })),
    toggleCut: (cutId) =>
      set((s) => ({
        edits: {
          ...s.edits,
          cuts: s.edits.cuts.map((c) =>
            c.id === cutId ? { ...c, active: !c.active } : c,
          ),
        },
      })),
    addManualCut: (start, end, reason = 'Manual cut') => {
      const cut: Cut = {
        id: makeId(),
        type: 'manual',
        start,
        end,
        reason,
        active: true,
        confidence: 1,
      };
      manualCutOrder.push(cut.id);
      set((s) => ({ edits: { ...s.edits, cuts: [...s.edits.cuts, cut] } }));
    },
    removeCut: (cutId) => {
      manualCutOrder = manualCutOrder.filter((cid) => cid !== cutId);
      set((s) => ({
        edits: { ...s.edits, cuts: s.edits.cuts.filter((c) => c.id !== cutId) },
      }));
    },
    setAllActive: (active) =>
      set((s) => ({
        edits: { ...s.edits, cuts: s.edits.cuts.map((c) => ({ ...c, active })) },
      })),
    undoLastManual: () => {
      const lastId = manualCutOrder.pop();
      if (!lastId) return;
      set((s) => ({
        edits: { ...s.edits, cuts: s.edits.cuts.filter((c) => c.id !== lastId) },
      }));
    },
  },

  studio: {
    ...DEFAULT_STUDIO_SETTINGS,
    thumbnail: null,
    setThumbnail: (thumbnail) => set((s) => ({ studio: { ...s.studio, thumbnail } })),
    setSpeed: (speed) => set((s) => ({ studio: { ...s.studio, speed } })),
    setFormat: (format) => set((s) => ({ studio: { ...s.studio, format } })),
    setCaptionStyle: (partial) =>
      set((s) => ({
        studio: { ...s.studio, caption: { ...s.studio.caption, ...partial } },
      })),
    setCrop: (crop) => set((s) => ({ studio: { ...s.studio, crop } })),
    setTransitions: (transitions) =>
      set((s) => ({ studio: { ...s.studio, transitions } })),
    setZooms: (zooms) => set((s) => ({ studio: { ...s.studio, zooms } })),
    setMode: (mode) => set((s) => ({ studio: { ...s.studio, mode } })),
    setQuality: (quality) => set((s) => ({ studio: { ...s.studio, quality } })),
    toggleClipIndex: (index) =>
      set((s) => {
        const selected = s.studio.selectedClipIndices;
        const next = selected.includes(index)
          ? selected.filter((i) => i !== index)
          : [...selected, index];
        return { studio: { ...s.studio, selectedClipIndices: next } };
      }),
    setSelectedClipIndices: (indices) =>
      set((s) => ({ studio: { ...s.studio, selectedClipIndices: [...indices].sort((a, b) => a - b) } })),
  },

  captionEditor: initialCaptionEditor,
  updateCaptionBlock: (blockId, text) =>
    set((s) => {
      const blocks = s.analysis.captionBlocks;
      const target = blocks.find((b) => b.id === blockId);
      if (!target) return {};
      const next = blocks.map((b) => (b.id === blockId ? retokenizeBlock(b, text) : b));
      const past = [...s.captionEditor.past, blocks].slice(-CAPTION_HISTORY_LIMIT);
      return {
        analysis: { ...s.analysis, captionBlocks: next },
        captionEditor: { past, future: [] },
      };
    }),
  replaceInCaptions: (find, replace, caseSensitive = false) => {
    const query = find;
    if (!query) return 0;
    let count = 0;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
    set((s) => {
      const blocks = s.analysis.captionBlocks;
      let changed = false;
      const next = blocks.map((b) => {
        if (!re.test(b.text)) return b;
        re.lastIndex = 0;
        const matches = b.text.match(re);
        count += matches ? matches.length : 0;
        changed = true;
        return retokenizeBlock(b, b.text.replace(re, replace));
      });
      if (!changed) return {};
      const past = [...s.captionEditor.past, blocks].slice(-CAPTION_HISTORY_LIMIT);
      return {
        analysis: { ...s.analysis, captionBlocks: next },
        captionEditor: { past, future: [] },
      };
    });
    return count;
  },
  undoCaptionEdit: () =>
    set((s) => {
      const past = s.captionEditor.past;
      if (past.length === 0) return {};
      const prev = past[past.length - 1];
      return {
        analysis: { ...s.analysis, captionBlocks: prev },
        captionEditor: {
          past: past.slice(0, -1),
          future: [s.analysis.captionBlocks, ...s.captionEditor.future].slice(0, CAPTION_HISTORY_LIMIT),
        },
      };
    }),
  redoCaptionEdit: () =>
    set((s) => {
      const future = s.captionEditor.future;
      if (future.length === 0) return {};
      const nextBlocks = future[0];
      return {
        analysis: { ...s.analysis, captionBlocks: nextBlocks },
        captionEditor: {
          past: [...s.captionEditor.past, s.analysis.captionBlocks].slice(-CAPTION_HISTORY_LIMIT),
          future: future.slice(1),
        },
      };
    }),

  exportJob: initialExportJob,
  setExportProgress: (progress) =>
    set((s) => ({ exportJob: { ...s.exportJob, progress } })),
  setExportResults: (resultUrls) =>
    set((s) => ({ exportJob: { ...s.exportJob, resultUrls } })),
  setExportError: (error) => set((s) => ({ exportJob: { ...s.exportJob, error } })),
  requestExport: () =>
    set((s) => ({ exportJob: { ...s.exportJob, requested: true, error: null } })),
  clearExportRequest: () =>
    set((s) => ({ exportJob: { ...s.exportJob, requested: false } })),

  restoreFromSnapshot: ({ snapshot, file, videoUrl, meta }) => {
    const prev = get();
    if (prev.project.videoUrl) URL.revokeObjectURL(prev.project.videoUrl);
    for (const r of prev.exportJob.resultUrls) URL.revokeObjectURL(r.url);
    manualCutOrder = snapshot.cuts.filter((c) => c.type === 'manual').map((c) => c.id);
    // Only 'review' and 'studio' are meaningful resume targets — anything else
    // (an interrupted upload/analysis, or a completed export whose result
    // blobs are gone) safely falls back to 'review'.
    const resumeState: AppState = snapshot.appState === 'studio' ? 'studio' : 'review';

    set((s) => ({
      appState: resumeState,
      project: { file, videoUrl, meta, pacing: snapshot.pacing },
      analysis: {
        progress: null,
        words: snapshot.words,
        captionBlocks: snapshot.captionBlocks,
        error: null,
      },
      edits: { ...s.edits, cuts: snapshot.cuts },
      studio: { ...s.studio, ...snapshot.studio, thumbnail: snapshot.thumbnail ?? null },
      captionEditor: initialCaptionEditor,
      exportJob: initialExportJob,
    }));
  },

  resetProject: () => {
    const { project, exportJob } = get();
    if (project.videoUrl) URL.revokeObjectURL(project.videoUrl);
    for (const result of exportJob.resultUrls) URL.revokeObjectURL(result.url);
    manualCutOrder = [];
    void clearProjectSnapshot(); // best-effort; "Start over" clears saved recovery data too

    set((s) => ({
      appState: 'upload',
      project: initialProject,
      analysis: initialAnalysis,
      edits: { ...s.edits, cuts: [] },
      studio: { ...s.studio, ...DEFAULT_STUDIO_SETTINGS, thumbnail: null },
      captionEditor: initialCaptionEditor,
      exportJob: initialExportJob,
    }));
  },
}));

// A dataURL's raw byte size is ~3/4 of its base64 string length. Cap what an
// 'upload' thumbnail contributes to the recovery snapshot/project file at 2MB
// so a large image doesn't bloat every autosave — the in-session choice is
// untouched, only the persisted copy (and therefore recovery) drops it.
const THUMBNAIL_UPLOAD_SNAPSHOT_CAP_BYTES = 2 * 1024 * 1024;

function snapshotThumbnail(t: ThumbnailChoice | null): ThumbnailChoice | null {
  if (!t) return null;
  if (t.kind === 'frame') return t;
  const approxBytes = Math.ceil((t.dataUrl.length * 3) / 4);
  if (approxBytes > THUMBNAIL_UPLOAD_SNAPSHOT_CAP_BYTES) {
    // eslint-disable-next-line no-console
    console.warn('SharpCut: uploaded thumbnail too large to persist in the recovery snapshot (>2MB); dropped from autosave/project file only.');
    return null;
  }
  return t;
}

/**
 * Build a P6 project snapshot from the current store state — used by both the
 * debounced IndexedDB autosave and the manual "Save project file" download.
 * Returns null when there's nothing worth saving yet (no project loaded, or
 * analysis hasn't produced anything to recover).
 */
export function buildProjectSnapshot(state: AppStore): ProjectSnapshotV1 | null {
  const { project, analysis, edits, studio } = state;
  if (!project.meta || !project.file) return null;
  return {
    v: 1,
    savedAt: Date.now(),
    fingerprint: {
      fileName: project.meta.fileName,
      size: project.file.size,
      duration: project.meta.duration,
    },
    projectMeta: project.meta,
    pacing: project.pacing,
    words: analysis.words,
    captionBlocks: analysis.captionBlocks,
    cuts: edits.cuts,
    studio: {
      mode: studio.mode,
      selectedClipIndices: studio.selectedClipIndices,
      format: studio.format,
      speed: studio.speed,
      caption: studio.caption,
      transitions: studio.transitions,
      zooms: studio.zooms,
      crop: studio.crop,
      quality: studio.quality,
    },
    thumbnail: snapshotThumbnail(studio.thumbnail),
    appState: state.appState,
  };
}
