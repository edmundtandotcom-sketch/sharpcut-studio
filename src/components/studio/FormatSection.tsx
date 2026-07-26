import { Crop, RotateCcw } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { OutputFormat, ProjectMeta } from '../../types';
import { Section, SelectCard } from './settingsPrimitives';
import { FORMAT_LABELS, formatCrops } from './studioUtils';
import { useDebouncedCallback } from './studioUtils';

const FORMATS: OutputFormat[] = ['original', 'landscape', 'vertical'];

const RATIO_HINT: Record<OutputFormat, string> = {
  original: 'Keep the source frame',
  landscape: '16:9 widescreen',
  vertical: '9:16 true crop',
};

export function FormatSection({ meta }: { meta: ProjectMeta | null }) {
  const format = useAppStore((s) => s.studio.format);
  const crop = useAppStore((s) => s.studio.crop);
  const setFormat = useAppStore((s) => s.studio.setFormat);
  const setCrop = useAppStore((s) => s.studio.setCrop);

  const setCropDebounced = useDebouncedCallback((x: number, y: number) => setCrop({ xPct: x, yPct: y }), 120);
  const cropEnabled = formatCrops(format, meta);

  return (
    <Section
      step={2}
      title="Format & cropping"
      icon={Crop}
      subtitle="True crop fills the whole frame — never letterboxed or blurred."
    >
      <div className="grid grid-cols-3 gap-3">
        {FORMATS.map((f) => {
          const ratio = f === 'vertical' ? 9 / 16 : f === 'landscape' ? 16 / 9 : 4 / 3;
          return (
            <SelectCard
              key={f}
              selected={format === f}
              onClick={() => setFormat(f)}
              label={FORMAT_LABELS[f]}
              showBadge={false}
              className="flex flex-col items-center"
            >
              <span
                className="mb-2 rounded border border-border bg-bg"
                style={{ width: 34, height: 34 / ratio, maxHeight: 46 }}
                aria-hidden="true"
              />
              <span className="text-center text-xs font-semibold text-ink">{FORMAT_LABELS[f]}</span>
              <span className="mt-0.5 text-center text-[10px] text-muted">{RATIO_HINT[f]}</span>
            </SelectCard>
          );
        })}
      </div>

      {cropEnabled ? (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="flex items-center justify-between text-xs font-semibold text-ink">
              <span>Horizontal position</span>
              <span className="tabular-nums text-muted">{Math.round(crop.xPct)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={crop.xPct}
              aria-label="Horizontal crop position"
              onChange={(e) => setCropDebounced(Number(e.target.value), crop.yPct)}
              className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary"
            />
          </label>
          <label className="block">
            <span className="flex items-center justify-between text-xs font-semibold text-ink">
              <span>Vertical position</span>
              <span className="tabular-nums text-muted">{Math.round(crop.yPct)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={crop.yPct}
              aria-label="Vertical crop position"
              onChange={(e) => setCropDebounced(crop.xPct, Number(e.target.value))}
              className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary"
            />
          </label>
          <button
            type="button"
            onClick={() => setCrop({ xPct: 50, yPct: 50 })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-bg"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Re-centre
          </button>
          <p className="text-[11px] text-muted">Tip: drag directly on the preview to reposition.</p>
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted">
          {format === 'original'
            ? 'Original keeps the source framing — no crop needed.'
            : 'This format matches the source aspect, so no cropping is required.'}
        </p>
      )}
    </Section>
  );
}
