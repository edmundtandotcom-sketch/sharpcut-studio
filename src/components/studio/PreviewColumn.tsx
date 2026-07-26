import { useMemo } from 'react';
import { Info, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type {
  CaptionStyle,
  CropSettings,
  OutputFormat,
  ProjectMeta,
  Segment,
  TransitionPoint,
  ZoomEffect,
} from '../../types';
import { formatTime } from '../../lib/time';
import { sourceToOutput } from '../../lib/cuts';
import type { CaptionCue } from '../../lib/captionTiming';
import { Preview } from './Preview';
import type { PreviewController } from './usePreviewController';

interface Props {
  controller: PreviewController;
  videoUrl: string | null;
  meta: ProjectMeta | null;
  format: OutputFormat;
  crop: CropSettings;
  caption: CaptionStyle;
  cues: CaptionCue[];
  segments: Segment[];
  speed: number;
  zooms: ZoomEffect[];
  transitions: TransitionPoint[];
  setCrop: (crop: CropSettings) => void;
  setCaptionStyle: (partial: Partial<CaptionStyle>) => void;
}

export function PreviewColumn(props: Props) {
  const { controller, segments, speed, zooms, transitions } = props;
  const { outputTime, outputDuration, playing, toggle, seekOutput } = controller;

  const boundaryOutputs = useMemo(
    () => segments.map((s) => sourceToOutput(s.start, segments, speed)),
    [segments, speed],
  );

  const zoomMarks = useMemo(
    () =>
      zooms.map((z) => ({
        id: z.id,
        pct: outputDuration > 0 ? (sourceToOutput(z.atSource, segments, speed) / outputDuration) * 100 : 0,
      })),
    [zooms, segments, speed, outputDuration],
  );

  const transMarks = useMemo(
    () =>
      transitions
        .filter((t) => t.type !== 'none' && segments[t.boundaryIndex])
        .map((t) => ({
          id: t.id,
          pct:
            outputDuration > 0
              ? (sourceToOutput(segments[t.boundaryIndex].end, segments, speed) / outputDuration) * 100
              : 0,
        })),
    [transitions, segments, speed, outputDuration],
  );

  const jump = (dir: -1 | 1) => {
    if (dir === 1) {
      const next = boundaryOutputs.find((t) => t > outputTime + 0.08);
      seekOutput(next ?? outputDuration);
    } else {
      const prev = [...boundaryOutputs].reverse().find((t) => t < outputTime - 0.08);
      seekOutput(prev ?? 0);
    }
  };

  return (
    <div className="space-y-3">
      <Preview {...props} />

      {/* Scrubber + zoom/transition markers */}
      <div>
        <div className="relative">
          <input
            type="range"
            min={0}
            max={Math.max(0.01, outputDuration)}
            step={0.05}
            value={Math.min(outputTime, outputDuration)}
            onChange={(e) => seekOutput(Number(e.target.value))}
            aria-label="Preview position"
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary"
          />
          {/* markers */}
          <div className="pointer-events-none absolute inset-x-0 -bottom-2 h-2">
            {transMarks.map((m) => (
              <span
                key={m.id}
                className="absolute top-0 h-2 w-0.5 -translate-x-1/2 rounded bg-ink/70"
                style={{ left: `${m.pct}%` }}
                title="Transition"
              />
            ))}
            {zoomMarks.map((m) => (
              <span
                key={m.id}
                className="absolute top-0 h-2 w-2 -translate-x-1/2 rounded-full border border-white bg-primary"
                style={{ left: `${m.pct}%` }}
                title="Zoom effect"
              />
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => jump(-1)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-ink hover:bg-bg"
              aria-label="Previous boundary"
            >
              <SkipBack className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={toggle}
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-white hover:bg-primary/90"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause className="h-5 w-5" aria-hidden="true" /> : <Play className="h-5 w-5" aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={() => jump(1)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-ink hover:bg-bg"
              aria-label="Next boundary"
            >
              <SkipForward className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <span className="tabular-nums text-sm font-semibold text-ink">
            {formatTime(outputTime)}{' '}
            <span className="font-normal text-muted">/ {formatTime(outputDuration)}</span>
          </span>
        </div>
      </div>

      {/* Approximation notice (SPEC Preview Accuracy) */}
      <p className="flex items-start gap-2 rounded-lg bg-primarySoft/60 px-3 py-2 text-xs leading-relaxed text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        Preview effects (captions, zoom, transitions, crop) are close approximations. The exported
        MP4 renders them precisely with FFmpeg.
      </p>
    </div>
  );
}
