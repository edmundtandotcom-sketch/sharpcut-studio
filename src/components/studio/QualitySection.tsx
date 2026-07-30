import { Sparkles } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { Quality } from '../../types';
import { Section, SelectCard } from './settingsPrimitives';

const OPTIONS: { id: Quality; label: string; blurb: string }[] = [
  { id: 'standard', label: 'Standard', blurb: 'Great for Reels and YouTube. Fast. Recommended.' },
  { id: 'high', label: 'High', blurb: 'Extra crispness, slower export.' },
  { id: 'source', label: 'Source-conscious', blurb: 'Preserve source detail. Largest files.' },
];

export function QualitySection() {
  const quality = useAppStore((s) => s.studio.quality);
  const setQuality = useAppStore((s) => s.studio.setQuality);

  return (
    <Section step={8} title="Quality" icon={Sparkles}>
      <div className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map((o) => (
          <SelectCard key={o.id} selected={quality === o.id} onClick={() => setQuality(o.id)} label={o.label}>
            <span className="text-sm font-semibold text-ink">{o.label}</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted">{o.blurb}</span>
          </SelectCard>
        ))}
      </div>
    </Section>
  );
}
