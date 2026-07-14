/**
 * Curated per-condition recommendations for high-signal conditions. Conditions not
 * listed fall back to a band-based generic line (see `familyFindings`). These are
 * plain-language prompts to raise with a clinician — advisory, never diagnostic.
 */
export const RECS: Record<string, string> = {
  cad: 'Lipid panel + ASCVD score now; discuss aggressive LDL targets given dense paternal history.',
  t2d: 'Annual HbA1c from age 35; maintain BMI and activity — a strong 1st-degree driver.',
  brca: '≥2 affected maternal relatives — pursue BRCA1/2 panel and begin annual mammography + MRI.',
  colon: 'Begin colonoscopy at 40 (10 yrs before earliest family case); repeat every 5 yrs.',
  alz: 'Modifiable-risk focus (BP, activity, sleep). APOE testing optional and counsel-gated.',
  htn: 'Home BP monitoring; sodium and weight management — highly prevalent across the pedigree.',
  dep: 'Continue current management; family history warrants low threshold for early intervention.',
  thy: 'Annual TSH; watch for fatigue and weight change. Clusters with autoimmune thyroid disease.',
  chol: 'Given the familial pattern, evaluate for familial hypercholesterolemia (FH).',
  stroke: 'Control BP and cholesterol; secondary to cardiovascular clustering.',
  celiac: 'Serologic screen if symptomatic; runs in 1st-degree relatives.',
};
