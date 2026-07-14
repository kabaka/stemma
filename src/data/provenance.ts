/**
 * Presentation metadata for condition-record {@link Provenance}. Kept in the data layer
 * (like `severity.ts` / `categories.ts`) so a UI restyle never touches the pure engine.
 *
 * Clinicians weight family history by its source — a records-confirmed diagnosis carries
 * more evidentiary weight than a self-reported recollection. Stemma surfaces that
 * provenance QUALITATIVELY (a label + a non-colour glyph); it never converts it into a
 * numeric weight or risk multiplier (CLAUDE.md guardrail #1).
 */
import type { Provenance } from '@/domain/types';

export interface ProvMeta {
  /** Full label, e.g. for the condition-editor menu. */
  label: string;
  /** Terse label for dense inline display. */
  short: string;
  /**
   * Accessible marker glyph — meaning is never carried by colour alone, so this glyph
   * (plus an accompanying text label / title) is the primary channel.
   */
  mark: string;
  /** Qualitative weighting note (never a computed multiplier). */
  weight: string;
}

export const PROV_META: Record<Provenance, ProvMeta> = {
  record: {
    label: 'records-confirmed',
    short: 'records',
    mark: '✓',
    weight: 'Confirmed by a medical record — higher evidentiary weight.',
  },
  death: {
    label: 'death certificate',
    short: 'death cert.',
    mark: '†',
    weight: 'Confirmed by a death certificate.',
  },
  self: {
    label: 'self-reported',
    short: 'self-reported',
    mark: '○',
    weight: 'Self-reported or family recollection — lower evidentiary weight.',
  },
};

/** Provenance ids ordered strongest-evidence first (for menus and summaries). */
export const PROVENANCE_ORDER: readonly Provenance[] = ['record', 'death', 'self'];

/** Full labels keyed by provenance (used by the condition editor). */
export const PROV_LABEL: Record<Provenance, string> = {
  self: PROV_META.self.label,
  record: PROV_META.record.label,
  death: PROV_META.death.label,
};

/**
 * Summarise a set of provenances as a "sourcing" line, e.g. `"2 records-confirmed · 1
 * self-reported"`, ordered strongest-evidence first. Returns `''` for an empty set.
 */
export function provenanceSummary(provs: Provenance[]): string {
  const counts = new Map<Provenance, number>();
  for (const p of provs) counts.set(p, (counts.get(p) ?? 0) + 1);
  return PROVENANCE_ORDER.filter((p) => counts.has(p))
    .map((p) => `${counts.get(p)} ${PROV_META[p].label}`)
    .join(' · ');
}
