/**
 * The canonical clinical-boundary sentence (guardrail #3).
 *
 * Stemma is decision-support, not a diagnostic device, and every surface that shows
 * analysis must restate that. This module holds the single source of truth for that
 * wording so the on-screen callout ({@link import('@/ui/components/ClinicalBoundary')}),
 * the printable one-pagers, and the exported care-coordination calendar all speak with
 * one voice. Pure data — no React, no I/O — so any layer may import it.
 */

/** The canonical clinical-boundary statement restated on every analysis surface. */
export const CLINICAL_BOUNDARY_TEXT =
  'Stemma is an organizing tool that surfaces family-history patterns worth a clinician’s ' +
  'attention — not a diagnostic device. It reports published referral criteria, never a ' +
  'computed risk number. Discuss anything here with a clinician or genetic counselor.';
