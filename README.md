# SharpCut Studio

Turn long takes into sharp cuts — entirely in your browser.

SharpCut Studio removes filler words, silence, and dead space from a talking-head
or screen-recording video; lets you review and fine-tune every suggested cut;
then crops, captions, speeds up, adds transitions/zoom, and exports a finished
MP4 (or a set of individual clips) — all on your own device. There is no
backend, no account, and no upload of your video anywhere.

## Features

- **Drag-and-drop upload** with format/duration/audio validation (MP4, MOV,
  WebM, M4V) and clear, plain-language errors for unsupported or corrupted
  files.
- **Automatic analysis**: word-level speech transcription (Whisper, running
  locally in a Web Worker) plus silence detection, feeding a filler-word and
  dead-air cut suggester. Resumable via IndexedDB checkpoints if a long
  analysis is interrupted.
- **Review & manual editing**: enable/disable every suggested cut, preview it
  in context, and cut additional manual IN/OUT ranges. Playback skips
  disabled ranges automatically.
- **Export Studio**:
  - Combined export or per-clip export ("Clips" mode) with a ZIP download.
  - True crop for 16:9 / 9:16 / original — no blurred-background letterboxing.
  - Speed control (0.5×–2×, with named presets) that keeps captions, zooms,
    and transitions in sync.
  - 12 distinct caption creative presets, font/colour/size/case/position
    controls, and a timed caption text editor with undo/redo.
  - Suggested and manual scene transitions, and quick zoom/punch-in effects.
  - Three export quality tiers (Standard / High / Source-conscious).
- **Local project recovery**: your edit decisions, transcript, captions, and
  studio settings autosave to IndexedDB as you work, and can also be saved to
  (and reopened from) a portable `sharpcut-project.json` file. See
  [Privacy](#privacy) for what is — and isn't — ever stored.
- **Accessible by design**: keyboard-operable controls with visible focus
  states, ARIA roles/states on toggles and selectable cards, a skip-to-content
  link, and `prefers-reduced-motion` support.

## Supported browsers

| Browser | Support |
|---|---|
| Chrome (desktop) | **Primary** — fully supported and the target for all testing. |
| Edge (desktop) | **Primary** — Chromium-based, same support as Chrome. |
| Firefox (desktop) | Best-effort. Core editing works; multithreaded FFmpeg export may fall back to a slower single-thread path. |
| Safari (desktop/iOS) | Best-effort, untested. WebAssembly/SharedArrayBuffer support varies by version. |
| Mobile browsers | Not a target. The layout is responsive down to 375px, but video analysis/export are heavy workloads better suited to a laptop/desktop. |

SharpCut Studio requires WebAssembly, Web Workers, and (for the fastest export
path) `SharedArrayBuffer` behind cross-origin isolation headers (see
[Deployment](#deployment-cloudflare-pages)). Unsupported browsers get an
in-app warning banner rather than a silent failure.

## Privacy

- **All processing happens locally in your browser.** Your video is never
  uploaded anywhere. Transcription, cut detection, preview, and export all run
  on your own device via WebAssembly and Web Workers.
- **The only external network fetch** is a one-time download of the Whisper
  speech-recognition model (`onnx-community/whisper-base`, ~40–80 MB) from the
  Hugging Face CDN the first time you analyse a video. It's cached by the
  browser afterwards, so later runs don't re-download it.
- **Nothing is sent to SharpCut Studio, or to any server we operate** — there
  is no backend at all.
- **Project recovery never stores the video file itself.** Browsers cannot
  durably retain a large file across sessions, so autosave/save-project only
  ever writes your edit decisions, transcript, captions, and studio settings.
  Reopening a project always requires reselecting the original video file.

## Local development

```bash
npm install
npm run dev
```

Opens a Vite dev server (default `http://localhost:5173`) with the required
`Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers already
configured (see `vite.config.ts`).

## Production build

```bash
npm run build
```

Runs `tsc -b` (strict type-check) then `vite build` into `dist/`. To verify
the build locally with the same headers a production host must send:

```bash
npm run preview
```

`vite preview` doesn't read `public/_headers` (that file's syntax is
Cloudflare-Pages-specific) — `vite.config.ts` sets the same COOP/COEP headers
directly in `preview.headers` so a local preview behaves like the deployed
site.

### What's in `dist/`

`dist/` is fully static and self-contained — it can be served by any static
file host that supports the required headers below. As of this build:

- Total size: **~90 MB**.
- Largest assets, all cached long-term by the browser after first load:
  - `ffmpeg/core-mt/ffmpeg-core.wasm` — ~31 MB (multithreaded FFmpeg, used
    when cross-origin isolation is active)
  - `ffmpeg/core/ffmpeg-core.wasm` — ~31 MB (single-thread fallback)
  - `assets/ort-wasm-simd-threaded.*.wasm` — ~21 MB (ONNX Runtime, powers the
    Whisper transcription worker)
  - `fonts/*.ttf` — self-hosted caption fonts baked into the FFmpeg filesystem
    at export time so burned-in captions render identically to the preview
  - `assets/index-*.js` — the app bundle itself, ~0.3 MB
- `_headers` — Cloudflare Pages header rules (copied from `public/_headers`).

The Whisper model itself is **not** part of `dist/` — it's fetched from the
Hugging Face CDN on first use and cached by the browser (see
[Privacy](#privacy)).

## Deployment (Cloudflare Pages)

Cloudflare Pages was chosen over Vercel/Netlify for this project because it
serves large static assets and custom response headers (needed for
`SharedArrayBuffer`/multithreaded WASM) with no extra configuration.

```bash
npm install -g wrangler   # if you don't already have it
npm run build
npx wrangler pages deploy dist --project-name=sharpcut-studio
```

The first deploy will prompt you to log in to Cloudflare and create the
Pages project; subsequent deploys just reuse it.

### Required security headers

`public/_headers` (copied into `dist/` by the build) sets, on every route:

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

These enable cross-origin isolation, which is required for
`SharedArrayBuffer` and therefore for the multithreaded FFmpeg export path
(`@ffmpeg/core-mt`). Without them the app still works, but export falls back
to the slower single-threaded FFmpeg core. Cloudflare Pages applies
`_headers` automatically — no dashboard configuration needed.

### Custom domain

In the Cloudflare dashboard: **Pages → your project → Custom domains → Set up
a custom domain**, then follow the DNS instructions shown there (Cloudflare
manages the DNS record automatically if the domain's nameservers already
point to Cloudflare). HTTPS is issued automatically.

### Rollback

Cloudflare Pages keeps every deployment. To roll back:

```bash
npx wrangler pages deployment list --project-name=sharpcut-studio
```

Find the last-known-good deployment and either:

- **Promote it** from the Cloudflare dashboard (**Pages → your project →
  Deployments → ⋯ → Rollback to this deployment**), or
- **Redeploy from git**: `git revert <bad-commit>` (or `git checkout
  <good-commit>`), then re-run `npm run build && npx wrangler pages deploy
  dist`.

Nothing is destructive server-side — a rollback only changes which static
build is served; no user data is stored server-side to migrate or lose.

## Known limitations

- **Practical length ceiling:** tested up to ~60 minutes. Longer videos may
  exceed the ~2 GB/2 GB-WASM-memory-per-instance ceiling or simply run slowly
  in-browser; analysis checkpoints to IndexedDB so an interrupted long run can
  resume instead of restarting.
- **WASM memory ceiling:** the FFmpeg WebAssembly heap is capped around 2 GB.
  Very large/long exports (especially at Source-conscious quality) can hit
  this; the app warns before starting a high-risk export.
- **Single-thread fallback is slower:** without cross-origin isolation (COOP/
  COEP) headers, FFmpeg export runs single-threaded and takes noticeably
  longer (measured ~3× slower than the multithreaded core on the same clip).
  Always deploy with `_headers` in place.
- **Multithreaded export has a hang watchdog:** the multithreaded FFmpeg core
  (`@ffmpeg/core-mt`) can, in some environments, deadlock silently inside an
  `exec()` on a heavy filtergraph — no progress, no logs, no return. Exports
  therefore start on the multithreaded core (for speed) but guard every
  `exec()` with a 45-second activity watchdog. If an `exec()` produces neither a
  progress event nor a log line for 45s, the worker terminates that core,
  reloads the single-thread core, and automatically restarts the whole export
  from the beginning (surfacing a "Restarting in single-thread mode…" stage).
  After the first such hang, every later export in the session goes straight to
  single-thread. Net effect: multithreaded speed when it works, guaranteed
  single-thread completion when it does not — never an invisible hang.
- **Caption timing after transitions:** each transition trims a small overlap
  (its crossfade duration) out of the final timeline. Caption sync accounts
  for cuts and speed changes exactly, but very transition-heavy edits can
  accumulate roughly ~0.2s of caption drift per transition by the end of the
  video. Keep transitions to real scene changes (as suggested) rather than
  every cut to avoid this.
- **Preview is an approximation:** the live Export Studio preview
  (captions, crop, zoom, transitions) is a close CSS/canvas approximation for
  responsiveness. The exported MP4, rendered by FFmpeg with the same
  deterministic filter graph, is the source of truth for the final look.
- **Safari:** not actively tested. WebAssembly/threading support varies by
  Safari version; expect the single-thread fallback path at best.
- **No accounts, no cloud sync:** by design. Project recovery is local to one
  browser profile on one device; use "Save project file" to move a project
  between devices/browsers.

## Architecture overview

See `docs/ARCHITECTURE.md` for the full contract. In short:

- **App states** (`src/types.ts` `AppState`): `upload → analysis → review →
  studio → complete`, rendered by a single switch in `src/App.tsx` (no
  router).
- **State**: one Zustand store (`src/store/useAppStore.ts`), sliced into
  project / analysis / edits / studio / export-job / caption-editor-history.
- **Workers** (`src/workers/`): `transcribe.worker.ts` (Whisper transcription),
  `ffmpeg.worker.ts` (export engine) — both driven through a typed
  request/response/progress/cancel protocol in `workerClient.ts`. Silence
  analysis runs via the Web Audio API, with a main-thread fallback.
- **Pure logic** (`src/lib/`): cut merging/time-mapping, filler/silence
  detection, caption timing + layout, transition/zoom suggestion, the
  deterministic FFmpeg filtergraph/export-plan builder, ASS subtitle
  generation, and IndexedDB persistence (`persist.ts` — analysis checkpoints
  **and** full-project recovery snapshots).
- **UI** (`src/components/`): one folder per app state (`upload/`, `analysis/`,
  `review/`, `studio/`, `export/`), plus `shared/` for the header, error
  boundary, and cross-cutting controllers (`PersistenceController`,
  `ExportController`).
- **No backend.** No accounts, no telemetry, no remote upload of media.

## Test report

**Status: P7 verified against real video fixtures (`testdata/`).** Results below
are from in-browser runs on the production build (`vite build` → `vite preview`),
plus local FFmpeg CLI cross-checks where noted.

### Input, analysis & editing

| Area | Result |
|---|---|
| Upload validation | PASS — type/duration/audio checks; corrupt file rejected with a friendly message (see export table), no-audio file explained (not a crash) |
| Transcription | PASS — `whisper-base_timestamped` fp32/WebGPU accurate on real speech (test-speech-30s.mp4 → 81 words) |
| Silence detection | PASS — matches FFmpeg `silencedetect` |
| Filler detection | PASS — with surrounding context; "you know" rendered as a spaced label |
| Manual IN/OUT | PASS — add + undo; invalid range rejected |
| Skip-preview | PASS |
| WebM upload (VP9/Opus) | PASS — validates + decodes to review (test-30s.webm → 55 words) |
| MOV upload (H.264/AAC) | PASS — validates + decodes to review (test-30s.mov → 55 words) |
| Corrupt file | PASS — 13-byte `test-corrupt.mp4` → "We couldn't read this video." + recovery + "Choose a different video"; no crash |
| No-audio file | PASS (detection) — `test-noaudio.mp4` audio decode throws → "This video has no audio track." message path; not a crash |

### Studio, preview & captions

| Area | Result |
|---|---|
| 9:16 preview | PASS — true-crop box |
| Caption single-line scaling 50–300% | PASS — preview and burned ASS agree |
| Punch-zoom 1.4× tight crop | PASS — CLI SSIM frame comparison **and** completed in-app export (1080×1922, 30.1s, karaoke burned) |
| Resume gating | PASS — resumes only on explicit click (80s idle test) |
| Title-bar progress | PASS — `▶ NN% — SharpCut export` while backgrounded |
| Header badge / label spacing | PASS — single header badge; "you know" spaced |

### Export engine (FFmpeg worker)

All export runs below completed against `testdata/` on the production build.
The multithreaded core hung inside the first segment `exec()` (no progress/log
for 45s); the watchdog fired, reloaded single-thread, and auto-restarted the
job, which then completed — exactly the designed behaviour.

| Export | Settings | Result |
|---|---|---|
| Combined + captions | test-speech-30s.mp4, Combined/Original/1×/Clean/High | PASS — MT started (no ST label), hung inside render, watchdog fired at ~53s → "Restarting in single-thread mode…" → ST reload → render/join/**burn captions** → `test-speech-30s-sharpcut.mp4` (1.63 MB). ST portion ≈86s (≈ the ~90s baseline). MT auto-disabled for the rest of the session. |
| Transitions | manual cut → 2 kept segments, Quick Fade @ boundary, Combined/Original/Standard | PASS — went straight to single-thread (MT already disabled), `Rendering 1/2 → 2/2 → Joining with transitions` (**primary xfade path**, no safe-mode/plain-concat fallback) → captions → `…-sharpcut.mp4` (1.01 MB). No xfade error surfaced. First real exercise of the transitions path. |
| Clips | 2 clips selected, Original/Standard | PASS — `…-clip-01.mp4` (0.50 MB) + `…-clip-02.mp4` (0.53 MB); "Download all (ZIP)" click threw no error, `exportJob.error` null |
| Speed remap | 1.5×, Combined/Original/no captions | PASS — output audio duration **20.04s** vs expected `30.066 / 1.5 = 20.04s` (probed via `decodeAudioData`) |

### Known environment notes / limitations found

- The verification browser tab ran **hidden** (background), where Chrome refuses
  to advance an `HTMLVideoElement` past `readyState 0`. This blocks the
  `<video>`-based upload-metadata probe and any `<video>`-based duration check,
  so those flows were verified via their underlying primitives instead
  (`decodeAudioData` for audio/duration; the `<video>` `error` event for the
  corrupt file, which fails fast enough to be unaffected). This is a test-harness
  constraint, not an app defect — the corrupt-file path was still confirmed
  end-to-end through the real UI.
- Single-thread export in this hidden/throttled tab ran markedly slower than a
  foregrounded tab; the ~86s single-thread figure above is consistent with the
  ~90s foregrounded baseline once the multithreaded hang + core reload
  (~45s + ~22s) are excluded.
