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
  - Three export quality tiers (Standard — the recommended default — / High /
    Source-conscious).
  - Thumbnail selector: scrub any frame from the original source video
    (cuts included) or upload a JPG/PNG, then download it as a JPEG rendered
    at the exact export geometry (format, crop, dimensions) alongside the
    video on the complete screen.
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

## Preview accuracy (caption position & size)

**What you see in the studio preview is what gets burned into the MP4.** That is
now a *measured* guarantee, not a hope.

The preview draws captions with CSS; the export burns them with libass through
FFmpeg. Two renderers, one contract — held together by `src/lib/captionLayout.ts`,
which owns every number that decides where a caption sits and how big it is.
`components/studio/CaptionOverlay.tsx` and `lib/assSubtitles.ts` both read it and
neither may define its own.

- **Position** — one rule for all four modes: the caption block's **centre**
  lands on `captionAnchorPct(style)` of frame height (top 13%, centre 50%,
  bottom 83%, custom = the slider clamped to 6–94%). The export puts every
  Dialogue line on an explicit `\pos()` with a middle alignment (4/5) so it
  anchors the same point. It never pins an edge to a margin — doing that is what
  used to burn bottom captions ~6% of the frame height lower than the preview
  showed. A left-aligned preset's left **edge** sits on `CAPTION_LEFT_INSET`
  (6% of frame width) on both sides.
- **Size** — the caption em is `0.055 x frameHeight x sizePct/100` px on both
  sides. libass does *not* treat ASS `Fontsize` as that em: it scales the face so
  the OS/2 `usWinAscent + usWinDescent` fills `Fontsize`. The export therefore
  multiplies by the face's `assLineEm` (`CAPTION_FONTS[...].assLineEm`, taken
  from the bundled .ttf's own OS/2 table). Without that factor burned captions
  come out **24–43% smaller than the preview**, depending on the font — Inter
  30%, Montserrat 36%, Poppins 43%.

### Tolerances (verified 2026-07-31)

A 12-run matrix — positions {top, centre, bottom, custom 40%} x sizes {65%, 300%}
for Clean, plus Karaoke 100%, Impact Pop 150%, Brand Banner 100% (left-aligned)
and one 9:16 run — was exported on a flat-grey fixture and the burned pixels
measured programmatically against the preview's own DOM geometry. The fixture is
a solid mid-grey clip, so any non-grey pixel in an exported frame *is* the
caption; recreate it with:

```bash
ffmpeg -f lavfi -i color=c=0x808080:s=1280x720:d=20 \
       -f lavfi -i sine=frequency=440:duration=20 \
       -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -shortest \
       testdata/test-gray.mp4
```

Every row is inside:

| Metric | Tolerance | Worst measured |
|---|---|---|
| Caption centre Y (% of frame height) | ± 3 | 0.82 |
| Caption height (relative) | ± 15% | 11.8% |
| Caption centre X (% of frame width) | ± 3 | 1.54 |

Known residual approximations, all well inside tolerance:

- The ASS box hugs the text more tightly **horizontally** than the CSS box. ASS
  `Outline` is a single value used on both axes, and it is solved for *height*
  parity (box height = line box + 2 x Outline), so the horizontal padding comes
  out at ~0.15 em instead of the preview's 0.5 em.
- libass advance widths run ~3% narrower than the browser's for the same face and
  size, so a burned line is marginally shorter than the previewed one. Line
  breaking is unaffected: word grouping is measured with the browser's metrics,
  so the export can only ever be *narrower* than what was fitted.
- A caption large enough to overflow the frame (e.g. 300% anchored at the top)
  is clipped by the frame on both sides, but the preview's measured box still
  reports its unclipped height.

## Known limitations

- **Practical length ceiling:** a 30-minute / 573 MB / 116-segment combined
  export (Standard quality, Clean captions) has been run end-to-end to a valid
  file; that run took ~40 minutes in-browser (~20 min rendering + ~19 min
  caption burn). The separate caption-burn pass no longer exists — captions burn
  inside each segment's own render (below) — so the same job should now land
  nearer ~20 minutes. ~40 min is simply the last *measured* number for that
  fixture and is kept as a pessimistic bound. Longer/larger videos may run
  slowly; analysis checkpoints to IndexedDB so an interrupted long run can
  resume instead of restarting.
- **WASM memory ceiling:** the FFmpeg WebAssembly heap is capped around 2 GB
  (and the multithreaded core's SharedArrayBuffer cannot grow past its build-
  time maximum). Two things make long combined exports fit: (1) each rendered
  segment is evicted from the wasm FS into the worker's JS heap the instant it
  is done, so the render never accumulates segment bytes in wasm memory; and
  (2) because `ffmpeg.wasm` leaks heap on every `exec()` call, the export
  recreates the FFmpeg instance every 25 segments (and once before the join) to
  reset the leaked heap — the evicted segments survive the teardown and
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
  that produces the deliverable pays for the chosen preset — an intermediate is
  output that a later pass re-encodes and deletes, and the only remaining
  downstream re-encode is the xfade join, so segment renders are intermediates
  **only when transitions are on**. This tool targets Reels/YouTube, not
  archival mastering.
- **Captions are burned during the segment render, not in a second pass:** the
  export used to re-encode the *entire* joined output once more through libass,
  which on the 2-minute fixture was roughly half the total wall-clock. Instead,
  each segment now carries its own ASS file containing just the cues inside its
  own window, rebased so the segment starts at 0, and its own `ass=` filter at
  the end of that segment's `-vf` chain. With no transitions the join is then a
  pure concat stream copy and the segment renders *are* the deliverable, so a
  captioned export costs one encode of the timeline instead of two (measured:
  the 2-minute / 8-segment fixture went from ~198s to **~88s**). Turning captions
  off changes nothing about the pipeline shape — there is simply no `ass=` filter
  in any command.
- **No caption drift after transitions (fixed):** captions used to be burned onto
  the joined timeline, whose length each xfade shortens by its own crossfade
  duration, so transition-heavy edits accumulated ~0.2s of caption drift per
  transition. Burning per segment makes captions immune to it — they ride inside
  the segment's own frames, wherever the join places those frames.
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
- **Caption fonts must be exact-match static instances, not variable fonts:**
  the `ffmpeg.wasm` build's libass has **no system font provider**
  ("`can't find selected font provider`" in its logs) — it can only load
  fonts via `-vf ass=...:fontsdir=fonts`, and it matches the ASS style's
  `Fontname` against each font file's internal name **by exact string, with
  zero fallback**. A mismatch renders nothing, silently, with exit code 0 —
  there is no error to catch. This bit us for real: 5 of the 10 TTFs in
  `public/fonts/` were **variable fonts**, and libass always resolves a
  variable font to its **default named instance**, not the weight the
  filename implies (e.g. `Montserrat-Bold.ttf` resolved to the Thin
  instance, so every karaoke-preset export — which defaults to Montserrat —
  had invisible captions; `Nunito-ExtraBold.ttf` didn't resolve to *any*
  instance at all). The fix was to replace those 5 files with **statically
  instantiated** TTFs (`fonttools varLib.instancer <file> wght=<weight>
  --update-name-table`, same filenames, non-variable — no `fvar` table) and
  correct `assFamily` in `src/lib/captionLayout.ts` to each file's real
  internal family name. Two naming patterns show up after static
  instantiation, and both are used in `CAPTION_FONTS` today: Regular/Bold
  instances keep the plain family name (`"Montserrat"`, `"Inter"`), while
  non-RIBBI weights fold the weight into the family name (`"Poppins
  SemiBold"`, `"Barlow Condensed SemiBold"`, `"Oswald SemiBold"`, `"Playfair
  Display SemiBold"`, `"Nunito ExtraBold"`). **Do not add a new caption font
  without verifying it empirically** — dump the font's name-table strings
  (e.g. with `fonttools ttx -t name`) and confirm libass actually logs a
  `fontselect:` line (not `can't find selected font provider`) for the exact
  `assFamily` string you intend to ship, using a minimal `.ass` + `-vf ass=`
  probe against the real `ffmpeg-core.wasm`. Never trust the filename, the
  `@fontsource` package name, or the OpenType naming convention alone.

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
| Caption position + size parity (measured) | PASS — 12-export matrix on a flat-grey fixture; burned pixels measured against preview DOM geometry; worst deltas 0.82% frame height (centre Y), 11.8% (height), 1.54% frame width (centre X). See "Preview accuracy" |
| Caption text edits reach the export | PASS — two blocks retyped in the editor, burned verbatim at 65% / custom 85% / Karaoke on `test-speech-30s.mp4`; ALL CAPS toggle and a `#00FF00` karaoke accent both confirmed by pixel check (fill centre 84.93% vs preview 85.00%) |
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
| **2-minute clip (the reported bug)** | test-2min.mp4 (42 MB, 120.1s), 7 active cuts → **8 segments**, Combined/Original/1×/**Karaoke**/**Standard** | **PASS — 87.7s (1m28s)**, with in-render caption burning. `Rendering segment 1/8 … 8/8` (each render now also burns that segment's captions) → `Joining segments` (concat stream copy) → `Finishing`. Output `test-2min-sharpcut.mp4`: **115.79s, 1280×720**. Frame-checked at 33s ("okay, do you think people will") and 72s ("Okay, then you don't want to") — karaoke fill correct, text legible. At output 29.4s (immediately after the removed `29.24–30.84` filler cut) the caption reads "know, let me just share with" — the cut word "You" is gone. **The same fixture measured 197.9s** on the previous architecture (High quality, single full-length caption-burn pass); before *that*, 7½–8 min with MT forced off, and the MT core simply crawled forever. |
| Combined + captions | test-speech-30s.mp4, Combined/Original/1×/Clean/High | PASS — ~44s to 100%, complete by ~50s (**previous architecture**; `test-speech-30s-sharpcut.mp4`, 1.27 MB, 29.87s, 1280×720, captions burned, frame-checked at 2s). Superseded by the two rows above/below, which measure the in-render burn. |
| Transitions + captions (drift fix) | test-speech-30s.mp4, manual cut 10–13s → **3 kept segments**, Quick Fade (160ms) @ boundary 2 via the transitions UI, Combined/Original/**Karaoke**/**Standard** | **PASS — 50.1s** (was ~113s on the previous architecture at High). `Rendering 1/3 → 2/3 → 3/3` (captions burned in) → `Joining with transitions` (**primary xfade path** — output **26.733s** = 9.80s + 17.07s − 0.16s crossfade, so no plain-concat fallback) → `Finishing`. **Caption drift after the transition is gone:** segment 3's frames start at output 9.64s (xfade offset), and at output **10.05s** the karaoke fill sits exactly on the "be"/"three" boundary — predicted 10.02s, i.e. within one 30fps frame. 10.7s further on, at output **20.38s**, the fill is on "shopping" ("the whole ***shopping*** paradise with a"), again matching the frame to ~0.03s. On the old joined-timeline burn both would have lit **0.16s late**. |
| Clips + captions (in-render burn) | test-speech-30s.mp4, clips 1+2 selected, Original/Standard/**Karaoke** | PASS — `…-clip-01.mp4` + `…-clip-02.mp4`, one render each, **no second caption pass**. Frame-checked: clip 1 @2.0s "They can break the whole outdoor", clip 2 @2.5s "The tangling, orchard," — both karaoke-filled. `exportJob.error` null. |
| Captions off — fast path | test-speech-30s.mp4, 3 kept segments, no transitions, preset `none`, Combined/Standard | PASS — plan captured from the production bundle by hooking `Worker.postMessage`: **`fonts: []`, no segment carries an `ass` file, and no `ass=` appears in any segment's `-vf`**. Stage trace: `Preparing 0.0s → Rendering 1/3 → 2/3 (3.1s) → 3/3 (6.9s) → Freeing memory (18.0s) → Joining segments (18.1s) → Finishing (18.2s)`, done at **18.2s** — the concat stream copy really is the last step (~0.1s) and there is no caption stage at all. |
| Cancel | mid-render cancel of the 2-min/8-segment export | PASS — clicked "Cancel export" at ~7s (`Rendering segment 1/8`); returned to Export Studio, progress cleared, title reset, **no error card** (a cancel is not a failure). |
| Export failure surface | injected step-failure message | PASS — the "Export failed" card still renders the full FFmpeg message *and* the appended log tail verbatim; error reporting was not regressed by the engine change. |
| Per-pass encode args | all 3 quality tiers × captions on/off × transitions on/off, captured from the real production bundle by hooking `Worker.postMessage` | PASS — Standard: `veryfast`/23 on every pass (**byte-identical to the pre-fix args**, which is why the 30-minute Standard measurement below still stands). High: `veryfast`/19 on every pass (was `medium`/19). Source: `fast`/17 on the deliverable pass, `veryfast`/17 on intermediates. Since captions burn in-render, **captions no longer make the segment renders intermediate** — only transitions do (the xfade join re-encodes). Verified on the captioned/no-transition runs above: `segmentEncode == joinEncode == encode` (`veryfast`/23 at Standard). |
| Clips | 2 clips selected, Original/Standard | PASS — `…-clip-01.mp4` (0.50 MB) + `…-clip-02.mp4` (0.53 MB); "Download all (ZIP)" click threw no error, `exportJob.error` null |
| Speed remap | 1.5×, Combined/Original/no captions | PASS — output audio duration **20.04s** vs expected `30.066 / 1.5 = 20.04s` (probed via `decodeAudioData`) |
| Long combined (memory) | test-30min.mp4 (573 MB), Combined/Original/Standard/Clean, 115 active cuts → **116 segments** | PASS — full render (4 instance recycles) → join → caption burn → `test-30min-sharpcut.mp4` (**62.1 MB, 1684.9s, 1280×720**, decodes clean). ~40 min wall-clock (~20 min render, ~19 min burn). **Measured on the previous architecture and not re-run since captions moved in-render** — the ~19 min burn pass no longer exists, so this is now a pessimistic bound; the memory model it validates (segment eviction + instance recycling) is unchanged, and per-segment ASS files are a few KB each. Previously OOM'd mid-render (`RuntimeError: memory access out of bounds` ~segment 40); fixed by evicting rendered segments to the JS heap + recreating the FFmpeg instance every 25 segments to reset `ffmpeg.wasm`'s per-`exec()` heap leak. **Not re-run after the encode-speed fix, deliberately:** that run used Standard quality, whose per-pass FFmpeg arguments are byte-identical before and after (verified in the row above), so the encode work cannot have changed it either way. The only difference is that it no longer wastes ~65s attempting the multithreaded core first. Intermediate CRF was intentionally left at the tier value precisely so intermediate segment sizes — which sit in memory for the whole render — could not grow and put this memory ceiling at risk. |

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
