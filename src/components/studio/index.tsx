import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Wand2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { keptSegments } from '../../lib/cuts';
import { buildCaptionCues } from '../../lib/captionTiming';
import { resetTextMeasureCache } from '../../lib/textMeasure';
import { outputDims } from '../../lib/ffmpegFilters';
import { PreviewColumn } from './PreviewColumn';
import { ModeSection } from './ModeSection';
import { FormatSection } from './FormatSection';
import { SpeedSection } from './SpeedSection';
import { CaptionSection } from './CaptionSection';
import { CaptionEditorSection } from './CaptionEditorSection';
import { TransitionsSection } from './TransitionsSection';
import { ZoomSection } from './ZoomSection';
import { QualitySection } from './QualitySection';
import { ThumbnailSection } from './ThumbnailSection';
import { SummaryBar } from './SummaryBar';
import { usePreviewController, type PreviewActions } from './usePreviewController';

export function StudioScreen() {
  const meta = useAppStore((s) => s.project.meta);
  const videoUrl = useAppStore((s) => s.project.videoUrl);
  const cuts = useAppStore((s) => s.edits.cuts);
  const words = useAppStore((s) => s.analysis.words);
  const captionBlocks = useAppStore((s) => s.analysis.captionBlocks);
  const setAppState = useAppStore((s) => s.setAppState);

  // Studio settings.
  const speed = useAppStore((s) => s.studio.speed);
  const format = useAppStore((s) => s.studio.format);
  const crop = useAppStore((s) => s.studio.crop);
  const caption = useAppStore((s) => s.studio.caption);
  const zooms = useAppStore((s) => s.studio.zooms);
  const transitions = useAppStore((s) => s.studio.transitions);
  const setCrop = useAppStore((s) => s.studio.setCrop);
  const setCaptionStyle = useAppStore((s) => s.studio.setCaptionStyle);

  const duration = meta?.duration ?? 0;
  const segments = useMemo(() => keptSegments(cuts, duration), [cuts, duration]);
  // Caption fitting must use the EXACT aspect the export uses (lib/exportPlan
  // passes dims.w/dims.h from outputDims), or preview and export could group
  // words differently on sources whose dimensions get evened/clamped.
  const captionFrameAspect = useMemo(() => {
    const d = outputDims(format, meta?.width ?? 0, meta?.height ?? 0);
    return d.w / d.h;
  }, [format, meta]);

  // Caption line fitting MEASURES the real text, so a webfont that finishes
  // loading after the first measurement invalidates the cached widths. Drop the
  // cache and force one recompute when the document's font set settles.
  const [fontsTick, setFontsTick] = useState(0);
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    let alive = true;
    const bump = () => {
      if (!alive) return;
      resetTextMeasureCache();
      setFontsTick((t) => t + 1);
    };
    void fonts.ready.then(bump);
    fonts.addEventListener?.('loadingdone', bump);
    return () => {
      alive = false;
      fonts.removeEventListener?.('loadingdone', bump);
    };
  }, []);

  const cues = useMemo(
    () =>
      buildCaptionCues(captionBlocks, segments, speed, {
        sizePct: caption.sizePct,
        frameAspect: captionFrameAspect,
        style: caption,
      }),
    // `caption` covers sizePct/font/case/preset — every input the fitter reads.
    [captionBlocks, segments, speed, caption, captionFrameAspect, fontsTick],
  );

  const controller = usePreviewController(segments, speed);

  // Stable action subset so memoised sections don't re-render on time ticks.
  const actions: PreviewActions = useMemo(
    () => ({
      play: controller.play,
      seekOutput: controller.seekOutput,
      seekSource: controller.seekSource,
      playRange: controller.playRange,
    }),
    [controller.play, controller.seekOutput, controller.seekSource, controller.playRange],
  );

  // Which caption block is under the playhead (source time) — for editor highlight.
  const activeBlockId = useMemo(() => {
    const t = controller.sourceTime;
    const b = captionBlocks.find((blk) => t >= blk.start && t < blk.end);
    return b ? b.id : null;
  }, [controller.sourceTime, captionBlocks]);

  if (!meta || !videoUrl) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center text-sm text-muted">
        No project loaded. Please upload a video first.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primarySoft text-primary">
            <Wand2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-black tracking-tight text-ink">Export Studio</h1>
            <p className="truncate text-xs text-muted">{meta.fileName}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAppState('review')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-ink hover:bg-bg"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to edits
        </button>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:items-start lg:gap-6">
        {/* Sticky preview column */}
        <div className="lg:sticky lg:top-4">
          <PreviewColumn
            controller={controller}
            videoUrl={videoUrl}
            meta={meta}
            format={format}
            crop={crop}
            caption={caption}
            cues={cues}
            segments={segments}
            speed={speed}
            zooms={zooms}
            transitions={transitions}
            setCrop={setCrop}
            setCaptionStyle={setCaptionStyle}
          />
        </div>

        {/* Independently scrolling settings column with a sticky summary bar. */}
        <div className="mt-6 scrollbar-stable lg:mt-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
          <div className="space-y-4 pr-1">
            <ModeSection controller={actions} segments={segments} speed={speed} words={words} />
            <FormatSection meta={meta} />
            <SpeedSection />
            <CaptionSection />
            <CaptionEditorSection
              controller={actions}
              activeBlockId={activeBlockId}
              segments={segments}
            />
            <TransitionsSection controller={actions} segments={segments} speed={speed} />
            <ZoomSection controller={actions} segments={segments} speed={speed} />
            <QualitySection />
            <ThumbnailSection />
          </div>
          <SummaryBar segments={segments} speed={speed} />
        </div>
      </div>
    </div>
  );
}
