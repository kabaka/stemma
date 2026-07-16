/**
 * The clinical boundary rendered as a first-class, bordered callout (guardrail #3):
 * every surface that shows analysis must restate that Stemma is not a diagnostic device,
 * and it must read as a standing disclaimer — not a footer, and not a sentence buried in
 * lede body text.
 *
 * The core statement is **always visible**, with its lead sentence (through "not a
 * diagnostic device") bolded so it reads as chrome, not body text — the non-negotiable part
 * of guardrail #3. The fuller elaboration sits one interaction away in a native
 * `<details>` disclosure, so the
 * callout stays compact (it previously ate 15%+ of shorter screens) without ever hiding
 * the essential message. `role="note"` marks it as ancillary standing content for
 * assistive tech; the icon is decorative. Print output states the full text
 * unconditionally via its own `BoundaryFooter` (see PrintReports.tsx) — a static sheet
 * has no disclosure to open, so the two surfaces intentionally differ.
 *
 * The visible summary text is sourced from the shared {@link CLINICAL_BOUNDARY_TEXT}
 * constant so this callout, the print one-pagers, and the exported calendar stay in lockstep.
 */
import { CLINICAL_BOUNDARY_TEXT } from '@/domain/boundary';

// Split the shared constant into its lead sentence and the remainder so the callout can
// give the lead first-class visual weight (guardrail #3: not a footer) without forking the
// wording — the text stays a single source of truth shared with print + the .ics export.
const SPLIT = CLINICAL_BOUNDARY_TEXT.indexOf('. ') + 1;
const BOUNDARY_LEAD = CLINICAL_BOUNDARY_TEXT.slice(0, SPLIT);
const BOUNDARY_REST = CLINICAL_BOUNDARY_TEXT.slice(SPLIT);

export function ClinicalBoundary() {
  return (
    <div className="clinical-boundary" role="note" aria-label="Clinical boundary">
      <span className="clinical-boundary__icon" aria-hidden="true">
        ⚕
      </span>
      <div className="clinical-boundary__body">
        <p className="clinical-boundary__summary">
          <b>{BOUNDARY_LEAD}</b>
          {BOUNDARY_REST}
        </p>
        <details className="clinical-boundary__details">
          <summary className="clinical-boundary__toggle">Why this matters</summary>
          <p className="clinical-boundary__text">
            Stemma reports <i>patterns</i> and the specific published criterion they meet; it never
            manufactures a risk number or a diagnosis. Any recommendation is a prompt to raise with
            a clinician, not an instruction. For any medical decision, consult a clinician or
            genetic counselor.
          </p>
        </details>
      </div>
    </div>
  );
}
