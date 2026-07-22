import type { RangePosition } from '@/domain/timeline';

/**
 * A single measurement's position against its OWN co-recorded reference bounds, shown as a
 * short, strictly POSITIONAL pill: "above range" / "below range". Renders nothing for
 * `undefined` (no bounds to compare against) AND for `'within'` — only the exceptional case
 * is marked, so the common case (a value inside its range) stays visually quiet, matching
 * {@link ProvenanceMark}'s "visible text, not colour-alone" idiom (WCAG 1.4.1).
 *
 * Deliberately NOT reusing `SEVERITY_META`/`--sev-*`: a severity colour would smuggle a
 * clinical interpretation back in (guardrail #1 — this is a positional restatement of the
 * FHIR `referenceRange` axis, never the `interpretation`/H-L-abnormal axis). `.range-mark`
 * is a single neutral style, identical for `'above'` and `'below'` — the visible text is the
 * only thing that distinguishes them, never colour.
 */
export function RangePositionMark({ position }: { position: RangePosition | undefined }) {
  if (position === undefined || position === 'within') return null;
  const label = position === 'above' ? 'above range' : 'below range';
  return (
    <>
      {' '}
      <span className="badge range-mark">
        <span aria-hidden="true">◆ </span>
        {label}
      </span>
    </>
  );
}
