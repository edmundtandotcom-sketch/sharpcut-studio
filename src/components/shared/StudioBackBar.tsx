import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { bridgeAvailable } from '../../lib/localBridge';
import { useAppStore } from '../../store/useAppStore';

/**
 * "← Background studio" — the way back to step 1 of the unified local Studio.
 *
 * WHY THIS AND NOT AN INJECTED SNIPPET: the other option was for Backdrop's
 * FastAPI server to splice a link into the copy of `index.html` that
 * `tools/sync-sharpcut.ps1` mirrors. That would put a piece of SharpCut's UI
 * in a PowerShell script (or in a Python string), styled by hand, invisible to
 * this repo's type checker, and silently broken by any future change to how
 * Vite emits the document. Keeping it here means it is ordinary reviewed
 * React, it uses the same design tokens as everything else, and the sync
 * script stays a pure file copy.
 *
 * IT CANNOT APPEAR ON THE DEPLOYED SITE. `bridgeAvailable()` requires both an
 * http:// loopback origin AND a `/api/health` response that identifies itself
 * as Backdrop, so the Cloudflare build (https, no such endpoint) and a bare
 * `vite dev` (no such endpoint) both resolve it false and render nothing.
 */
export function StudioBackBar() {
  const [show, setShow] = useState(false);
  const exporting = useAppStore((s) => s.exportJob.running);

  useEffect(() => {
    let live = true;
    void bridgeAvailable().then((ok) => {
      if (live) setShow(ok);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!show) return null;

  return (
    <div className="border-b border-border bg-primarySoft/60">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-1.5 sm:px-6">
        <a
          href="/"
          onClick={(e) => {
            // Leaving is a full navigation: the ffmpeg worker and everything
            // it has produced go with the page.
            if (
              exporting &&
              !window.confirm(
                'An export is still running.\n\nGoing back to the background studio will ' +
                  'cancel it and you will lose the progress so far. Continue?',
              )
            ) {
              e.preventDefault();
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold text-primary hover:bg-primarySoft hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Background studio
        </a>
        <span className="text-xs text-muted">
          Step 2 of 2 &middot; <span className="font-medium text-ink">Edit &amp; Export</span>
        </span>
      </div>
    </div>
  );
}
