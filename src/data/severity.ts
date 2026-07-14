/**
 * Presentation metadata for pattern-flag severities. Kept in the data layer (not the
 * pure engine) so a UI restyle never touches `domain/patterns.ts`. The `Severity` type
 * and the ranking stay in the domain, where they carry meaning; only colour/label live here.
 */
import type { Severity } from '@/domain/patterns';

export const SEVERITY_META: Record<Severity, { color: string; bg: string; label: string }> = {
  referral: { color: '#ff5d5d', bg: 'rgba(255,93,93,0.14)', label: 'Referral criteria' },
  discuss: { color: '#ffb043', bg: 'rgba(255,176,67,0.14)', label: 'Discuss with clinician' },
  note: { color: '#8b94a3', bg: 'rgba(255,255,255,0.05)', label: 'Note' },
};
