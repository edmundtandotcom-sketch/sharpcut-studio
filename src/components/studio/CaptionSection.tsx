import { Captions, RotateCcw } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { CaptionCase, CaptionFontId, CaptionPresetId, CaptionStyle } from '../../types';
import {
  CAPTION_FONTS,
  CAPTION_FONT_ORDER,
  CAPTION_PRESETS,
  CAPTION_PRESET_ORDER,
} from '../../lib/captionLayout';
import { Pill, Section, SelectCard } from './settingsPrimitives';
import { CaptionSample } from './CaptionSample';

const CASES: { id: CaptionCase; label: string }[] = [
  { id: 'upper', label: 'ALL CAPS' },
  { id: 'lower', label: 'lowercase' },
  { id: 'title', label: 'Title Case' },
  { id: 'original', label: 'Original' },
];

const POSITIONS: { id: CaptionStyle['position']; label: string }[] = [
  { id: 'top', label: 'Safe Top' },
  { id: 'center', label: 'Centre' },
  { id: 'bottom', label: 'Safe Bottom' },
];

function presetSampleStyle(id: CaptionPresetId): CaptionStyle {
  const p = CAPTION_PRESETS[id];
  return {
    preset: id,
    font: p.defaultFont,
    sizePct: 115,
    case: 'original',
    position: 'bottom',
    customYPct: 85,
    colors: { ...p.defaultColors },
  };
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  // A color input needs a hex; rgba() defaults fall back to a neutral swatch.
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : '#000000';
  return (
    <label className="flex items-center justify-between gap-2 text-xs font-medium text-ink">
      <span>{label}</span>
      <input
        type="color"
        value={hex}
        aria-label={`${label} colour`}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-10 cursor-pointer rounded border border-border bg-surface"
      />
    </label>
  );
}

export function CaptionSection() {
  const caption = useAppStore((s) => s.studio.caption);
  const setCaptionStyle = useAppStore((s) => s.studio.setCaptionStyle);

  const selectPreset = (id: CaptionPresetId) => {
    const p = CAPTION_PRESETS[id];
    // Applying the preset's default font + colours makes each preset immediately
    // distinct in the preview (SPEC: presets must not all look the same).
    setCaptionStyle({ preset: id, font: p.defaultFont, colors: { ...p.defaultColors } });
  };

  const resetColors = () => setCaptionStyle({ colors: { ...CAPTION_PRESETS[caption.preset].defaultColors } });

  return (
    <Section
      step={4}
      title="Caption creative"
      icon={Captions}
      subtitle="Pick a style, then fine-tune case, font, colour, size and position."
    >
      {/* Preset grid */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {CAPTION_PRESET_ORDER.map((id) => (
          <SelectCard
            key={id}
            selected={caption.preset === id}
            onClick={() => selectPreset(id)}
            label={`${CAPTION_PRESETS[id].label} caption preset`}
            className="!p-2"
          >
            <CaptionSample style={presetSampleStyle(id)} text="Your caption" stageHeight={52} />
            <span className="mt-1.5 block text-center text-[11px] font-semibold text-ink">
              {CAPTION_PRESETS[id].label}
            </span>
          </SelectCard>
        ))}
      </div>

      {caption.preset === 'none' ? (
        <p className="mt-4 text-xs text-muted">Captions are off. Pick a style above to enable them.</p>
      ) : (
        <>
          {/* Case — prominent, immediately below presets */}
          <div className="mt-5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Letter case</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {CASES.map((c) => (
                <Pill
                  key={c.id}
                  selected={caption.case === c.id}
                  onClick={() => setCaptionStyle({ case: c.id })}
                  label={`${c.label} case`}
                >
                  {c.label}
                </Pill>
              ))}
            </div>
          </div>

          {/* Font picker */}
          <div className="mt-5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Font</span>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CAPTION_FONT_ORDER.map((fid: CaptionFontId) => {
                const f = CAPTION_FONTS[fid];
                return (
                  <button
                    key={fid}
                    type="button"
                    aria-pressed={caption.font === fid}
                    onClick={() => setCaptionStyle({ font: fid })}
                    className={[
                      'rounded-lg border px-2 py-2 text-center transition-colors',
                      caption.font === fid
                        ? 'border-primary bg-primarySoft ring-1 ring-primary'
                        : 'border-border bg-surface hover:border-primary/50',
                    ].join(' ')}
                  >
                    <span
                      className="block truncate text-sm text-ink"
                      style={{ fontFamily: f.stack, fontWeight: f.weight }}
                    >
                      Aa
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted">{f.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Colours */}
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Colours</span>
              <button
                type="button"
                onClick={resetColors}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                Reset to preset
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
              <ColorRow label="Text" value={caption.colors.text} onChange={(v) => setCaptionStyle({ colors: { ...caption.colors, text: v } })} />
              <ColorRow label="Background" value={caption.colors.background} onChange={(v) => setCaptionStyle({ colors: { ...caption.colors, background: v } })} />
              <ColorRow label="Outline" value={caption.colors.outline} onChange={(v) => setCaptionStyle({ colors: { ...caption.colors, outline: v } })} />
              <ColorRow label="Accent" value={caption.colors.accent} onChange={(v) => setCaptionStyle({ colors: { ...caption.colors, accent: v } })} />
            </div>
          </div>

          {/* Size */}
          <div className="mt-5">
            <label className="block">
              <span className="flex items-center justify-between text-xs font-semibold text-ink">
                <span>Caption size</span>
                <span className="tabular-nums text-muted">{caption.sizePct}%</span>
              </span>
              <input
                type="range"
                min={50}
                max={300}
                step={5}
                value={caption.sizePct}
                aria-label="Caption size percentage"
                onChange={(e) => setCaptionStyle({ sizePct: Number(e.target.value) })}
                className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary"
              />
            </label>
          </div>

          {/* Position */}
          <div className="mt-5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Position</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {POSITIONS.map((p) => (
                <Pill
                  key={p.id}
                  selected={caption.position === p.id}
                  onClick={() => setCaptionStyle({ position: p.id })}
                  label={`${p.label} position`}
                >
                  {p.label}
                </Pill>
              ))}
            </div>
            <label className="mt-3 block">
              <span className="flex items-center justify-between text-xs font-semibold text-ink">
                <span>Manual vertical position</span>
                <span className="tabular-nums text-muted">{Math.round(caption.customYPct)}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={caption.customYPct}
                aria-label="Manual caption vertical position"
                onChange={(e) => setCaptionStyle({ position: 'custom', customYPct: Number(e.target.value) })}
                className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary"
              />
            </label>
            <p className="mt-1 text-[11px] text-muted">Tip: drag the caption on the preview to place it.</p>
          </div>
        </>
      )}
    </Section>
  );
}
