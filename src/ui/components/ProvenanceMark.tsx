import type { Provenance } from '@/domain/types';
import { PROV_META } from '@/data/provenance';

/**
 * A relative's record provenance, shown as a non-colour glyph **plus a short visible
 * label** (e.g. "✓ records") so the source is legible to everyone — not conveyed by the
 * tiny glyph alone (WCAG 1.4.1) and not gated behind a hover-only `title`. The full
 * source name is also exposed to assistive tech; the evidentiary-weight rationale is on
 * hover for sighted mouse users and stated once, visibly, in the Patterns legend.
 */
export function ProvenanceMark({ prov }: { prov: Provenance }) {
  const pm = PROV_META[prov];
  return (
    <span style={{ whiteSpace: 'nowrap' }} title={`${pm.label} — ${pm.weight}`}>
      <span aria-hidden="true">
        {pm.mark} {pm.short}
      </span>
      <span className="visually-hidden">, source: {pm.label}</span>
    </span>
  );
}
