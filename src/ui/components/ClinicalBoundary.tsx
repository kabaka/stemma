/**
 * The clinical boundary rendered as a first-class, bordered callout (guardrail #3):
 * every surface that shows analysis must restate that Stemma is not a diagnostic device,
 * and it must read as a standing disclaimer — not a footer, and not a sentence buried in
 * lede body text.
 *
 * The core statement ("Not a diagnostic device …, never a risk number") is **always
 * visible** and styled as chrome — that is the non-negotiable part of guardrail #3. The
 * fuller elaboration sits one interaction away in a native `<details>` disclosure, so the
 * callout stays compact (it previously ate 15%+ of shorter screens) without ever hiding
 * the essential message. `role="note"` marks it as ancillary standing content for
 * assistive tech; the icon is decorative. Print output states the full text
 * unconditionally via its own `BoundaryFooter` (see PrintReports.tsx) — a static sheet
 * has no disclosure to open, so the two surfaces intentionally differ.
 */
export function ClinicalBoundary() {
  return (
    <div className="clinical-boundary" role="note" aria-label="Clinical boundary">
      <span className="clinical-boundary__icon" aria-hidden="true">
        ⚕
      </span>
      <div className="clinical-boundary__body">
        <p className="clinical-boundary__summary">
          <b>Not a diagnostic device.</b> Stemma surfaces published red-flag patterns and the
          referral criteria they meet — never a risk number.
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
