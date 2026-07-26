import { Gauge } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { Pill, Section } from './settingsPrimitives';

const PRESETS = [0.75, 0.9, 1, 1.1, 1.25, 1.5];

export function SpeedSection() {
  const speed = useAppStore((s) => s.studio.speed);
  const setSpeed = useAppStore((s) => s.studio.setSpeed);

  return (
    <Section
      step={3}
      title="Speed"
      icon={Gauge}
      subtitle="Applies to all output. Captions, zooms and transitions re-sync automatically."
    >
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Pill key={p} selected={Math.abs(speed - p) < 0.001} onClick={() => setSpeed(p)} label={`${p}x speed`}>
            {p}×
          </Pill>
        ))}
      </div>
      <label className="mt-4 block">
        <span className="flex items-center justify-between text-xs font-semibold text-ink">
          <span>Fine speed</span>
          <span className="tabular-nums text-muted">{speed.toFixed(2)}×</span>
        </span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={speed}
          aria-label="Fine speed control"
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary"
        />
        <span className="mt-1 flex justify-between text-[10px] text-muted">
          <span>0.5×</span>
          <span>2.0×</span>
        </span>
      </label>
    </Section>
  );
}
