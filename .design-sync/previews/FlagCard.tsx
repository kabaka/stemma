// FlagCard — one hereditary-pattern flag (criterion met + advisory recommendation).
// Flags are derived from the REAL engine over the illustrative seed family, so every
// severity, title, criterion, recommendation, and affected-relative is genuine engine
// output — never hand-written clinical text. Cells span both severities the seed
// produces: one referral criterion and two "discuss with clinician" flags.
import { FlagCard, seedRecord, buildCatalog, detectPatterns } from 'stemma';

const flags = detectPatterns(seedRecord(), buildCatalog([]), 'you', 2026);
const byTitle = (needle: string) => flags.find((f) => f.title.includes(needle));

// Referral-severity: hereditary breast/ovarian/pancreatic (HBOC/BRCA) pattern.
const hboc = byTitle('HBOC') ?? flags.find((f) => f.severity === 'referral') ?? flags[0];
// Discuss-severity: premature cardiovascular disease clustering.
const cvd = byTitle('Premature cardiovascular') ?? flags.find((f) => f.severity === 'discuss') ?? flags[1];
// Discuss-severity: an age-of-onset alert (earlier onset than typical).
const onset = byTitle('Age-of-onset') ?? flags[2] ?? flags[1];

export const HbocReferral = () => <FlagCard flag={hboc} />;
export const PrematureCardiovascular = () => <FlagCard flag={cvd} />;
export const AgeOfOnsetAlert = () => <FlagCard flag={onset} />;
