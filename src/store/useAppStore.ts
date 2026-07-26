import { create } from 'zustand';
import { id as makeId } from '../lib/time';
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
  type Quality,
  type StudioSettings,
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
}

interface ExportJobSlice {
  progress: ExportProgress | null;
  resultUrls: { name: string; url: string }[];
  error: string | null;
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

  exportJob: ExportJobSlice;
  setExportProgress: (progress: ExportProgress | null) => void;
  setExportResults: (results: { name: string; url: string }[]) => void;
  setExportError: (error: string | null) => void;

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
};

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
  },

  exportJob: initialExportJob,
  setExportProgress: (progress) =>
    set((s) => ({ exportJob: { ...s.exportJob, progress } })),
  setExportResults: (resultUrls) =>
    set((s) => ({ exportJob: { ...s.exportJob, resultUrls } })),
  setExportError: (error) => set((s) => ({ exportJob: { ...s.exportJob, error } })),

  resetProject: () => {
    const { project, exportJob } = get();
    if (project.videoUrl) URL.revokeObjectURL(project.videoUrl);
    for (const result of exportJob.resultUrls) URL.revokeObjectURL(result.url);
    manualCutOrder = [];

    set((s) => ({
      appState: 'upload',
      project: initialProject,
      analysis: initialAnalysis,
      edits: { ...s.edits, cuts: [] },
      studio: { ...s.studio, ...DEFAULT_STUDIO_SETTINGS },
      exportJob: initialExportJob,
    }));
  },
}));
