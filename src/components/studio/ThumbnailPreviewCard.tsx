import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { CropSettings, OutputFormat, ProjectMeta, ThumbnailChoice } from '../../types';
import { drawThumbnailFrame } from '../../lib/thumbnailRender';
import { formatAspect, formatCrops } from './studioUtils';

interface Props {
  videoUrl: string | null;
  meta: ProjectMeta | null;
  format: OutputFormat;
  crop: CropSettings;
  thumbnail: ThumbnailChoice;
  /** The rendered canvas is exposed via this ref so callers (Remove/Download
   * buttons) can read pixels back out with toDataURL/toBlob. */
  canvasRef: RefObject<HTMLCanvasElement>;
  className?: string;
}

/**
 * Renders the CHOSEN thumbnail (frame or upload) onto a canvas at the exact
 * export output geometry — reused by the studio "9. Thumbnail" section's
 * preview card and by the Export complete screen's download card, so both
 * always show/produce the same pixels. Re-draws whenever the thumbnail choice,
 * output format, or crop position changes (feature spec: switching format must
 * re-render the chosen thumbnail at the new geometry, not just stretch it).
 */
export function ThumbnailPreviewCard({ videoUrl, meta, format, crop, thumbnail, canvasRef, className }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const aspect = formatAspect(format, meta);

  useEffect(() => {
    if (thumbnail.kind === 'upload') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      let cancelled = false;
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        // Uploads have no crop-position control of their own — always centred.
        drawThumbnailFrame(canvas, img, img.naturalWidth, img.naturalHeight, format, crop, false);
      };
      img.src = thumbnail.dataUrl;
      return () => {
        cancelled = true;
      };
    }

    // 'frame' — seek a dedicated hidden video element to the stored source
    // timestamp, then draw. A dedicated element (rather than sharing one with
    // any live scrubber) avoids seek races between "preview what I'm dragging
    // to" and "render what I already chose".
    if (!videoUrl || !meta) return;
    const v = videoRef.current;
    if (!v) return;
    let cancelled = false;

    const draw = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const cropEnabled = formatCrops(format, meta);
      drawThumbnailFrame(canvas, v, v.videoWidth || meta.width, v.videoHeight || meta.height, format, crop, cropEnabled);
    };
    const seekAndDraw = () => {
      if (cancelled) return;
      const onSeeked = () => draw();
      v.addEventListener('seeked', onSeeked, { once: true });
      try {
        v.currentTime = Math.min(Math.max(0, thumbnail.timeSource), Math.max(0, meta.duration - 0.02));
      } catch {
        /* ignore — a transient seek failure just leaves the last drawn frame */
      }
    };
    if (v.readyState >= 1) seekAndDraw();
    else v.addEventListener('loadedmetadata', seekAndDraw, { once: true });

    return () => {
      cancelled = true;
    };
    // thumbnail is a plain object recreated on every choice, so it (not just
    // .timeSource) is the right dependency — it changes identity exactly when
    // there's something new to render.
  }, [thumbnail, format, crop, videoUrl, meta, canvasRef]);

  return (
    <div className={className ?? 'overflow-hidden rounded-lg border border-border bg-black'}>
      {thumbnail.kind === 'frame' && videoUrl && (
        // Hidden — only used as a decode/seek source for the canvas draw above.
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video ref={videoRef} src={videoUrl} muted playsInline preload="auto" className="hidden" aria-hidden="true" />
      )}
      <canvas ref={canvasRef} className="block w-full" style={{ aspectRatio: String(aspect) }} aria-label="Chosen thumbnail preview" />
    </div>
  );
}
