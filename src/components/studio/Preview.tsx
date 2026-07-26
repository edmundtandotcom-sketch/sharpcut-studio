import { useMemo, useRef } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type {
  CaptionStyle,
  CropSettings,
  OutputFormat,
  ProjectMeta,
  Segment,
  TransitionPoint,
  ZoomEffect,
} from '../../types';
import { clamp } from '../../lib/time';
import type { CaptionCue } from '../../lib/captionTiming';
import { CaptionOverlay } from './CaptionOverlay';
import { coverObjectPosition, formatAspect, formatCrops } from './studioUtils';
import { transitionVisualAt, zoomScaleAt } from './previewEffects';
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

type DragState =
  | { mode: 'crop'; startX: number; startY: number; cropX: number; cropY: number; rect: DOMRect }
  | { mode: 'caption'; rect: DOMRect };

export function Preview({
  controller,
  videoUrl,
  meta,
  format,
  crop,
  caption,
  cues,
  segments,
  speed,
  zooms,
  transitions,
  setCrop,
  setCaptionStyle,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const aspect = useMemo(() => formatAspect(format, meta), [format, meta]);
  const cropEnabled = formatCrops(format, meta);
  const { outputTime } = controller;

  const zoomScale = zoomScaleAt(zooms, segments, speed, outputTime);
  const trans = transitionVisualAt(transitions, segments, speed, outputTime);

  const beginCropDrag = (e: ReactPointerEvent) => {
    if (!cropEnabled) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      mode: 'crop',
      startX: e.clientX,
      startY: e.clientY,
      cropX: crop.xPct,
      cropY: crop.yPct,
      rect,
    };
    el.setPointerCapture(e.pointerId);
  };

  const beginCaptionDrag = (e: ReactPointerEvent) => {
    e.stopPropagation();
    const el = containerRef.current;
    if (!el) return;
    dragRef.current = { mode: 'caption', rect: el.getBoundingClientRect() };
    el.setPointerCapture(e.pointerId);
    // Move immediately to the pointer.
    const y = ((e.clientY - dragRef.current.rect.top) / dragRef.current.rect.height) * 100;
    setCaptionStyle({ position: 'custom', customYPct: clamp(y, 4, 96) });
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.mode === 'crop') {
      const dx = ((e.clientX - d.startX) / d.rect.width) * 100;
      const dy = ((e.clientY - d.startY) / d.rect.height) * 100;
      setCrop({ xPct: clamp(d.cropX - dx, 0, 100), yPct: clamp(d.cropY - dy, 0, 100) });
    } else {
      const y = ((e.clientY - d.rect.top) / d.rect.height) * 100;
      setCaptionStyle({ position: 'custom', customYPct: clamp(y, 4, 96) });
    }
  };

  const endDrag = (e: ReactPointerEvent) => {
    if (dragRef.current) {
      containerRef.current?.releasePointerCapture(e.pointerId);
      dragRef.current = null;
    }
  };

  const videoStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: cropEnabled ? coverObjectPosition(crop.xPct, crop.yPct) : 'center',
    transform: `scale(${zoomScale})`,
    transformOrigin: 'center center',
    filter: trans.blurPx > 0 ? `blur(${trans.blurPx}px)` : undefined,
    // Zoom pulses are quick; a short transition keeps preview smooth without lag.
    transition: 'transform 40ms linear',
  };

  return (
    <div
      ref={containerRef}
      className="relative mx-auto w-full max-w-full select-none overflow-hidden rounded-xl bg-black shadow-sm"
      style={{ aspectRatio: String(aspect), maxHeight: '58vh' }}
      onPointerDown={beginCropDrag}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {videoUrl ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          ref={controller.videoRef}
          src={videoUrl}
          style={videoStyle}
          playsInline
          preload="auto"
          className="pointer-events-none"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-white/60">
          No video loaded
        </div>
      )}

      {/* Caption overlay (not affected by zoom transform). */}
      <CaptionOverlay
        cues={cues}
        outputTime={outputTime}
        style={caption}
        onBlockPointerDown={caption.preset !== 'none' ? beginCaptionDrag : undefined}
      />

      {/* Transition overlay. */}
      {trans.opacity > 0.001 && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: trans.color, opacity: trans.opacity }}
          aria-hidden="true"
        />
      )}

      {/* Crop reposition hint. */}
      {cropEnabled && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white/90">
          Drag to reposition crop
        </div>
      )}
    </div>
  );
}
