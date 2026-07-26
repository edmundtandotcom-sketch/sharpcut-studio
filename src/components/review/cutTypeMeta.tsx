import { MessageSquareOff, Repeat2, Scissors, VolumeX, type LucideIcon } from 'lucide-react';
import type { CutType } from '../../types';

export interface CutTypeMeta {
  label: string;
  icon: LucideIcon;
  badgeClass: string; // design-token badge classes
}

/** Color-coded, icon-tagged metadata for each Cut type — used by cards and filter tabs. */
export const CUT_TYPE_META: Record<CutType, CutTypeMeta> = {
  filler: { label: 'Filler', icon: MessageSquareOff, badgeClass: 'bg-primarySoft text-primary' },
  silence: { label: 'Silence', icon: VolumeX, badgeClass: 'bg-border/70 text-muted' },
  repeat: { label: 'Repeat', icon: Repeat2, badgeClass: 'bg-highlight/40 text-ink' },
  manual: { label: 'Manual', icon: Scissors, badgeClass: 'bg-danger/10 text-danger' },
};

export const FILTER_TABS: { key: 'all' | CutType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'filler', label: 'Filler' },
  { key: 'silence', label: 'Silence' },
  { key: 'repeat', label: 'Repeats' },
  { key: 'manual', label: 'Manual' },
];
