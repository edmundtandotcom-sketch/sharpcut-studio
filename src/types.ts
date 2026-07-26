// ============================================================================
// SharpCut Studio — shared domain types.
// Core domain types below are copied VERBATIM from docs/ARCHITECTURE.md
// ("Core domain types (types.ts — do not fork these shapes)"). Do not fork.
// ============================================================================

export interface WordStamp { text: string; start: number; end: number; confidence?: number }
export type CutType = 'filler' | 'silence' | 'repeat' | 'manual';
export interface Cut {
  id: string; type: CutType; start: number; end: number;   // source seconds
  reason: string; active: boolean; confidence: number;      // 0..1
  transcriptContext?: string;
}
export interface Segment { index: number; start: number; end: number }   // kept, source time
export type PacingPreset = 'youtube' | 'reels';
export type OutputFormat = 'original' | 'landscape' | 'vertical';        // 16:9, 9:16
export type ExportMode = 'combined' | 'clips';
export type CaptionPresetId = 'none'|'clean'|'impactPop'|'karaoke'|'bounceBox'|'creatorOutline'|'highlightBar'|'brandBanner'|'minimalEditorial'|'reelsPunch'|'wordPop'|'lowerThird';
export type CaptionCase = 'upper'|'lower'|'title'|'original';
export type CaptionFontId = 'modern'|'classic'|'impact'|'editorial'|'creatorRounded'|'reelsCondensed'|'heavyBlack'|'typewriter'|'montserrat'|'bebas'|'poppins'|'oswald';
export interface CaptionStyle {
  preset: CaptionPresetId; font: CaptionFontId; sizePct: number;         // 50..300
  case: CaptionCase; position: 'top'|'center'|'bottom'|'custom'; customYPct: number; // 0 top..100 bottom
  colors: { text: string; background: string; outline: string; accent: string };
}
export interface CaptionBlock { id: string; start: number; end: number; words: WordStamp[]; text: string } // source time
export type TransitionType = 'none'|'quickFade'|'flash'|'dipToBlack'|'quickPush'|'crossDissolve'|'cleanBlur';
export interface TransitionPoint { id: string; boundaryIndex: number; type: TransitionType; durationMs: number }
export type ZoomType = 'zoomIn'|'zoomOut'|'punchIn'|'reset';
export interface ZoomEffect { id: string; segmentIndex: number; atSource: number; type: ZoomType; scale: number; durationMs: number }
export interface CropSettings { xPct: number; yPct: number }             // 0..100, 50=center
export type Quality = 'standard'|'high'|'source';
export interface StudioSettings {
  mode: ExportMode; selectedClipIndices: number[]; format: OutputFormat;
  speed: number; caption: CaptionStyle; transitions: TransitionPoint[];
  zooms: ZoomEffect[]; crop: CropSettings; quality: Quality;
}

// ============================================================================
// Additional app-level types (P1 scope)
// ============================================================================

/** The five main application states (INFORMATION ARCHITECTURE, SPEC.md). */
export type AppState = 'upload' | 'analysis' | 'review' | 'studio' | 'complete';

export interface ProjectMeta {
  name: string;
  fileName: string;
  duration: number; // seconds
  width: number;
  height: number;
  fps?: number;
  hasAudio: boolean;
}

export interface AnalysisProgress {
  stage: 1 | 2 | 3 | 4 | 5;
  stageLabel: string;
  pct: number; // 0..100
  elapsedS: number;
  etaRangeS?: [number, number];
}

export interface ExportProgress {
  stage: string;
  pct: number; // 0..100
  elapsedS: number;
}

// ============================================================================
// P6 — Local Project Recovery (SPEC "LOCAL PROJECT RECOVERY")
// ============================================================================

/** Enough about the original file to detect a matching reselected file.
 * Never includes file bytes — the browser cannot durably store the video
 * itself, so recovery always requires the user to reselect it. */
export interface ProjectFileFingerprint {
  fileName: string;
  size: number;
  duration: number; // seconds, source
}

/** Full recoverable project state — written to IndexedDB (autosave) and to a
 * downloadable `sharpcut-project.json` (manual save). Never contains the
 * video file/blob itself. */
export interface ProjectSnapshotV1 {
  v: 1;
  savedAt: number; // epoch ms
  fingerprint: ProjectFileFingerprint;
  projectMeta: ProjectMeta;
  pacing: PacingPreset;
  words: WordStamp[];
  captionBlocks: CaptionBlock[];
  cuts: Cut[];
  studio: StudioSettings;
  /** Stage the user was on when this was saved — resume lands here (or the
   * closest sensible stage) once the video is reselected. */
  appState: AppState;
}

export const DEFAULT_STUDIO_SETTINGS: StudioSettings = {
  mode: 'combined',
  selectedClipIndices: [],
  format: 'original',
  speed: 1,
  caption: {
    preset: 'clean',
    font: 'modern',
    sizePct: 100,
    case: 'original',
    position: 'bottom',
    customYPct: 85,
    colors: {
      text: '#FFFFFF',
      background: '#172033',
      outline: '#000000',
      accent: '#FFE800',
    },
  },
  transitions: [],
  zooms: [],
  crop: { xPct: 50, yPct: 50 },
  quality: 'high',
};
