/**
 * Clinical category display metadata. Two palettes are provided: the default and an
 * Okabe-Ito-derived colorblind-safe set. Meaning is never encoded in colour alone
 * (roadmap §6) — colour always accompanies a text label.
 */
import type { CategoryKey } from '@/domain/types';

export type Palette = 'default' | 'colorblind';

interface CategoryMeta {
  label: string;
  /** Default palette colour. */
  color: string;
  /** Colorblind-safe colour. */
  colorblind: string;
}

export const CATEGORIES: Record<CategoryKey, CategoryMeta> = {
  card: { label: 'Cardiovascular', color: '#ff5d5d', colorblind: '#D55E00' },
  canc: { label: 'Cancer', color: '#ff79c6', colorblind: '#CC79A7' },
  endo: { label: 'Metabolic & endocrine', color: '#ffb043', colorblind: '#E69F00' },
  neuro: { label: 'Neurological', color: '#7aa2ff', colorblind: '#56B4E9' },
  ment: { label: 'Mental health', color: '#34e2cf', colorblind: '#009E73' },
  auto: { label: 'Autoimmune', color: '#9be15d', colorblind: '#94C973' },
  resp: { label: 'Respiratory', color: '#6fa8ff', colorblind: '#4EA3D9' },
  gi: { label: 'Gastrointestinal', color: '#b892ff', colorblind: '#9370DB' },
  renal: { label: 'Renal & urinary', color: '#f0a35e', colorblind: '#E8843A' },
  musc: { label: 'Musculoskeletal', color: '#d4b483', colorblind: '#C9A26B' },
  blood: { label: 'Blood & genetic', color: '#ff6f91', colorblind: '#C0407A' },
  sens: { label: 'Sensory & skin', color: '#6fe0a0', colorblind: '#33B0A6' },
  repro: { label: 'Reproductive', color: '#ffd24a', colorblind: '#F0E442' },
  other: { label: 'Other / uncategorised', color: '#8b94a3', colorblind: '#9aa3b2' },
};

export const CATEGORY_LABELS: Record<CategoryKey, string> = Object.fromEntries(
  (Object.keys(CATEGORIES) as CategoryKey[]).map((k) => [k, CATEGORIES[k].label]),
) as Record<CategoryKey, string>;

const NEUTRAL = '#8b94a3';

/** Colour for a category under the given palette. */
export function categoryColor(cat: CategoryKey | null | undefined, palette: Palette): string {
  if (!cat || !CATEGORIES[cat]) return NEUTRAL;
  return palette === 'colorblind' ? CATEGORIES[cat].colorblind : CATEGORIES[cat].color;
}
