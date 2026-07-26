import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export function Section({
  title,
  step,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string;
  step?: number;
  subtitle?: string;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-start gap-3">
        {Icon && (
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primarySoft text-primary">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink">
            {step != null && <span className="text-muted">{step}. </span>}
            {title}
          </h3>
          {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-muted">{subtitle}</p>}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Selectable card with aria-pressed, selected ring, checkmark + label. */
export function SelectCard({
  selected,
  onClick,
  className = '',
  children,
  label,
  showBadge = true,
}: {
  selected: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
  label: string;
  showBadge?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      onClick={onClick}
      className={[
        'relative rounded-xl border p-3 text-left transition-colors',
        selected
          ? 'border-primary bg-primarySoft ring-1 ring-primary'
          : 'border-border bg-surface hover:border-primary/50',
        className,
      ].join(' ')}
    >
      {selected && showBadge && (
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-white">
          <Check className="h-3 w-3" aria-hidden="true" />
          Selected
        </span>
      )}
      {children}
    </button>
  );
}

/** Small pressable pill (case buttons, speed presets). */
export function Pill({
  selected,
  onClick,
  children,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      onClick={onClick}
      className={[
        'inline-flex items-center justify-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
        selected
          ? 'border-primary bg-primary text-white'
          : 'border-border bg-surface text-ink hover:border-primary/50',
      ].join(' ')}
    >
      {selected && <Check className="h-3 w-3" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function LabeledRange({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
  ariaLabel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
  ariaLabel?: string;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-xs font-semibold text-ink">
        <span>{label}</span>
        <span className="tabular-nums text-muted">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel ?? label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary"
      />
    </label>
  );
}
