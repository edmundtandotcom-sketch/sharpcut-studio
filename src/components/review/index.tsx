import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightLeft, ChevronLeft, ChevronRight, Pause, Play, Sparkles, Wand2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { coalesceCuts, keptDuration, keptSegments } from '../../lib/cuts';
import { clamp, formatTime } from '../../lib/time';
import { PlaceholderCard } from '../shared/PlaceholderCard';
import { Timeline } from './Timeline';
import { ManualEditor } from './ManualEditor';
import { EditList } from './EditList';
import type { Cut } from '../../types';

// How much extra context to play before/after a cut when previewing it (SPEC "play-context button").
const CONTEXT_PAD_S = 1.5;

export function ReviewScreen() {
  const videoUrl = useAppStore((s) => s.project.videoUrl);
  const meta = useAppStore((s) => s.project.meta);
  const cuts = useAppStore((s) => s.edits.cuts);
  const toggleCut = useAppStore((s) => s.edits.toggleCut);
  const addManualCut = useAppStore((s) => s.edits.addManualCut);
  const setAllActive = useAppStore((s) => s.edits.setAllActive);
  const undoLastManual = useAppStore((s) => s.edits.undoLastManual);
  const setAppState = useAppStore((s) => s.setAppState);
  const resetProject = useAppStore((s) => s.resetProject);

  const videoRef = useRef<HTMLVideoElement>(null);
  // When set, the skip/pause loop below stops the video at this source time (used
  // by "play selected range" and "play context").
  const rangeEndRef = useRef<number | null>(null);
  // While true, the auto-skip-active-cuts loop is disabled (so context/range
  // previews can play straight through a removed range instead of skipping it).
  const suppressSkipRef = useRef(false);

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showManualEditor, setShowManualEditor] = useState(false);
  const [pendingIn, setPendingIn] = useState<number | null>(null);
  const [pendingOut, setPendingOut] = useState<number | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [skipEnabled, setSkipEnabled] = useState(true);
  const [confirmStartOver, setConfirmStartOver] = useState(false);

  const duration = meta?.duration ?? 0;

  const manualCutCount = useMemo(() => cuts.filter((c) => c.type === 'manual').length, [cuts]);
  const segments = useMemo(() => keptSegments(cuts, duration), [cuts, duration]);
  const afterDuration = useMemo(() => keptDuration(segments), [segments]);

  // Merged active cut ranges — the single source of truth for timeline shading,
  // prev/next-cut navigation, and skip-preview playback.
  const activeMerged = useMemo(() => coalesceCuts(cuts.filter((c) => c.active)), [cuts]);

  const seekTo = (t: number) => {
    const video = videoRef.current;
    const clamped = clamp(t, 0, duration || 0);
    // A deliberate seek always cancels any in-flight range/context preview.
    rangeEndRef.current = null;
    suppressSkipRef.current = false;
    if (video) video.currentTime = clamped;
    setCurrentTime(clamped);
  };

  const playRangeThenPause = (start: number, end: number, suppressSkip: boolean) => {
    const video = videoRef.current;
    if (!video) return;
    suppressSkipRef.current = suppressSkip;
    rangeEndRef.current = end;
    video.currentTime = clamp(start, 0, duration || 0);
    void video.play();
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
      rangeEndRef.current = null;
      suppressSkipRef.current = false;
    }
  };

  // Skip-preview + range-end-pause loop. Runs continuously while mounted; cheap
  // no-op whenever the video is paused/seeking or there is nothing to enforce.
  // Combined with the <video> "timeupdate" handler (which only updates the
  // displayed time), this is the "timeupdate + requestAnimationFrame guard"
  // behaviour called for in the brief.
  useEffect(() => {
    let rafId: number;
    const tick = () => {
      const video = videoRef.current;
      if (video && !video.paused && !video.seeking) {
        if (rangeEndRef.current != null) {
          if (video.currentTime >= rangeEndRef.current - 0.02) {
            video.pause();
            rangeEndRef.current = null;
            suppressSkipRef.current = false;
          }
        } else if (skipEnabled && !suppressSkipRef.current) {
          const t = video.currentTime;
          for (const r of activeMerged) {
            if (t >= r.start && t < r.end - 0.01) {
              video.currentTime = r.end;
              break;
            }
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [activeMerged, skipEnabled]);

  const onPrevCut = () => {
    const prior = activeMerged.filter((r) => r.start < currentTime - 0.05);
    const target = prior[prior.length - 1];
    seekTo(target ? Math.max(0, target.start - 0.05) : 0);
  };

  const onNextCut = () => {
    const upcoming = activeMerged.filter((r) => r.start > currentTime + 0.05);
    const target = upcoming[0];
    if (target) seekTo(Math.max(0, target.start - 0.05));
  };

  // --- Manual IN/OUT editor handlers ---

  const onSetIn = () => {
    setManualError(null);
    setPendingIn(currentTime);
  };
  const onSetOut = () => {
    setManualError(null);
    setPendingOut(currentTime);
  };
  const onClearMarkers = () => {
    setPendingIn(null);
    setPendingOut(null);
    setManualError(null);
  };
  const onJumpIn = () => {
    if (pendingIn != null) seekTo(pendingIn);
  };
  const onJumpOut = () => {
    if (pendingOut != null) seekTo(pendingOut);
  };

  const onPlaySelected = () => {
    if (pendingIn == null || pendingOut == null) {
      setManualError('Set both an IN and an OUT point before previewing a range.');
      return;
    }
    const start = Math.min(pendingIn, pendingOut);
    const end = Math.max(pendingIn, pendingOut);
    if (end <= start) {
      setManualError('IN and OUT are the same point — there is nothing to preview.');
      return;
    }
    playRangeThenPause(start, end, true);
  };

  const onRemoveRange = () => {
    if (pendingIn == null || pendingOut == null) {
      setManualError('Set both an IN and an OUT point before removing a range.');
      return;
    }
    // Reject invalid ranges with a clear explanation instead of silently
    // swapping the markers (SPEC "Reject invalid or zero-length ranges").
    if (pendingOut < pendingIn) {
      setManualError('OUT must be after IN — the markers were not removed.');
      return;
    }
    if (pendingOut - pendingIn <= 0) {
      setManualError('The IN and OUT points must not be equal — there is nothing to remove.');
      return;
    }
    addManualCut(pendingIn, pendingOut, 'Manual cut');
    setPendingIn(null);
    setPendingOut(null);
    setManualError(null);
  };

  const onUndoManual = () => undoLastManual();

  const onPlayContext = (cut: Cut) => {
    const start = Math.max(0, cut.start - CONTEXT_PAD_S);
    const end = Math.min(duration || cut.end + CONTEXT_PAD_S, cut.end + CONTEXT_PAD_S);
    playRangeThenPause(start, end, true);
  };

  const onSelectAll = () => setAllActive(true);
  const onRestoreAll = () => setAllActive(false);
  const onOpenStudio = () => setAppState('studio');

  const onStartOver = () => {
    if (!confirmStartOver) {
      setConfirmStartOver(true);
      return;
    }
    resetProject();
  };

  if (!videoUrl || !meta) {
    return (
      <PlaceholderCard
        icon={Wand2}
        title="Nothing to review yet"
        description="Upload and analyse a video first — review edits will appear here once analysis finishes."
      />
    );
  }

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 py-8 lg:grid-cols-[1.5fr_1fr] lg:items-start">
      {/* LEFT: main preview, timeline, manual editor */}
      <section className="flex min-h-0 flex-col">
        <div className="overflow-hidden rounded-2xl border border-border bg-ink shadow-sm">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            src={videoUrl}
            className="aspect-video w-full bg-ink"
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="tabular-nums font-semibold text-ink">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-primarySoft px-3 py-1 text-xs font-semibold text-primary">
            <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {formatTime(duration)} &rarr; {formatTime(afterDuration)}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onPrevCut}
            aria-label="Previous cut"
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-ink hover:bg-surface"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Prev cut
          </button>
          <button
            type="button"
            onClick={togglePlay}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4" aria-hidden="true" />
            )}
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            onClick={onNextCut}
            aria-label="Next cut"
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-ink hover:bg-surface"
          >
            Next cut <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>

          <label className="ml-auto inline-flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={skipEnabled}
              onChange={(e) => setSkipEnabled(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-primary"
            />
            Skip removed sections while playing
          </label>
        </div>

        <Timeline
          duration={duration}
          currentTime={currentTime}
          activeRanges={activeMerged}
          pendingIn={pendingIn}
          pendingOut={pendingOut}
          onSeek={seekTo}
        />

        <button
          type="button"
          onClick={() => setShowManualEditor((v) => !v)}
          aria-expanded={showManualEditor}
          className="mt-4 inline-flex items-center gap-2 self-start rounded-lg border border-border px-4 py-2 text-sm font-semibold text-ink hover:bg-surface"
        >
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          Edit clips manually
        </button>

        {showManualEditor && (
          <ManualEditor
            pendingIn={pendingIn}
            pendingOut={pendingOut}
            manualCutCount={manualCutCount}
            error={manualError}
            onSetIn={onSetIn}
            onSetOut={onSetOut}
            onClear={onClearMarkers}
            onJumpIn={onJumpIn}
            onJumpOut={onJumpOut}
            onPlaySelected={onPlaySelected}
            onRemove={onRemoveRange}
            onUndo={onUndoManual}
          />
        )}
      </section>

      {/* RIGHT: suggested edits + CTA */}
      <section className="flex min-h-0 flex-col gap-4 lg:sticky lg:top-6 lg:max-h-[85vh]">
        <div className="flex min-h-0 flex-1 flex-col">
          <EditList
            cuts={cuts}
            onToggle={toggleCut}
            onPlayContext={onPlayContext}
            onSelectAll={onSelectAll}
            onRestoreAll={onRestoreAll}
          />
        </div>

        <div className="shrink-0 rounded-xl border border-border bg-surface p-4 shadow-sm">
          <button
            type="button"
            onClick={onOpenStudio}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white hover:bg-primary/90"
          >
            Open Export Studio
          </button>

          <div className="mt-2 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={onStartOver}
              className="text-xs font-medium text-muted underline-offset-2 hover:text-danger hover:underline"
            >
              {confirmStartOver ? 'Click again to confirm — this discards all edits' : 'Back to upload / start over'}
            </button>
            {confirmStartOver && (
              <button
                type="button"
                onClick={() => setConfirmStartOver(false)}
                className="text-xs font-medium text-muted hover:text-ink"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
