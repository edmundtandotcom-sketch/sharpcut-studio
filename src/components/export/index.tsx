import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, FileVideo, ImageDown, Loader2, Package, Plus } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { ThumbnailPreviewCard } from '../studio/ThumbnailPreviewCard';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

/** SPEC State 5 — Export complete: file list, per-file + ZIP downloads. */
export function ExportScreen() {
  const results = useAppStore((s) => s.exportJob.resultUrls);
  const setAppState = useAppStore((s) => s.setAppState);
  const resetProject = useAppStore((s) => s.resetProject);

  // Thumbnail delivery (feature spec point 3) — reads the SAME chosen
  // thumbnail + current format/crop as the studio screen, rendered through the
  // same ThumbnailPreviewCard so the downloaded JPEG matches what was shown
  // there. Pure-frontend canvas work; no ffmpeg involvement.
  const videoUrl = useAppStore((s) => s.project.videoUrl);
  const meta = useAppStore((s) => s.project.meta);
  const format = useAppStore((s) => s.studio.format);
  const crop = useAppStore((s) => s.studio.crop);
  const thumbnail = useAppStore((s) => s.studio.thumbnail);
  const thumbCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [zipping, setZipping] = useState(false);
  const [zipPct, setZipPct] = useState(0);
  const [zipError, setZipError] = useState<string | null>(null);
  const [thumbError, setThumbError] = useState<string | null>(null);

  // Read each blob's size for display (object URLs don't carry it).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, number> = {};
      for (const r of results) {
        try {
          const blob = await (await fetch(r.url)).blob();
          next[r.url] = blob.size;
        } catch {
          next[r.url] = 0;
        }
      }
      if (!cancelled) setSizes(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [results]);

  // Shared base name for every download this screen offers (ZIP + thumbnail).
  const exportBaseName = useMemo(() => {
    const first = results[0]?.name ?? 'sharpcut';
    const base = first.replace(/-(clip-\d+|sharpcut)\.mp4$/i, '').replace(/\.mp4$/i, '');
    return base || 'sharpcut';
  }, [results]);
  const zipName = useMemo(() => `${exportBaseName}-clips.zip`, [exportBaseName]);

  if (results.length === 0) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6 py-16">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-10 text-center shadow-sm">
          <h2 className="text-xl font-extrabold text-ink">No export available</h2>
          <p className="mt-2 text-sm text-muted">Head back to the studio to export your video.</p>
          <button
            type="button"
            onClick={() => setAppState('studio')}
            className="mt-6 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-primary/90"
          >
            Back to studio
          </button>
        </div>
      </div>
    );
  }

  const downloadZip = async () => {
    setZipping(true);
    setZipPct(0);
    setZipError(null);
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const r of results) {
        const blob = await (await fetch(r.url)).blob();
        zip.file(r.name, blob);
      }
      const out = await zip.generateAsync({ type: 'blob' }, (meta) => setZipPct(meta.percent));
      const url = URL.createObjectURL(out);
      const a = document.createElement('a');
      a.href = url;
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke shortly after the download starts.
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      setZipError(err instanceof Error ? err.message : 'Could not build the ZIP.');
    } finally {
      setZipping(false);
    }
  };

  const startNew = () => {
    if (window.confirm('Start a new project? This clears the current video and all edits from this tab.')) {
      resetProject();
    }
  };

  const downloadThumbnail = () => {
    setThumbError(null);
    const canvas = thumbCanvasRef.current;
    if (!canvas) {
      setThumbError("Thumbnail isn't ready yet — try again in a moment.");
      return;
    }
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setThumbError('Could not build the thumbnail image.');
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${exportBaseName}-thumbnail.jpg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      },
      'image/jpeg',
      0.92,
    );
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <div className="rounded-2xl border border-border bg-surface p-7 shadow-sm sm:p-9">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-success/10 text-success">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-center text-2xl font-black tracking-tight text-ink">
          Export complete
        </h1>
        <p className="mt-2 text-center text-sm text-muted">
          {results.length === 1
            ? 'Your sharpened video is ready to download.'
            : `${results.length} clips are ready to download.`}
        </p>

        <ul className="mt-7 space-y-2.5">
          {results.map((r) => (
            <li
              key={r.url}
              className="flex items-center gap-3 rounded-xl border border-border bg-bg/60 p-3"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primarySoft text-primary">
                <FileVideo className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{r.name}</p>
                <p className="text-xs tabular-nums text-muted">{formatBytes(sizes[r.url])}</p>
              </div>
              <a
                href={r.url}
                download={r.name}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary/90"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Download
              </a>
            </li>
          ))}
        </ul>

        {results.length > 1 && (
          <button
            type="button"
            onClick={downloadZip}
            disabled={zipping}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primarySoft px-4 py-2.5 text-sm font-bold text-primary hover:bg-primary/10 disabled:opacity-60"
          >
            {zipping ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Zipping… {Math.round(zipPct)}%
              </>
            ) : (
              <>
                <Package className="h-4 w-4" aria-hidden="true" />
                Download all (ZIP)
              </>
            )}
          </button>
        )}
        {zipError && <p className="mt-2 text-center text-xs text-danger">{zipError}</p>}

        {thumbnail && (
          <div className="mt-7 border-t border-border pt-6">
            <p className="mb-3 text-sm font-bold text-ink">Thumbnail</p>
            <div className="mx-auto max-w-[220px]">
              <ThumbnailPreviewCard
                videoUrl={videoUrl}
                meta={meta}
                format={format}
                crop={crop}
                thumbnail={thumbnail}
                canvasRef={thumbCanvasRef}
              />
            </div>
            <button
              type="button"
              onClick={downloadThumbnail}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primarySoft px-4 py-2.5 text-sm font-bold text-primary hover:bg-primary/10"
            >
              <ImageDown className="h-4 w-4" aria-hidden="true" />
              Download thumbnail (JPG)
            </button>
            {thumbError && <p className="mt-2 text-center text-xs text-danger">{thumbError}</p>}
          </div>
        )}

        <div className="mt-7 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row">
          <button
            type="button"
            onClick={() => setAppState('studio')}
            className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-ink hover:bg-bg"
          >
            Back to studio
          </button>
          <button
            type="button"
            onClick={startNew}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-bold text-white hover:bg-ink/90"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Start new project
          </button>
        </div>
      </div>
    </div>
  );
}
