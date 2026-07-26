import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  icon: LucideIcon;
  title: string;
  description: string;
  children?: ReactNode;
}

/** Nicely-styled centered placeholder for a phase whose real UI ships later. */
export function PlaceholderCard({ icon: Icon, title, description, children }: Props) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-10 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primarySoft text-primary">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="mt-5 text-2xl font-extrabold text-ink">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
        {children}
      </div>
    </div>
  );
}
