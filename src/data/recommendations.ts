/**
 * Curated per-condition recommendations for high-signal conditions. Conditions not
 * listed fall back to a band-based generic line (see `familyFindings`).
 *
 * GUARDRAIL: these are attached by condition code and shown for any family carrying
 * that condition, so they must NOT assert family-specific facts (who is affected, on
 * which side, at what age) or issue directives — the pedigree beside them is the source
 * of truth for specifics, and Stemma is not a diagnostic device. Keep every line
 * advisory ("worth discussing with a clinician…"), non-specific, and free of imperatives.
 * The HBOC pattern flag in `patterns.ts` is the model voice.
 */
export const RECS: Record<string, string> = {
  cad: 'A lipid panel and an ASCVD risk assessment are reasonable to discuss with a clinician; where coronary disease clusters in a family, earlier and more intensive lipid management is often considered.',
  t2d: 'Periodic HbA1c screening and attention to weight and activity are worth discussing; type 2 diabetes has a strong familial component.',
  brca: 'A family history of breast cancer may meet criteria to discuss BRCA1/2 testing and enhanced breast screening with a clinician or genetic counselor.',
  colon:
    'Where colorectal cancer runs in the family, it is reasonable to discuss starting colonoscopy earlier and repeating it more often than the average-risk schedule.',
  alz: 'Focusing on modifiable risks (blood pressure, activity, sleep) is reasonable; APOE testing is optional and best done with genetic counseling.',
  htn: 'Home blood-pressure monitoring and attention to sodium and weight are reasonable to discuss; hypertension is strongly familial.',
  dep: 'A family history of depression can warrant a lower threshold for seeking support early; discuss options with a clinician.',
  thy: 'Periodic thyroid (TSH) testing may be worth discussing; thyroid disease clusters with other autoimmune conditions.',
  chol: 'A familial cholesterol pattern is worth discussing with a clinician, including evaluation for familial hypercholesterolemia (FH).',
  stroke:
    'Managing blood pressure and cholesterol is the mainstay; stroke risk often tracks with cardiovascular clustering in a family.',
  celiac:
    'If symptoms suggest it, serologic screening is worth discussing; celiac disease runs in first-degree relatives.',
};
