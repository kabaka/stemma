/**
 * The clinical boundary rendered as a first-class, bordered callout (guardrail #3):
 * every surface that shows analysis must restate that Stemma is not a diagnostic device,
 * and it must read as a standing disclaimer — not a footer, and not a sentence buried in
 * lede body text. `role="note"` marks it as ancillary standing content for assistive
 * tech; the icon is decorative.
 */
export function ClinicalBoundary({ children }: { children?: React.ReactNode }) {
  return (
    <div className="clinical-boundary" role="note" aria-label="Clinical boundary">
      <span className="clinical-boundary__icon" aria-hidden="true">
        ⚕
      </span>
      <p className="clinical-boundary__text">
        {children ?? (
          <>
            <b>Stemma is not a diagnostic device.</b> It surfaces published red-flag patterns and
            the specific referral criteria they meet — it never manufactures a risk number or a
            diagnosis. For any medical decision, consult a clinician or genetic counselor.
          </>
        )}
      </p>
    </div>
  );
}
