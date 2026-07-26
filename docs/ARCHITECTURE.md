# SharpCut Studio — Architecture Contract (v1)

Authoritative companion to `docs/SPEC.md` (the product contract). Every build agent MUST follow this file. If SPEC and this file conflict, SPEC wins — flag the conflict in your final report.

## Locked decisions (owner-approved 2026-07-26)

- Hosting: **Cloudflare Pages** (COOP/COEP headers via `public/_headers`)
- Code home: `E:\SHARPCUT`, private GitHub later
- Speech model: **Whisper base** via transformers.js (`onnx-community/whisper-base`), word-level timestamps, WebGPU with WASM fallback, cached via browser cache/IndexedDB by transformers.js itself

## Stack (locked)

- Vite 5 + React 18 + TypeScript (strict)
- Tailwind CSS v3 (tokens below), Lucide React icons
- Zustand for app state (single store, sliced)
- `@ffmpeg/ffmpeg` 0.12.x + `@ffmpeg/core-mt` (multithreaded, needs COOP/COEP) — export only, inside a dedicated Web Worker wrapper
- `@huggingface/transformers` (v3) for Whisper — inside a dedicated Web Worker
- Web Audio API (OfflineAudioContext) for waveform + silence (RMS) analysis
- `idb` for IndexedDB project persistence
- `jszip` for multi-clip ZIP download
- NO backend, NO accounts, NO telemetry, NO remote upload of media

## Design tokens (Tailwind theme extension)

bg `#F7F5F0`, surface `#FFFFFF`, ink `#172033`, muted `#667085`, primary `#355CFF`, primarySoft `#EEF2FF`, danger `#E5484D`, highlight `#FFE800`, border `#E6E2DA`, success `#16A36A`. Font: Inter (self-hosted via @fontsource, weights 400/500/600/700/800/900). Caption fonts: self-hosted @fontsource packages — see CaptionFontId below.

## Folder structure

```
src/
  main.tsx, App.tsx            # App shell + state machine (5 app states)
  types.ts                     # ALL shared domain types live here — single source of truth
  store/useAppStore.ts         # Zustand store (slices: project, analysis, edits, studio, exportJob)
  lib/                         # pure logic, unit-testable, NO React imports
    time.ts                    # formatTime, clamp, id()
    cuts.ts                    # merge/resolve overlaps, keptSegments(), output-time mapping
    captionTiming.ts           # source→output word remap incl. speed (SPEC "Caption timing formula")
    fillerDetect.ts            # filler scoring from transcript words
    silenceDetect.ts           # RMS-based silence ranges from PCM
    suggest.ts                 # build SuggestedCut[] from fillers+silence (+presets)
    transitionsSuggest.ts, zoomSuggest.ts
    captionLayout.ts           # line wrapping / words-per-line / case transform
    ffmpegFilters.ts           # deterministic FFmpeg filtergraph builders
    persist.ts                 # IndexedDB checkpoints + project JSON save/load
  workers/
    transcribe.worker.ts       # whisper; protocol below
    audio.worker.ts            # decode+silence analysis (falls back to main-thread OfflineAudioContext if needed)
    ffmpeg.worker.ts           # export engine
    workerClient.ts            # typed request/response + progress + cancel wrapper
  components/
    upload/  analysis/  review/  studio/  export/  shared/
  styles/index.css
public/_headers                # Cloudflare Pages headers (COOP/COEP + wasm caching)
```

## App states

`type AppState = 'upload' | 'analysis' | 'review' | 'studio' | 'complete'` — rendered by App.tsx switch; no router needed.

## Core domain types (types.ts — do not fork these shapes)

```ts
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
```

## Worker protocol (workerClient.ts)

Messages: `{ id, kind: 'progress'|'result'|'error', stage?: string, pct?: number, payload?, message? }`. Every long op is cancellable via `{ id, kind: 'cancel' }` → worker aborts and posts `error` with `message:'cancelled'`. Client dedupes: starting a job kind that is already running is a no-op returning the in-flight promise.

## Time model (critical — everyone follow this)

- All Cut/CaptionBlock/ZoomEffect times are **source seconds**.
- `keptSegments(cuts, duration)` in lib/cuts.ts returns ordered kept `Segment[]` after merging active cuts (overlaps merged deterministically: sort by start, coalesce).
- Output time = concatenated kept time ÷ speed. `sourceToOutput(t, segments, speed)` and `outputToSource(t, segments, speed)` in lib/cuts.ts are THE only mapping functions; captions, transitions, zooms and export all use them.

## Analysis pipeline stages (worker, in order, resumable)

1 read audio (decode to 16kHz mono PCM chunks ≤120s with 2s overlap) → 2 load whisper-base → 3 transcribe chunks sequentially, merge word stamps with drift correction at overlaps → 4 silence via RMS on PCM + filler scoring on words → 5 build suggested cuts. Checkpoint each finished chunk to IndexedDB.

## Export engine strategy

- Combined: per kept segment run trim+setpts/atempo (chain atempo for <0.5/>2 if fine slider ever allows; snap otherwise), scale+crop for format, zoompan-free zooms implemented as time-windowed `scale`+`crop` expressions or `zoompan` on constant fps, transitions via `xfade`/fade filters between segment files, captions burned via `drawtext` is NOT used — captions render as ASS subtitles (`subtitles` filter, libass) generated deterministically from CaptionBlock[]+CaptionStyle (fonts loaded into FFmpeg FS). Concat via demuxer after per-segment renders; audio `aresample=async=1`.
- Clips mode: per selected kept segment, same pipeline minus transitions, one MP4 each; JSZip "Download all".
- H.264 (`-c:v libx264 -pix_fmt yuv420p`), AAC 160k, even dims, quality→CRF 23/19/17 preset veryfast/medium/medium.
- Fonts for ASS: ship .ttf files in `public/fonts/`, fetched and written to FFmpeg FS at export time.

## Phase ownership (build order)

- P1 scaffold+shell+tokens+types+store — Agent A
- P2 upload+validation, workers infra, analysis pipeline+UI — Agent B
- P3 review UI + manual IN/OUT editor + skip-preview playback — Agent C
- P4 Export Studio UI: captions (12 presets live preview overlay), crop, speed, transitions, zooms, timed caption editor — Agent D
- P5 FFmpeg export engine + ASS generator + progress + ZIP — Agent E
- P6 persistence/recovery, responsive+a11y polish, README, _headers, prod build — Agent F
- P7 real-video testing + fixes + deploy + smoke test — orchestrator + fix agents

Each agent: keep `npm run build` green before finishing; do not restructure other phases' files; report deviations honestly.
