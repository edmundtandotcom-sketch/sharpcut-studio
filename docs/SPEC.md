# SharpCut Studio — Claude Master Build Prompt

> Copy everything below into Claude Code or Claude’s coding environment. Give Claude an empty project folder and instruct it to complete the build, test it, and deploy it. Do not paste only selected sections; the entire specification is the source of truth.

---

# ROLE

You are a principal product designer, senior full-stack engineer, video-processing engineer, QA lead, and deployment specialist.

Build a production-ready, browser-based application called **SharpCut Studio**.

SharpCut Studio transforms long talking-head videos into tighter, sharper videos by:

- detecting filler words;
- detecting silence and long pauses;
- suggesting removable sections;
- letting the user approve, restore, add, move, or remove edits;
- combining all kept portions into one final video;
- exporting kept portions as individual video clips;
- reframing horizontal video into true vertical crops;
- adding editable animated captions;
- applying speed, zoom, flash, fade, and transition effects;
- keeping caption timing synchronised after speed changes;
- exporting a high-quality MP4 without requiring desktop editing software.

This is primarily an **internal team tool**. Anyone with the deployed URL must be able to open and use it directly from a desktop browser without installing software or creating an account.

Do not over-engineer this into a subscription SaaS. Prioritise reliability, clarity, privacy, ease of use, and a shareable hosted URL.

---

# NON-NEGOTIABLE PRODUCT OUTCOME

A teammate must be able to:

1. Open a public HTTPS URL.
2. Upload an MP4, MOV, WebM, or M4V video.
3. Allow the app to analyse speech and silence locally.
4. Review suggested removals.
5. manually edit the main video with clear red IN and OUT markers.
6. Preview the tightened video.
7. Configure crop, speed, captions, effects, transitions, and zoom.
8. Correct caption text in timed blocks.
9. Export either:
   - one full combined video; or
   - selected kept clips as individual MP4 files.
10. Download the result.

The application must remain usable for 30–60-minute talking-head videos and must not appear frozen during analysis or export.

---

# PRODUCT POSITIONING

## Product name

**SharpCut Studio**

## Tagline

**Turn long videos into sharp, ready-to-publish content.**

## Supporting line

Remove filler words, silence, and dead space. Reframe, caption, preview, and export—directly in your browser.

## Trust message

**Processed locally. Your video stays on this device.**

Do not claim local processing if any implementation sends video or audio to a third party. If a remote service is introduced, explicitly disclose it before upload and obtain approval from the project owner.

---

# TARGET USERS

- Property agents recording educational videos
- YouTube talking-head creators
- Reels and short-form content creators
- Internal video editors
- Team members without advanced editing software

Assume users are not technical. Every action must be understandable without documentation.

---

# TECHNICAL DIRECTION

Build this as a responsive web application.

Recommended stack:

- React
- TypeScript
- Vite or Next.js
- FFmpeg.wasm running inside Web Workers
- Web Audio API for waveform and silence analysis where useful
- A private, locally loaded speech-to-text model or a reliable browser-compatible transcription implementation
- IndexedDB for recoverable local project metadata
- CSS Modules, Tailwind, or well-structured global CSS
- Lucide icons

Use native browser capabilities wherever possible.

## Important architecture rules

1. Never perform FFmpeg encoding on the main UI thread.
2. Run analysis, transcription, and export in workers where technically possible.
3. Lazy-load heavy models and FFmpeg only when needed.
4. Cache downloaded model files after the first run.
5. Keep the UI responsive throughout processing.
6. Provide cancellable operations.
7. Release object URLs, ArrayBuffers, model instances, workers, and temporary files after use.
8. Do not load an entire long video into multiple redundant in-memory copies.
9. Prevent duplicate analysis or export jobs from starting.
10. Detect unsupported browsers and provide a clear message.
11. Chrome and Edge desktop are the primary supported browsers.
12. Never fake processing progress. Use measured progress when available and clearly labelled stage progress otherwise.

## Browser-only constraint

The first release should not require:

- user accounts;
- subscriptions;
- server-side video storage;
- remote project collaboration;
- desktop installation;
- paid APIs;
- a permanent backend database.

If a completely browser-based transcription method cannot meet the accuracy or long-video reliability target, stop and explain the exact limitation before substituting an external API.

---

# INFORMATION ARCHITECTURE

The application has five main states:

1. Upload
2. Analysis
3. Review edits
4. Export Studio
5. Export complete

Do not place the entire workflow on one infinitely long page.

---

# STATE 1 — UPLOAD

Create a premium, minimal landing interface.

## Header

- SharpCut Studio logo/wordmark
- “Processed locally” trust badge
- “Your video stays on this device”

## Hero

- “Turn long takes into sharp cuts.”
- Short supporting description
- Large drag-and-drop upload zone
- “Choose video” button
- Accepted formats and maximum recommended file size

## Pacing preset

Provide:

- **YouTube** — natural breathing room
- **Reels** — tighter, faster pacing

YouTube is selected by default.

## Upload validation

Validate:

- file type;
- readable duration;
- audio-track availability;
- file size;
- browser memory risk;
- corrupted or unsupported codec.

Never silently reject a file. Give the user a plain-language explanation and a recovery action.

---

# STATE 2 — ANALYSIS

Show a dedicated processing screen.

## Main message

“Building your sharp first cut.”

## Required processing stages

1. Read audio track
2. Load private speech AI
3. Map words to the timeline
4. Detect silence and filler words
5. Build suggested cuts

## Progress requirements

- Overall progress percentage
- Active stage
- Completed-stage checkmarks
- Elapsed time
- Approximate remaining range when calculable
- Cancel analysis button
- “The first run downloads a private speech model” notice
- Never appear frozen
- Update visible progress at least every few seconds
- Provide recovery if a worker crashes or runs out of memory

For videos longer than 20 minutes:

- split audio analysis into bounded chunks;
- process sequentially or with safe limited concurrency;
- merge timestamps without drift;
- save partial progress locally;
- avoid restarting from zero after a recoverable failure.

---

# TRANSCRIPTION AND DETECTION LOGIC

## Word timestamps

Every transcript word must contain:

- text;
- start time;
- end time;
- confidence where available.

## Filler words

Detect common fillers, including:

- um;
- uh;
- erm;
- ah;
- you know;
- basically;
- actually;
- literally;
- sort of;
- kind of;
- I mean.

Do not automatically remove every occurrence. Score candidates based on:

- confidence;
- surrounding pause;
- whether removing it creates an unnatural jump;
- proximity to another edit;
- whether the word is semantically meaningful in context.

## Silence

Use adjustable thresholds:

- minimum silence duration;
- amount of breathing room retained before speech;
- amount retained after speech;
- separate YouTube and Reels defaults.

Never remove every micro-pause. Preserve natural speech.

## Suggested cuts

Each cut must contain:

- unique ID;
- type: filler, silence, repeat, or manual;
- start time;
- end time;
- duration;
- reason;
- active/inactive state;
- confidence;
- reversible status.

Prevent overlapping cuts from causing broken output. Merge or resolve them deterministically.

---

# STATE 3 — REVIEW EDITS

Use a desktop two-column layout.

## Left column

- Main video preview
- Current time and total duration
- Before/after duration
- Play/pause
- Previous/next cut
- Preview with approved cuts skipped
- Button: **Edit clips manually**

The preview must skip active removal ranges while playing.

## Right column

- Suggested edits heading
- Number selected
- Select all / restore all
- Filters:
  - All
  - Filler
  - Silence
  - Repeats
  - Manual
- Scrollable edit list

Each suggested edit card shows:

- type;
- timestamp;
- duration;
- transcript context;
- amount removed;
- active toggle;
- play-context button.

## Scroll behaviour

- The edit list must scroll independently.
- Scrollbars must remain fully visible.
- Nothing may be clipped on the right edge.
- Add `scrollbar-gutter: stable`.
- Prevent accidental horizontal overflow.
- Keep headers and important controls visible.
- On smaller screens, stack the layout without trapping the user in nested scrolling areas.

---

# MANUAL MAIN-VIDEO EDITOR

Users must be able to create their own removal ranges.

## Required interaction

1. Move playhead to desired start.
2. Click **Set IN**.
3. Move playhead to desired end.
4. Click **Set OUT**.
5. Review the range.
6. Click **Remove selected range**.

## Visual language

- IN marker: red
- OUT marker: red
- Selected removal range: translucent red
- Exact IN and OUT timestamps shown below timeline
- Timeline and edit-reference list must update immediately
- Manual cuts must appear in the main edit list
- Manual cuts must remain reversible

Additional controls:

- clear IN/OUT;
- play selected range;
- jump to IN;
- jump to OUT;
- undo last manual cut.

Reject invalid or zero-length ranges with a clear explanation.

---

# OPEN EXPORT STUDIO

Use a professional editing-studio layout.

## Desktop layout

- Sticky preview column on the left
- Full-height scrollable settings column on the right
- Important preview controls below the preview
- Fixed or sticky export summary at the bottom of the settings column

The user must not need to scroll up repeatedly to see the preview.

## Responsive layout

- At tablet/mobile widths, stack preview above controls.
- Avoid hidden controls.
- Avoid right-edge clipping.
- Avoid sliders extending underneath scrollbars.
- Maintain safe padding between content and scrollbar.

---

# EXPORT MODE

Provide two modes.

## 1. Full combined video

Join every kept segment into one final MP4.

## 2. Individual kept clips

“Individual clips” means the kept sections between approved cuts.

Provide:

- select all;
- clear all;
- individual clip checkboxes;
- clip number;
- time range;
- duration;
- short transcript description;
- preview selected clip;
- export selected clips as separate MP4 files.

If multiple clips are generated, provide:

- individual download buttons;
- “Download all” as a ZIP when practical;
- sensible filenames such as `original-name-clip-01.mp4`.

---

# SPEED CONTROL

Provide an output-speed control for all selected output:

- 0.75×
- 0.9×
- 1×
- 1.1×
- 1.25×
- 1.5×
- optional fine slider

Requirements:

- Preview video must immediately use the selected playback rate.
- Audio pitch must remain natural where the encoding method supports it.
- Exported video and audio must remain synchronised.
- Cut timestamps must be remapped to output time.
- Caption timings must be remapped to output time.
- Transition timings must be remapped.
- Zoom timings must be remapped.
- Caption blocks must not lag behind accelerated speech.

## Caption timing formula

For every kept source segment:

1. Remove excluded source ranges.
2. Map each word from source time into the concatenated output timeline.
3. Divide mapped segment-relative time by selected speed.
4. Build caption cues from the resulting output timestamps.
5. Clamp cues so they do not overlap incorrectly.
6. Shorten the number of words shown simultaneously at faster speeds.

Do not merely change video playback speed while retaining original caption timestamps.

---

# VIDEO FORMAT AND CROPPING

Provide:

- Original
- Horizontal 16:9
- Vertical 9:16

## True crop requirement

When converting a horizontal source into vertical:

- scale the source until the entire 9:16 frame is filled;
- crop excess left/right areas;
- never place the horizontal video in the centre with duplicated, blurred, or empty top and bottom regions;
- preserve full frame coverage;
- support adjustable crop position.

## Manual reframing

Provide:

- horizontal-position slider;
- vertical-position slider;
- drag-to-reposition directly on preview if possible;
- re-centre button;
- live crop preview;
- crop values that are used in final export.

The user must be able to shift the original video inside the 9:16 frame when automatic centring is not ideal.

---

# CAPTION SYSTEM

Captions are burned into the final video and displayed accurately in preview.

## Caption creative presets

Provide visually distinct presets:

1. No captions
2. Clean
3. Impact Pop
4. Karaoke
5. Bounce Box
6. Creator Outline
7. Highlight Bar
8. Brand Banner
9. Minimal Editorial
10. Reels Punch
11. Word Pop
12. Lower Third

Every preset card must:

- show a representative preview;
- be fully clickable;
- use the correct selection handler;
- show a strong selected border;
- show a checkmark and “Selected” label;
- use `aria-pressed`;
- visibly change the main preview;
- visibly change the exported result.

Do not create cosmetic cards that all map to the same output style.

## Brand Banner

Brand Banner must be obviously different:

- coloured banner/panel;
- accent edge;
- high-contrast text;
- active-word highlight;
- compact padding;
- quick entrance animation;
- configurable text, background, outline, and accent colours;
- no oversized box covering the speaker.

## Karaoke

- Highlight the currently spoken word.
- Never overlap words.
- Never break words into isolated characters.
- Keep words in correct reading order.
- Use word-level timestamps.
- Keep active-word highlighting synchronised after speed changes.

## Caption font controls

Provide:

- Modern
- Classic
- Impact
- Editorial
- Creator Rounded
- Reels Condensed
- Heavy Black
- Typewriter
- Montserrat-style bold
- Bebas-style condensed
- Poppins-style clean
- Oswald-style creator

Use properly licensed web fonts or safe fallbacks.

## Caption colours

Provide controls for:

- text;
- background;
- outline;
- accent/highlight;

Include reset-to-preset-default.

## Caption size

Provide a clearly labelled slider:

- minimum: 50%
- maximum: 300%
- current percentage visible

Requirements:

- captions must remain inside the video width;
- apply safe horizontal margins;
- wrap by meaningful word groups;
- reduce words per line at larger sizes;
- never shrink letters independently;
- never overlap player controls;
- preview and export must match.

## Caption letter case

Place these controls prominently immediately beneath caption creative presets:

- **ALL UPPERCASE**
- **all lowercase**
- **First Letter Of Each Word**
- **Keep Original**

Each control must:

- show a checkmark when active;
- use `aria-pressed`;
- update the preview immediately;
- update the exported video;
- remain visible without hunting through other settings.

“First Letter Of Each Word” means title case: lowercase the word first, then capitalise its first letter.

## Caption position

Provide:

- Safe Top
- Centre
- Safe Bottom
- manual vertical-position slider
- direct drag positioning when feasible

Requirements:

- position refers to the caption text block, not a giant background layer;
- background must hug the text;
- safe presets must stay away from video controls and social-platform UI;
- manual positioning must be reflected in export;
- no preset may cover a large portion of the original video.

---

# CAPTION TEXT EDITOR

Provide a timed caption-block editor.

Each block shows:

- start time;
- end time;
- editable caption text;
- play block button;
- previous/next block navigation;
- active block highlight.

Requirements:

- edits update preview immediately;
- edits preserve the block’s timing unless the user changes timing;
- text is re-tokenised safely for karaoke;
- edited words receive proportional timing across the block when word-level timing is unavailable;
- support find and replace;
- support undo and redo;
- warn about empty blocks;
- no large unstructured “summary” textbox disconnected from timing.

---

# TRANSITIONS

Automatically suggest transitions at major section changes.

## Auto-placement signals

Use:

- long removed gaps;
- topic-change boundaries;
- larger edit boundaries;
- speaker or scene change where detectable;
- avoid applying transitions at every tiny cut.

## Presets

- None
- Quick Fade
- Flash
- Dip to Black
- Quick Push
- Cross Dissolve
- Clean Blur

## Controls

- Apply suggested transitions
- Apply one transition to all major boundaries
- Add transition at selected boundary
- Remove transition
- Change transition type per boundary
- Preview transition

Transitions must be short and tasteful. Default duration should generally be 80–250 ms depending on style.

---

# ZOOM EFFECTS

Automatically add quick zoom effects to suitable kept segments.

## Zoom types

- Quick Zoom In
- Quick Zoom Out
- Punch In
- Reset

## Requirements

- Default zoom must be fast and clearly visible.
- Typical movement duration: approximately 80–180 ms.
- Do not use slow continuous zooms by default.
- Hold briefly after zooming when appropriate.
- Add initial auto-suggestions.
- Let user add, remove, and change effects per segment.
- Show effect markers on timeline.
- Synchronise effects after speed changes.
- Use crop-safe transforms that do not expose empty edges.

---

# PREVIEW ACCURACY

The Export Studio preview must reflect:

- approved cuts;
- chosen output mode;
- speed;
- true crop and crop position;
- caption creative;
- font;
- caption size;
- colours;
- caption case;
- caption position;
- corrected caption text;
- active karaoke word;
- transitions;
- zoom effects.

Preview does not have to be frame-perfect during playback, but its visual treatment and timing must closely match final export.

Add a clear notice if an effect is an approximation in preview.

---

# EXPORT ENGINE

Use FFmpeg with deterministic filter generation.

## Export requirements

- H.264 video
- AAC audio
- MP4 container
- yuv420p pixel format
- even output dimensions
- preserved aspect ratio before crop
- selectable quality:
  - Standard
  - High
  - Source-conscious
- maintain audio/video sync
- retain natural audio pitch where supported
- avoid unnecessary quality loss

## Export sequence

1. Validate settings.
2. Resolve active cuts.
3. Build kept segments.
4. Remap transcript into output time.
5. Apply speed mapping.
6. Apply format scale and crop.
7. Apply zoom effects.
8. Apply transitions.
9. Render captions.
10. Encode audio and video.
11. Produce downloadable files.
12. Clean temporary virtual filesystem files and memory.

## Export progress

Show:

- current stage;
- percentage;
- elapsed time;
- cancel button;
- warning not to close the tab;
- recovery guidance after failure.

Do not leave the UI on one percentage for several minutes without a stage explanation.

## Long-video strategy

For long videos:

- process kept segments in bounded batches when necessary;
- concatenate safely;
- limit peak memory;
- report memory constraints before a likely crash;
- offer “export in individual clips” if combined export is too large;
- retain current edit decisions after a failed render.

---

# PERFORMANCE AND RELIABILITY

The app must handle a 30-minute video as a core acceptance test.

Target:

- UI remains responsive;
- visible progress continues;
- no duplicate jobs;
- no lost edit decisions;
- no unexplained freeze;
- no unbounded DOM lists;
- no right-side clipping;
- clean memory release after export.

Implement:

- virtualised lists where appropriate;
- debounced sliders;
- memoised derived edit ranges;
- Web Workers;
- IndexedDB checkpoints;
- cancellable tasks;
- error boundaries;
- structured error messages;
- resource cleanup;
- feature detection.

---

# UI/UX DESIGN SYSTEM

Create a premium creator-tool aesthetic.

## Visual direction

- Warm off-white canvas
- Deep navy text
- Electric blue primary action
- Soft blue selection surfaces
- Red only for destructive/manual cut indicators
- Yellow as caption highlight/accent
- Subtle shadows
- Rounded but professional cards
- Clear hierarchy
- Spacious desktop layout
- Compact controls

Suggested tokens:

- Background: `#F7F5F0`
- Surface: `#FFFFFF`
- Ink: `#172033`
- Muted: `#667085`
- Primary: `#355CFF`
- Primary soft: `#EEF2FF`
- Danger: `#E5484D`
- Highlight: `#FFE800`
- Border: `#E6E2DA`
- Success: `#16A36A`

Use one strong sans-serif family with display and UI weights.

## Accessibility

- Keyboard-operable controls
- Visible focus states
- Proper labels
- ARIA states for toggles and selected cards
- Sufficient contrast
- Captions readable against varied footage
- Do not depend on colour alone

---

# LOCAL PROJECT RECOVERY

Use IndexedDB to store:

- project name;
- original filename;
- duration;
- transcript;
- caption blocks;
- suggested cuts;
- manual cuts;
- selected cuts;
- crop settings;
- caption settings;
- speed;
- transition points;
- zoom effects;
- last completed stage.

Because browser security may prevent permanent storage of the original video file, clearly state:

- whether the user needs to reselect the original file after reopening;
- that saved edit decisions can be restored;
- never pretend the original video was saved if it was not.

Provide:

- “Save project file” as JSON;
- “Open project file”;
- “Start over” with confirmation.

---

# SHARING AND DEPLOYMENT

The completed application must be deployable as a static or edge-hosted website.

Preferred deployment options:

1. Cloudflare Pages
2. Vercel
3. Netlify

Choose the option that best supports:

- HTTPS;
- WebAssembly;
- large static assets;
- required cross-origin isolation headers for multithreaded FFmpeg;
- reliable public team access;
- no user login.

## Required security headers

Configure correctly if multithreaded WebAssembly requires them:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

Ensure all WASM, worker, font, and model assets are served compatibly with these headers.

## Deliverables

At completion, provide:

- public production URL;
- full source code;
- README;
- local development command;
- production build command;
- deployment instructions;
- hosting configuration;
- supported-browser statement;
- privacy statement;
- known limitations;
- test report;
- rollback instructions.

Do not return only a localhost URL.

---

# TESTING MATRIX

Test all of the following.

## Upload

- valid MP4
- MOV
- WebM
- unsupported format
- missing audio
- corrupted file
- large file

## Duration

- 30 seconds
- 5 minutes
- 30 minutes
- 60 minutes when test hardware permits

## Editing

- enable/disable cuts
- overlapping cuts
- manual IN/OUT cut
- restore manual cut
- play across removed range

## Captions

- every creative preset
- Brand Banner produces visibly distinct output
- Karaoke highlights correct words
- upper/lower/title/original case
- font changes
- colours
- 50% and 300% size
- Safe Top/Centre/Safe Bottom
- manual vertical position
- edited timed blocks

## Format

- original
- 16:9
- 9:16
- horizontal source into true vertical crop
- crop X/Y movement
- no blurred-background letterboxing

## Speed

- 0.75×
- 1×
- 1.25×
- 1.5×
- captions remain synchronised
- effects remain synchronised

## Export

- full combined
- one individual clip
- all individual clips
- cancel
- retry after failure
- download
- memory cleanup

## Responsive UI

- 1440×900
- 1280×720
- 1024×768
- tablet
- mobile

At every width:

- scrollbar visible;
- controls not clipped;
- no horizontal overflow;
- preview remains accessible;
- export button remains reachable.

---

# ACCEPTANCE CRITERIA

Do not claim completion until all are true:

1. A teammate can open the deployed URL without installing software.
2. A video can be uploaded and analysed.
3. Analysis progress does not appear frozen.
4. Suggested cuts are reversible.
5. Manual red IN/OUT cuts work.
6. Preview skips approved cuts.
7. Full combined export works.
8. Individual kept-clip export works.
9. True 9:16 crop fills the full frame.
10. Crop position is adjustable.
11. Caption presets are actually distinct.
12. Brand Banner has a real visible function.
13. Karaoke does not overlap or break words.
14. Caption case buttons are present and functional.
15. Caption size supports 50–300%.
16. Caption position is manually adjustable.
17. Timed caption text is editable.
18. Captions stay synchronised after speed changes.
19. Suggested transitions can be added or removed.
20. Quick zoom effects are visible and editable.
21. Right-side settings scrollbar is fully visible.
22. No controls are cut off.
23. Export quality is acceptable for Reels and YouTube.
24. Edit decisions survive a recoverable failure.
25. README and deployment instructions are complete.

---

# IMPLEMENTATION WORKFLOW FOR CLAUDE

Follow this order:

1. Inspect the project folder.
2. Create a concise implementation plan.
3. Establish types and the video-edit data model.
4. Build upload and metadata validation.
5. Build worker infrastructure.
6. Build analysis and transcription pipeline.
7. Build cut review and manual editing.
8. Build Export Studio preview.
9. Build caption system and timed editor.
10. Build crop, speed, transitions, and zoom.
11. Build deterministic export pipeline.
12. Add project recovery.
13. Add responsive polish and accessibility.
14. Test with real video files.
15. Fix failures rather than describing them.
16. Create production build.
17. Deploy to a public HTTPS URL.
18. Run a final deployed smoke test.
19. Return the URL and concise handover.

Do not ask the owner to make routine technical decisions. Choose strong defaults and document them. Only pause for:

- credentials;
- domain-provider login;
- deployment-account approval;
- paid external services;
- a fundamental browser limitation that changes privacy or cost.

---

# DO NOT DO THESE

- Do not make a static mock-up.
- Do not fake transcription.
- Do not fake export.
- Do not make buttons that only change appearance.
- Do not create multiple caption cards that render the same style.
- Do not put horizontal video in a vertical canvas with blurred top/bottom filler.
- Do not leave captions on original timestamps after speed changes.
- Do not place caption backgrounds across most of the frame.
- Do not use slow zooms as the default.
- Do not hide manual editing.
- Do not allow the settings column to overflow behind its scrollbar.
- Do not block the main UI thread during long operations.
- Do not silently upload private videos.
- Do not introduce user accounts, payments, or complex SaaS infrastructure for this internal-team release.
- Do not stop after generating code—test, deploy, and provide the working public URL.

---

# FINAL RESPONSE FORMAT

When finished, respond with:

## SharpCut Studio is ready

- Production URL
- Supported browsers
- Maximum recommended video length
- Privacy behaviour
- Features completed
- Tests passed
- Known limitations
- How to redeploy
- How to connect a custom domain

Keep the final handover concise, but ensure the README contains the full technical instructions.

---

# START NOW

Build SharpCut Studio completely. Use this specification as the authoritative product contract. Preserve privacy, keep the experience simple for teammates, and prioritise a reliable 30–60-minute workflow over unnecessary SaaS complexity.
