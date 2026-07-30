# SharpCut Studio

Turn long takes into sharp cuts — entirely in your browser.

SharpCut Studio removes filler words, silence, and dead space from a talking-head
or screen-recording video; lets you review and fine-tune every suggested cut;
then crops, captions, speeds up, adds transitions/zoom, and exports a finished
MP4 (or a set of individual clips) — all on your own device. There is no
backend, no account, and no upload of your video anywhere.

## Features

- **Drag-and-drop upload** with format/duration/audio validation (MP4, MOV,
  WebM, M4V, MKV) and clear, plain-language errors for unsupported or
  corrupted files.
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
| Firefox (desktop) | Best-effort. Core editing works; export uses the same single-thread FFmpeg core as Chrome. |
| Safari (desktop/iOS) | Best-effort, untested. WebAssembly/SharedArrayBuffer support varies by version. |
| Mobile browsers | Not a target. The layout is responsive down to 375px, but video analysis/export are heavy workloads better suited to a laptop/desktop. |

SharpCut Studio requires WebAssembly, Web Workers, and `SharedArrayBuffer`
behind cross-origin isolation headers (see
[Deployment](#deployment-cloudflare-pages)). Unsupported browsers get an
in-app warning banner rather than a silent failure. Note that FFmpeg export
itself is single-threaded on purpose (see
[Known limitations](#known-limitations)) — the isolation requirement is for
the feature gate and the Whisper/ONNX threaded runtime.

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
  - `ffmpeg/core/ffmpeg-core.wasm` — ~31 MB (single-thread FFmpeg — the core
    every export actually uses)
  - `ffmpeg/core-mt/ffmpeg-core.wasm` — ~31 MB (multithreaded FFmpeg, shipped
    but **not used**: `MT_ENABLED` is off, see
    [Known limitations](#known-limitations))
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
`SharedArrayBuffer`. The app's support gate checks for it, and the
Whisper/ONNX transcription runtime uses it; FFmpeg export deliberately does
not (it runs single-threaded — see
[Known limitations](#known-limitations)). Cloudflare Pages applies `_headers`
automatically — no dashboard configuration needed.

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

- **Practical length ceiling:** a 30-minute / 573 MB / 116-segment combined
  export (Standard quality, Clean captions) has been run end-to-end to a valid
  file; the full run took ~40 minutes in-browser (~20 min rendering, ~19 min
  caption burn). Longer/larger videos may simply run slowly; analysis
  checkpoints to IndexedDB so an interrupted long run can resume instead of
  restarting. (Standard quality's FFmpeg arguments were not changed by the
  encode-speed work below, so that measurement still stands — see the test
  report.)
- **WASM memory ceiling:** the FFmpeg WebAssembly heap is capped around 2 GB
  (and the multithreaded core's SharedArrayBuffer cannot grow past its build-
  time maximum). Two things make long combined exports fit: (1) each rendered
  segment is evicted from the wasm FS into the worker's JS heap the instant it
  is done, so the render never accumulates segment bytes in wasm memory; and
  (2) because `ffmpeg.wasm` leaks heap on every `exec()` call, the export
  recreates the FFmpeg instance every 25 segments (and once before the caption
  burn) to reset the leaked heap — the evicted segments survive the teardown and
  are written back at join time. If an export still exhausts memory, the failure
  message says so and suggests Individual clips mode, Standard quality, or a
  shorter video; the app also warns before starting a high-risk export.
- **Export runs single-threaded, on purpose:** the multithreaded FFmpeg core
  (`@ffmpeg/core-mt`) is nominally faster but proved unreliable in real
  deployed conditions, in two different ways:
  1. It can **deadlock** silently inside an `exec()` on a heavy filtergraph —
     no progress, no logs, no return. The 45-second activity watchdog (below)
     was built for this and does catch it.
  2. Worse, it can **crawl**. Reproduced on `testdata/test-2min.mp4` (8
     segments, Clean captions, High quality): 3.68% at 12s elapsed, still
     3.68% at 36s, 3.88% at 58s. Because it kept emitting occasional tiny
     progress ticks it never looked *silent*, so the watchdog never fired and
     the export would have run for hours. A real user reported exactly this
     ("more than 10 minutes and only at 24%") on the deployed site.

  A crawl has no signal that separates it from a legitimately slow but working
  encode (Source quality on a large video is genuinely slow), so any throughput
  threshold tight enough to catch it would eventually abandon runs that were
  going to finish. So the worker no longer attempts the multithreaded core at
  all — `MT_ENABLED` in `src/workers/ffmpeg.worker.ts` is `false`. Single-thread
  is slower per frame in theory but empirically *finishes*, predictably, and
  fails with a clean exit code instead of hanging. Progress labels no longer
  call it a degraded "single-thread mode (slower)" fallback, because it is now
  the normal path.

  The COOP/COEP headers are still required (and still deployed) — the feature
  gate and the Whisper/ONNX threading path depend on cross-origin isolation.
- **Hang watchdog is still armed:** every `exec()` is raced against a
  45-second *activity* watchdog (no progress event and no log line). It now
  guards the single-thread core, turning an unrecoverable wedge into an honest
  "Export stalled and could not recover" error rather than an infinite spinner.
- **Encode presets are deliberately fast:** libx264 compiled to WebAssembly
  costs far more for the slower x264 presets than a native build does, while
  buying the same marginal fidelity. Quality tiers therefore differentiate on
  **CRF**, not preset: Standard = CRF 23 `veryfast`, High = CRF 19 `veryfast`,
  Source-conscious = CRF 17 `fast`. High and Source used to use `medium`, which
  is what made a 2-minute clip take ~7½ minutes. Additionally, only the pass
  that produces the deliverable pays for the chosen preset — segment renders
  (and the xfade join when a caption burn follows) are intermediates that get
  re-encoded and deleted, so they always use the cheapest preset. This tool
  targets Reels/YouTube, not archival mastering.
- **The caption burn is now the dominant cost:** when captions are on, the
  export re-encodes the *entire* joined output once more through libass. On the
  2-minute fixture that pass is roughly half the total wall-clock. Turning
  captions off skips the pass entirely (there is a real "no caption pass" path,
  not a no-op filter). Burning captions per-segment during the render — which
  would remove the second full-length encode altogether — is the obvious next
  optimisation, but it needs caption cues rebased per segment and was left out
  of scope.
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
- **Safari:** not actively tested. WebAssembly/`SharedArrayBuffer` support
  varies by Safari version, and the support gate requires cross-origin
  isolation.
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
| Transcription completeness (long chunks) | PASS — fixed a real bug: audio chunks handed to the model were up to ~110s while asking it to also do its own internal 30s re-windowing, and that internal mechanism silently dropped whole spans of real speech mid-chunk (confirmed on a real user video: two gaps of 17.8s and 28.4s+10.0s that were NOT silence — isolating those exact windows and re-transcribing them alone produced clean, coherent text). Fixed by decoupling the FFmpeg extraction grid (kept at 110s, only affects extraction cost) from the ASR grid (now 28s, at/under the model's 30s window) and removing `chunk_length_s` from the model call entirely so it always takes a single-forward-pass — no internal windowing to lose content in. Verified: the real user video went from 322 words/3 gaps (up to 28.4s) to 452 words/0 gaps over 4s, with the recovered text an exact match to the isolated re-transcription. No regression on `test-speech-30s.mp4` (80 words) or `test-5min.mp4` (633→668 words); one pre-existing ~5s gap in `test-5min.mp4` around 210-221s was confirmed present in the old code too (same location, not a regression) — likely a genuine low-confidence/ambiguous-audio spot in that specific fixture. Analysis is somewhat slower now (more, smaller model calls) — acceptable tradeoff for completeness. |
| Silence detection | PASS — matches FFmpeg `silencedetect` |
| Filler detection | PASS — with surrounding context; "you know" rendered as a spaced label |
| Manual IN/OUT | PASS — add + undo; invalid range rejected |
| Skip-preview | PASS |
| WebM upload (VP9/Opus) | PASS — validates + decodes to review (test-30s.webm → 55 words) |
| MOV upload (H.264/AAC) | PASS — validates + decodes to review (test-30s.mov → 55 words) |
| MKV upload (H.264/AAC) | PASS — Chrome reads metadata + decodes audio natively (no fallback needed); full pipeline verified: upload → analysis (85 words) → export → correct MP4 output |
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
Exports now go straight to the single-thread core by design (see
[Known limitations](#known-limitations)); progress labels no
longer mention threads at all.

| Export | Settings | Result |
|---|---|---|
| **2-minute clip (the reported bug)** | test-2min.mp4 (42 MB, 120.1s), 7 active cuts → **8 segments**, Combined/Original/1×/Clean/**High** | **PASS — and 2.3× faster.** `Rendering segment 1/8 … 8/8` done at ~100s → join at ~100s → caption burn → complete at **197.9s (3m18s)**. Output `test-2min-sharpcut.mp4`: **5.04 MB, 115.84s, 1280×720**, h264 + AAC 48 kHz stereo, captions burned and legible (frame-checked at 33s and 72s against a screen-share source, the worst case for a fast preset). Before this fix: multithreaded core **crawled** (3.68% at 12s, 3.88% at 58s, watchdog never fired — effectively never finishing), and with MT forced off the same export took **~450–470s (7½–8 min)** for a 5.77 MB output. |
| Combined + captions | test-speech-30s.mp4, Combined/Original/1×/Clean/High | PASS — **~44s to 100%, complete by ~50s** (`test-speech-30s-sharpcut.mp4`, **1.27 MB, 29.87s, 1280×720**, captions burned, frame-checked at 2s). Previously ~86s of single-thread work *after* ~65s wasted on the MT hang + core reload. |
| Transitions | test-speech-30s.mp4, 2 kept segments, Quick Fade @ boundary, Combined/Original/**High**/Clean | PASS — `Rendering 1/2 → 2/2 → Joining with transitions` (**primary xfade path**, no safe-mode/plain-concat fallback) → burn captions → complete at **~113s**. Output **1.23 MB, 29.57s** — exactly the 29.87s straight-cut duration minus the 0.3s crossfade trim. Exercises the new `joinEncode` pass (segments intermediate, join intermediate, caption burn final). |
| Cancel | mid-render cancel of the 2-min/8-segment export | PASS — clicked "Cancel export" at ~7s (`Rendering segment 1/8`); returned to Export Studio, progress cleared, title reset, **no error card** (a cancel is not a failure). |
| Export failure surface | injected step-failure message | PASS — the "Export failed" card still renders the full FFmpeg message *and* the appended log tail verbatim; error reporting was not regressed by the engine change. |
| Per-pass encode args | all 3 quality tiers × captions on/off × transitions on/off, captured from the real production bundle by hooking `Worker.postMessage` | PASS — Standard: `veryfast`/23 on every pass (**byte-identical to the pre-fix args**, which is why the 30-minute Standard measurement below still stands). High: `veryfast`/19 on every pass (was `medium`/19). Source: intermediates `veryfast`/17, **final pass `fast`/17** — and when captions are off with no transitions the segments *are* the deliverable, so they correctly get `fast`/17; add a transition and the segments drop to `veryfast`/17 while the join takes `fast`/17. The intermediate-vs-final split resolves correctly in every combination. |
| Clips | 2 clips selected, Original/Standard | PASS — `…-clip-01.mp4` (0.50 MB) + `…-clip-02.mp4` (0.53 MB); "Download all (ZIP)" click threw no error, `exportJob.error` null |
| Speed remap | 1.5×, Combined/Original/no captions | PASS — output audio duration **20.04s** vs expected `30.066 / 1.5 = 20.04s` (probed via `decodeAudioData`) |
| Long combined (memory) | test-30min.mp4 (573 MB), Combined/Original/Standard/Clean, 115 active cuts → **116 segments** | PASS — full render (4 instance recycles) → join → caption burn → `test-30min-sharpcut.mp4` (**62.1 MB, 1684.9s, 1280×720**, decodes clean). ~40 min wall-clock (~20 min render, ~19 min burn). Previously OOM'd mid-render (`RuntimeError: memory access out of bounds` ~segment 40); fixed by evicting rendered segments to the JS heap + recreating the FFmpeg instance every 25 segments to reset `ffmpeg.wasm`'s per-`exec()` heap leak. **Not re-run after the encode-speed fix, deliberately:** that run used Standard quality, whose per-pass FFmpeg arguments are byte-identical before and after (verified in the row above), so the encode work cannot have changed it either way. The only difference is that it no longer wastes ~65s attempting the multithreaded core first. Intermediate CRF was intentionally left at the tier value precisely so intermediate segment sizes — which sit in memory for the whole render — could not grow and put this memory ceiling at risk. |

### Known environment notes / limitations found

- The verification browser tab ran **hidden** (background), where Chrome refuses
  to advance an `HTMLVideoElement` past `readyState 0`. This blocks the
  `<video>`-based upload-metadata probe and any `<video>`-based duration check,
  so those flows were verified via their underlying primitives instead
  (`decodeAudioData` for audio/duration; the `<video>` `error` event for the
  corrupt file, which fails fast enough to be unaffected). This is a test-harness
  constraint, not an app defect — the corrupt-file path was still confirmed
  end-to-end through the real UI.
- Export timings were measured in this hidden/throttled tab, where Chrome
  throttles worker scheduling, so a foregrounded tab should be equal or
  faster. Crucially the before/after 2-minute figures (~450–470s → 197.9s)
  were measured under the **same** harness conditions, so the ~2.3× is a
  like-for-like comparison, not a measurement artefact.
- **Not verified:** the 30-minute combined export was not re-run (see the note
  in its row). The multithreaded core's crawl was reproduced but no attempt
  was made to find machines/inputs where MT behaves well — the decision to
  disable it is based on it failing in the environments actually observed,
  including a real user's deployed session.
