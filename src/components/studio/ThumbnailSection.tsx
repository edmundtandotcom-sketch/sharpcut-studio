import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Upload, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { formatTime } from '../../lib/time';
import { drawThumbnailFrame } from '../../lib/thumbnailRender';
import { Section } from './settingsPrimitives';
import { formatAspect, formatCrops, useDebouncedCallback } from './studioUtils';
import { ThumbnailPreviewCard } from './ThumbnailPreviewCard';

const SEEK_THROTTLE_MS = 150;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // sane upload cap — unrelated to the 2MB snapshot-persistence cap

/**
 * Export Studio section 9 — Thumbnail. A filmstrip-style scrubber over the
 * FULL original source video (independent of kept/cut segments — the user may
 * deliberately pick a frame from inside a removed cut) plus an upload option.
 * The committed choice only stores a pointer (source timestamp, or an image
 * dataURL) — actual pixels are rendered on demand at export geometry by
 * ThumbnailPreviewCard, so switching format/crop later re-renders it correctly.
 */
export function ThumbnailSection() {
  const videoUrl = useAppStore((s) => s.project.videoUrl);
  const meta = useAppStore((s) => s.project.meta);
  const format = useAppStore((s) => s.studio.format);
  const crop = useAppStore((s) => s.studio.crop);
  const thumbnail = useAppStore((s) => s.studio.thumbnail);
  const setThumbnail = useAppStore((s) => s.studio.setThumbnail);

  const duration = meta?.duration ?? 0;
  const aspect = formatAspect(format, meta);

  const scrubVideoRef = useRef<HTMLVideoElement>(null);
  const scrubCanvasRef = useRef<HTMLCanvasElement>(null);
  const cardCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [sliderTime, setSliderTime] = useState(0); // immediate, drives the visible slider
  const [seekTarget, setSeekTarget] = useState(0); // throttled, drives the actual video seek
  const [frameReady, setFrameReady] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const requestSeek = useDebouncedCallback((t: number) => setSeekTarget(t), SEEK_THROTTLE_MS);

  // Seek the hidden scrub video to the throttled target and draw the live
  // scrub preview at export geometry once the frame lands.
  useEffect(() => {
    const v = scrubVideoRef.current;
    if (!v || !meta) return;
    let cancelled = false;

    const draw = () => {
      if (cancelled) return;
      setFrameReady(true);
      const canvas = scrubCanvasRef.current;
      if (!canvas) return;
      const cropEnabled = formatCrops(format, meta);
      drawThumbnailFrame(canvas, v, v.videoWidth || meta.width, v.videoHeight || meta.height, format, crop, cropEnabled);
    };
    const seekAndDraw = () => {
      if (cancelled) return;
      const onSeeked = () => draw();
      v.addEventListener('seeked', onSeeked, { once: true });
      try {
        v.currentTime = Math.min(Math.max(0, seekTarget), Math.max(0, duration - 0.02));
      } catch {
        /* ignore — transient seek failure just leaves the last drawn frame */
      }
    };
    if (v.readyState >= 1) seekAndDraw();
    else v.addEventListener('loadedmetadata', seekAndDraw, { once: true });

    return () => {
      cancelled = true;
    };
  }, [seekTarget, format, crop, meta, duration]);

  const onSlide = (t: number) => {
    setSliderTime(t);
    requestSeek(t);
  };

  const useThisFrame = () => {
    setThumbnail({ kind: 'frame', timeSource: seekTarget });
  };

  const onUploadFile = (file: File | undefined) => {
    setUploadError(null);
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) {
      setUploadError('Please choose a JPG or PNG image.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError('That image is too large (max 15MB).');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setUploadError("Couldn't read that image.");
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl === 'string') setThumbnail({ kind: 'upload', dataUrl });
    };
    reader.readAsDataURL(file);
  };

  if (!videoUrl || !meta) return null;

  return (
    <Section
      step={9}
      title="Thumbnail"
      icon={ImageIcon}
      subtitle="Any frame from the original video — including inside removed cuts."
    >
      <div className="space-y-4">
        {/* Hidden — decode/seek source for the live scrub preview canvas only. */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={scrubVideoRef}
          src={videoUrl}
          muted
          playsInline
          preload="auto"
          className="hidden"
          aria-hidden="true"
        />

        <div className="overflow-hidden rounded-lg border border-border bg-black">
          <canvas
            ref={scrubCanvasRef}
            className="block w-full"
            style={{ aspectRatio: String(aspect) }}
            aria-label="Scrubbed source frame preview"
          />
        </div>

        <div>
          <label className="sr-only" htmlFor="thumbnail-scrubber">
            Thumbnail source frame position
          </label>
          <input
            id="thumbnail-scrubber"
            type="range"
            min={0}
            max={Math.max(0.01, duration)}
            step={0.05}
            value={Math.min(sliderTime, duration)}
            onChange={(e) => onSlide(Number(e.target.value))}
            aria-label="Thumbnail source frame position"
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary"
          />
          <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted">
            <span>{formatTime(sliderTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={useThisFrame}
            disabled={!frameReady}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Use this frame
          </button>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-ink hover:bg-bg">
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            Upload image
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              aria-label="Upload thumbnail image"
              onChange={(e) => {
                onUploadFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {uploadError && <p className="text-xs text-danger">{uploadError}</p>}

        {thumbnail && (
          <div>
            <p className="mb-2 text-xs font-semibold text-ink">Chosen thumbnail</p>
            <div className="relative max-w-xs">
              <ThumbnailPreviewCard
                videoUrl={videoUrl}
                meta={meta}
                format={format}
                crop={crop}
                thumbnail={thumbnail}
                canvasRef={cardCanvasRef}
              />
              <button
                type="button"
                onClick={() => setThumbnail(null)}
                aria-label="Remove chosen thumbnail"
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-ink/70 text-white hover:bg-ink"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
