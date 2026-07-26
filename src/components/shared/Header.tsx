import { Save, ShieldCheck, Scissors } from 'lucide-react';
import { buildProjectSnapshot, useAppStore } from '../../store/useAppStore';
import { downloadProjectSnapshot } from '../../lib/persist';

/** SPEC State 1 header: wordmark + "processed locally" trust badge, plus (P6)
 * a "Save project file" control once a project is loaded — kept here so it's
 * reachable from every screen (review, studio, export). */
export function Header() {
  const hasProject = useAppStore((s) => Boolean(s.project.meta) && s.appState !== 'upload');
  const projectName = useAppStore((s) => s.project.meta?.name);

  const onSaveProject = () => {
    const snapshot = buildProjectSnapshot(useAppStore.getState());
    if (snapshot) downloadProjectSnapshot(snapshot, projectName);
  };

  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
            <Scissors className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <span className="truncate text-lg font-extrabold tracking-tight text-ink">
            SharpCut <span className="font-medium text-muted">Studio</span>
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          {hasProject && (
            <button
              type="button"
              onClick={onSaveProject}
              title="Download your edits, captions, and studio settings as a project file"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:border-primary/50 hover:text-primary"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Save project</span>
            </button>
          )}

          {/* Single trust badge — the label collapses to icon-only on small
           * screens via CSS (sr-only), so there is exactly one element (and one
           * accessibility node), never two competing copies. */}
          <div className="flex min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-border bg-primarySoft px-2.5 py-1.5 text-xs font-medium text-primary md:gap-2 md:px-3 md:text-ink">
            <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="sr-only truncate md:not-sr-only">
              Processed locally &middot; Your video stays on this device
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
