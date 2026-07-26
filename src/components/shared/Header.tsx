import { ShieldCheck, Scissors } from 'lucide-react';

/** SPEC State 1 header: wordmark + "processed locally" trust badge. */
export function Header() {
  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
            <Scissors className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <span className="text-lg font-extrabold tracking-tight text-ink">
            SharpCut <span className="font-medium text-muted">Studio</span>
          </span>
        </div>

        <div className="flex items-center gap-2 rounded-full border border-border bg-primarySoft px-3 py-1.5 text-xs font-medium text-ink">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
          <span>Processed locally &middot; Your video stays on this device</span>
        </div>
      </div>
    </header>
  );
}
