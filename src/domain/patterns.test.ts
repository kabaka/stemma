import { describe, expect, it } from 'vitest';
import { seedRecord } from '@/data/seed';
import { buildCatalog } from '@/domain/catalog';
import { detectPatterns, familyFindings } from './patterns';
import type { FamilyRecord } from './types';

const catalog = buildCatalog([]);
const AS_OF = 2026;

/** Look up a person in a record and push a condition entry onto their `conds`. */
function addCondition(
  record: FamilyRecord,
  personId: string,
  id: string,
  onset: number | null = null,
): void {
  const person = record.people.find((p) => p.id === personId);
  if (!person) throw new Error(`fixture error: no person ${personId}`);
  person.conds.push({ id, onset, prov: 'self' });
}

describe('detectPatterns (from the proband)', () => {
  const flags = detectPatterns(seedRecord(), catalog, 'you', AS_OF);
  const byTitle = (needle: string) => flags.find((f) => f.title.toLowerCase().includes(needle));

  it('raises an HBOC referral for clustered breast/ovarian cancer', () => {
    const hboc = byTitle('hereditary breast');
    expect(hboc).toBeDefined();
    expect(hboc!.severity).toBe('referral');
    // Helen (66), Linda (47), Mia (28) carry breast cancer; young onset is cited.
    expect(hboc!.criterion).toMatch(/breast cancer before age 50/i);
  });

  it('cites the specific lineage for a same-side breast-cancer cluster (NCCN per-lineage)', () => {
    // Helen, Linda and Mia are all on Maya's maternal side — one lineage, not three.
    const hboc = byTitle('hereditary breast');
    expect(hboc!.criterion).toMatch(/3 breast cancers on the maternal lineage/i);
  });

  it('flags cardiovascular clustering', () => {
    const cvd = byTitle('cardiovascular');
    expect(cvd).toBeDefined();
    expect(cvd!.criterion).toMatch(/cholesterol|coronary/i);
  });

  it('raises an age-of-onset alert for a condition approaching the proband', () => {
    // Maya is 38 in 2026; type 2 diabetes first appears in relatives at 49 (Linda).
    const alert = byTitle('age-of-onset');
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe('discuss');
  });

  it('does NOT raise a Lynch flag (only one distant, late-onset colorectal case)', () => {
    expect(byTitle('lynch')).toBeUndefined();
  });

  it('does NOT show the limited-history caveat for a full pedigree', () => {
    expect(byTitle('limited family history')).toBeUndefined();
  });

  it('sorts referral flags ahead of discuss/note', () => {
    const severities = flags.map((f) => f.severity);
    const firstDiscuss = severities.indexOf('discuss');
    const lastReferral = severities.lastIndexOf('referral');
    if (firstDiscuss !== -1 && lastReferral !== -1) expect(lastReferral).toBeLessThan(firstDiscuss);
  });
});

describe('detectPatterns (edge cases)', () => {
  it('shows the limited-history caveat for a sparse pedigree', () => {
    const sparse = seedRecord();
    // Keep only the proband and one parent.
    sparse.people = sparse.people.filter((p) => p.id === 'you' || p.id === 'susan');
    sparse.unions = [{ parents: ['susan'], children: ['you'] }];
    const flags = detectPatterns(sparse, catalog, 'you', AS_OF);
    expect(flags.some((f) => f.title === 'Limited family history')).toBe(true);
  });

  it('returns nothing for an unknown root', () => {
    expect(detectPatterns(seedRecord(), catalog, 'nobody', AS_OF)).toEqual([]);
  });
});

describe('familyFindings', () => {
  const findings = familyFindings(seedRecord(), catalog, 'you');

  it('bands breast cancer as clustered', () => {
    const brca = findings.find((f) => f.id === 'brca');
    expect(brca).toBeDefined();
    expect(brca!.band).toBe('Clustered');
    expect(brca!.affCount).toBeGreaterThanOrEqual(2);
  });

  it("marks the proband's own conditions as diagnosed", () => {
    const thy = findings.find((f) => f.id === 'thy');
    expect(thy!.diagnosed).toBe(true);
    expect(thy!.band).toBe('Diagnosed');
  });

  it('ranks clustered conditions before incidental ones', () => {
    const clusteredIdx = findings.findIndex((f) => f.band === 'Clustered');
    const inFamilyIdx = findings.findIndex((f) => f.band === 'In family');
    if (clusteredIdx !== -1 && inFamilyIdx !== -1) expect(clusteredIdx).toBeLessThan(inFamilyIdx);
  });
});

describe('familyFindings (band coverage + generic recommendation fallback)', () => {
  // 'ovarian' has no entry in RECS (src/data/recommendations.ts), so any finding for it
  // must fall through to genericRec — previously dark end-to-end.
  it('bands a single first-degree affected relative as "Close family" with the generic recommendation', () => {
    const record = seedRecord();
    addCondition(record, 'susan', 'ovarian', 55); // mother — degree 1, exactly one case
    const findings = familyFindings(record, catalog, 'you');
    const ov = findings.find((f) => f.id === 'ovarian');
    expect(ov).toBeDefined();
    expect(ov!.diagnosed).toBe(false);
    expect(ov!.affCount).toBe(1);
    expect(ov!.band).toBe('Close family');
    expect(ov!.rec).toBe(
      'A first-degree relative is affected — raise this family history at your next visit.',
    );
  });

  it('falls back to the generic "In family" recommendation for a single distant, uncurated-RECS case', () => {
    const record = seedRecord();
    addCondition(record, 'ray', 'ovarian', 40); // Ray: paternal cousin, degree 3 — not first-degree
    const findings = familyFindings(record, catalog, 'you');
    const ov = findings.find((f) => f.id === 'ovarian');
    expect(ov!.band).toBe('In family');
    expect(ov!.rec).toBe('A relative is affected — worth mentioning to your clinician.');
  });

  it('falls back to the generic "Diagnosed" recommendation when the proband carries an uncurated-RECS condition', () => {
    const record = seedRecord();
    addCondition(record, 'you', 'ovarian', 30);
    const findings = familyFindings(record, catalog, 'you');
    const ov = findings.find((f) => f.id === 'ovarian');
    expect(ov!.diagnosed).toBe(true);
    expect(ov!.band).toBe('Diagnosed');
    expect(ov!.rec).toBe(
      'Already diagnosed — focus on ongoing management and monitoring with your care team.',
    );
  });

  it('falls back to the generic "Clustered" recommendation for 2+ affected relatives with an uncurated-RECS condition', () => {
    const record = seedRecord();
    addCondition(record, 'susan', 'ovarian', 55);
    addCondition(record, 'helen', 'ovarian', 66);
    const findings = familyFindings(record, catalog, 'you');
    const ov = findings.find((f) => f.id === 'ovarian');
    expect(ov!.band).toBe('Clustered');
    expect(ov!.rec).toBe(
      'Multiple affected relatives — discuss earlier or more frequent screening and risk-reduction with your clinician.',
    );
  });

  it('bands a condition carried only by a non-blood relative as "—" with the routine-screening fallback', () => {
    const record = seedRecord();
    // Alex: Maya's spouse — non-blood (degree null), so not counted among `affected` at all.
    addCondition(record, 'alex', 'hunt', 40);
    const findings = familyFindings(record, catalog, 'you');
    const hunt = findings.find((f) => f.id === 'hunt');
    expect(hunt).toBeDefined();
    expect(hunt!.diagnosed).toBe(false);
    expect(hunt!.affCount).toBe(0);
    expect(hunt!.band).toBe('—');
    expect(hunt!.rec).toBe('Continue routine, age-appropriate screening.');
  });
});

// ---------------------------------------------------------------------------
// Positive branches the unmodified seed never trips. These are safety-critical:
// a regression that silently stops emitting one of these referrals would still
// pass the rest of the suite, since the seed pedigree happens not to cross any
// of these thresholds. See CONTRIBUTING.md "Add a pattern rule".
// ---------------------------------------------------------------------------

describe('detectPatterns (HBOC same-lineage refinement)', () => {
  it('downgrades to "discuss" when two breast cancers span opposite lineages', () => {
    const record = seedRecord();
    // Strip the seed's maternal cluster, then place one breast cancer on each lineage
    // (Susan = mother/maternal, Marie = paternal grandmother/paternal), both ≥50, no
    // ovarian: no side reaches two, so it can't be attributed to one hereditary lineage.
    for (const p of record.people) p.conds = p.conds.filter((c) => c.id !== 'brca');
    addCondition(record, 'susan', 'brca', 55);
    addCondition(record, 'marie', 'brca', 66);
    const flags = detectPatterns(record, catalog, 'you', AS_OF);
    const hboc = flags.find((f) => /hereditary breast/i.test(f.title));
    expect(hboc).toBeDefined();
    expect(hboc!.severity).toBe('discuss');
    expect(hboc!.criterion).toMatch(/not clustered on one lineage/i);
    // Guardrail #1: a "discuss" flag must not assert that testing criteria are met (the
    // recommendation text is severity-aware, per the medical-domain-expert sign-off).
    expect(hboc!.rec).not.toMatch(/meets common criteria/i);
    expect(hboc!.rec).toMatch(/testing criteria are not met/i);
  });

  it('keeps a referral when a single early-onset breast cancer (<50) is present, side aside', () => {
    const record = seedRecord();
    for (const p of record.people) p.conds = p.conds.filter((c) => c.id !== 'brca');
    // One breast cancer, maternal, before 50 — side-independent NCCN referral trigger.
    addCondition(record, 'susan', 'brca', 44);
    const flags = detectPatterns(record, catalog, 'you', AS_OF);
    const hboc = flags.find((f) => /hereditary breast/i.test(f.title));
    expect(hboc).toBeDefined();
    expect(hboc!.severity).toBe('referral');
    expect(hboc!.criterion).toMatch(/before age 50/i);
    // The referral path keeps the "meets criteria" language.
    expect(hboc!.rec).toMatch(/meets common criteria/i);
  });

  it('refers on two affected first-degree relatives (siblings share both lineages)', () => {
    const record = seedRecord();
    // Emma and Jack are Maya's siblings (degree 1). relationInfo gives siblings side '—'
    // (they share both parents), but two affected first-degree relatives is a strong
    // single-lineage signal — it must NOT be softened to "discuss".
    for (const p of record.people) p.conds = p.conds.filter((c) => c.id !== 'brca');
    addCondition(record, 'emma', 'brca', 52);
    addCondition(record, 'jack', 'brca', 55);
    const flags = detectPatterns(record, catalog, 'you', AS_OF);
    const hboc = flags.find((f) => /hereditary breast/i.test(f.title));
    expect(hboc).toBeDefined();
    expect(hboc!.severity).toBe('referral');
    expect(hboc!.criterion).toMatch(/2 first-degree relatives with breast cancer/i);
  });

  it('anchors a first-degree sibling to a parent lineage (mother + sister → maternal)', () => {
    const record = seedRecord();
    for (const p of record.people) p.conds = p.conds.filter((c) => c.id !== 'brca');
    addCondition(record, 'susan', 'brca', 58); // mother — maternal lineage
    addCondition(record, 'emma', 'brca', 55); // sister — shares both, anchored maternal here
    const flags = detectPatterns(record, catalog, 'you', AS_OF);
    const hboc = flags.find((f) => /hereditary breast/i.test(f.title));
    expect(hboc!.severity).toBe('referral');
    expect(hboc!.criterion).toMatch(/2 breast cancers on the maternal lineage/i);
  });

  it('cites BOTH lineages only when each independently clusters (four distinct cases)', () => {
    const record = seedRecord();
    // Maternal cluster: Helen + Linda. Paternal cluster: Marie + Edith. Both reach ≥2 on
    // their own, no shared relative — both are genuine and both are cited.
    for (const p of record.people) p.conds = p.conds.filter((c) => c.id !== 'brca');
    addCondition(record, 'helen', 'brca', 66);
    addCondition(record, 'linda', 'brca', 62);
    addCondition(record, 'marie', 'brca', 68);
    addCondition(record, 'edith', 'brca', 70);
    const flags = detectPatterns(record, catalog, 'you', AS_OF);
    const hboc = flags.find((f) => /hereditary breast/i.test(f.title));
    expect(hboc!.severity).toBe('referral');
    expect(hboc!.criterion).toMatch(/maternal lineage/i);
    expect(hboc!.criterion).toMatch(/paternal lineage/i);
  });

  it('never double-books a shared first-degree relative into two lineage clusters', () => {
    const record = seedRecord();
    // 1 maternal (mother) + 1 paternal (paternal grandmother) + 1 shared sibling. The
    // sibling could tip either side to two, but is one person: report ONE cluster, not
    // an inflated "2 maternal AND 2 paternal".
    for (const p of record.people) p.conds = p.conds.filter((c) => c.id !== 'brca');
    addCondition(record, 'susan', 'brca', 60);
    addCondition(record, 'marie', 'brca', 66);
    addCondition(record, 'emma', 'brca', 58);
    const flags = detectPatterns(record, catalog, 'you', AS_OF);
    const hboc = flags.find((f) => /hereditary breast/i.test(f.title));
    expect(hboc!.severity).toBe('referral');
    // Exactly one lineage cluster is cited (the sibling is credited once, not to both).
    expect((hboc!.criterion.match(/lineage/gi) ?? []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// HBOC sensitivity extension — pancreatic + male breast cancer (audit clinical-sensitivity
// finding; see docs/AUDIT.md). Both are any-age, single-case, side-independent standalone
// testing indications per NCCN Genetic/Familial High-Risk Assessment (Breast/Ovarian/
// Pancreatic). Strictly additive: the unmodified seed carries no panc and no male brca.
// ---------------------------------------------------------------------------

describe('detectPatterns (HBOC — pancreatic cancer, any age, single case)', () => {
  it('refers on a single pancreatic cancer case, independent of any breast/ovarian cluster', () => {
    const record = seedRecord();
    for (const p of record.people) p.conds = p.conds.filter((c) => c.id !== 'brca');
    // George: Maya's maternal grandfather (degree 2) — side plays no role in this trigger.
    // The reason string cites the RELATIONSHIP label (relationInfo's `rel`), not the name.
    addCondition(record, 'george', 'panc', 58);
    const flags = detectPatterns(record, catalog, 'you', AS_OF);
    const hboc = flags.find((f) => /hereditary breast/i.test(f.title));
    expect(hboc).toBeDefined();
    expect(hboc!.severity).toBe('referral');
    expect(hboc!.criterion).toMatch(
      /pancreatic cancer in a blood relative \(.*Maternal Grandfather at 58.*\)/i,
    );
    expect(hboc!.relatives.some((r) => r.person.id === 'george')).toBe(true);
  });

  it('preserves a pancreatic case’s onset of 0 rather than dropping it as falsy', () => {
    const record = seedRecord();
    for (const p of record.people) p.conds = p.conds.filter((c) => c.id !== 'brca');
    // Onset 0 is a boundary-value probe for the `onset != null` guardrail, not a claim of
    // clinical realism — proves the reason string doesn't silently drop a genuine age of 0.
    addCondition(record, 'george', 'panc', 0);
    const flags = detectPatterns(record, catalog, 'you', AS_OF);
    const hboc = flags.find((f) => /hereditary breast/i.test(f.title));
    expect(hboc!.criterion).toMatch(
      /pancreatic cancer in a blood relative \(Maternal Grandfather at 0\)/i,
    );
  });

  it('refers on pancreatic cancer even when side cannot be attributed to one lineage (full-sibling case)', () => {
    const record = seedRecord();
    for (const p of record.people) p.conds = p.conds.filter((c) => c.id !== 'brca');
    // Emma is Maya's full sibling — relationInfo gives full siblings side '—' (they share
    // both parents), exactly the shape the per-lineage breast-cluster logic can't use.
    // Pancreatic/male-breast triggers must not depend on `side` at all.
    addCondition(record, 'emma', 'panc', 60);
    const flags = detectPatterns(record, catalog, 'you', AS_OF);
    const hboc = flags.find((f) => /hereditary breast/i.test(f.title));
    expect(hboc).toBeDefined();
    expect(hboc!.severity).toBe('referral');
    expect(hboc!.criterion).toMatch(/pancreatic cancer in a blood relative/i);
  });

  it('does not mention pancreatic or male breast cancer when neither is recorded (seed baseline stays clean)', () => {
    // Additive guardrail: the unmodified seed carries no panc and no male brca, so the
    // existing HBOC referral (from the maternal breast cluster) must cite no spurious reasons.
    const flags = detectPatterns(seedRecord(), catalog, 'you', AS_OF);
    const hboc = flags.find((f) => /hereditary breast/i.test(f.title));
    expect(hboc).toBeDefined();
    expect(hboc!.criterion).not.toMatch(/pancreatic/i);
    expect(hboc!.criterion).not.toMatch(/male breast/i);
  });
});

describe('detectPatterns (HBOC — male breast cancer, keyed on sex assigned at birth)', () => {
  it('refers on male breast cancer in a blood relative, keyed on sab even when gender identity says otherwise', () => {
    const record = seedRecord();
    for (const p of record.people) p.conds = p.conds.filter((c) => c.id !== 'brca');
    const george = record.people.find((p) => p.id === 'george')!;
    george.sab = 'm'; // AMAB (already true in the seed; explicit for clarity)
    george.gender = 'woman'; // gender identity deliberately opposite of sab
    addCondition(record, 'george', 'brca', 61);
    const flags = detectPatterns(record, catalog, 'you', AS_OF);
    const hboc = flags.find((f) => /hereditary breast/i.test(f.title));
    expect(hboc).toBeDefined();
    expect(hboc!.severity).toBe('referral');
    // The relationship LABEL follows gender identity ("Grandmother", since gender is
    // 'woman') — a separate axis from the sab-driven male-breast classification itself,
    // which correctly still fires despite the label's gendered wording.
    expect(hboc!.criterion).toMatch(
      /male breast cancer in a blood relative \(.*Maternal Grandmother at 61.*\)/i,
    );
  });

  it('does NOT count a brca case as male breast when sab is female, even if gender identity is man (guardrail #4)', () => {
    const record = seedRecord();
    for (const p of record.people) p.conds = p.conds.filter((c) => c.id !== 'brca');
    const george = record.people.find((p) => p.id === 'george')!;
    george.sab = 'f'; // AFAB
    george.gender = 'man'; // gender identity says man, but sab must drive the genetics signal
    // A single case, >=50, not clustered, not ovarian/pancreatic: if this were (wrongly)
    // counted as male breast, an HBOC referral would appear; if genuinely gated on sab, no
    // HBOC trigger fires at all and the flag is absent entirely.
    addCondition(record, 'george', 'brca', 61);
    const flags = detectPatterns(record, catalog, 'you', AS_OF);
    expect(flags.find((f) => /hereditary breast/i.test(f.title))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Ship-blocker #3 regression — the one-parent-side fix (graph.ts Defect 3) must flow through
// to patterns.ts: an in-progress pedigree with only ONE parent recorded must still correctly
// attribute side, so a genuine same-lineage breast-cancer cluster is referred, not silently
// downgraded to "discuss" because the missing parent blanked `side` for everyone.
// ---------------------------------------------------------------------------

describe('detectPatterns (HBOC referral not downgraded when only one parent is recorded)', () => {
  it('still refers a 2-case maternal-lineage cluster when only the mother (not the father) is recorded', () => {
    // A minimal one-parent-recorded pedigree: 'you' has only 'susan' (mother) on record;
    // susan in turn has only 'helen' (her own mother) on record. Two breast cancers, both
    // genuinely on the maternal lineage, both >=50 (so neither the <50 nor the ovarian/
    // pancreatic triggers can carry this alone — the referral can ONLY come from correctly
    // recognising the 2-case maternal cluster).
    //
    // Before the Defect-3 fix, side was gated on `father && mother` both being present; with
    // no father ever recorded for 'you', EVERY relative's side silently went '—' — so this
    // exact pedigree would wrongly report "not clustered on one lineage" and downgrade to
    // "discuss", missing a referral a clinician should see.
    const record: FamilyRecord = {
      people: [
        {
          id: 'you',
          name: 'You',
          sab: 'f',
          gender: 'woman',
          gen: 2,
          x: 0,
          dead: false,
          birth: 1988,
          death: null,
          isProband: true,
          conds: [],
        },
        {
          id: 'susan',
          name: 'Susan',
          sab: 'f',
          gender: 'woman',
          gen: 1,
          x: 0,
          dead: false,
          birth: 1960,
          death: null,
          conds: [{ id: 'brca', onset: 55, prov: 'self' }],
        },
        {
          id: 'helen',
          name: 'Helen',
          sab: 'f',
          gender: 'woman',
          gen: 0,
          x: 0,
          dead: false,
          birth: 1935,
          death: null,
          conds: [{ id: 'brca', onset: 66, prov: 'self' }],
        },
      ],
      unions: [
        { parents: ['helen'], children: ['susan'] }, // susan's only recorded parent
        { parents: ['susan'], children: ['you'] }, // you's only recorded parent
      ],
      timeline: [],
      probandId: 'you',
    };
    const flags = detectPatterns(record, catalog, 'you', AS_OF);
    const hboc = flags.find((f) => /hereditary breast/i.test(f.title));
    expect(hboc).toBeDefined();
    expect(hboc!.severity).toBe('referral');
    expect(hboc!.criterion).toMatch(/2 breast cancers on the maternal lineage/i);
  });
});

describe('detectPatterns (Lynch spectrum — ovarian & upper urinary tract)', () => {
  it('counts ovarian and upper-urinary-tract cancers in the Lynch spectrum', () => {
    const record = seedRecord();
    // Edith already carries colon (seed). Add ovarian to Helen and UTUC to George →
    // colorectal + ovarian + upper-tract = 3 Lynch-spectrum cancers.
    addCondition(record, 'helen', 'ovarian', 68);
    addCondition(record, 'george', 'utuc', 70);
    const flags = detectPatterns(record, catalog, 'you', AS_OF);
    const lynch = flags.find((f) => /lynch/i.test(f.title));
    expect(lynch).toBeDefined();
    expect(lynch!.criterion).toMatch(/upper urinary tract/i);
    expect(lynch!.relatives.some((r) => r.person.id === 'george')).toBe(true);
    // Ovarian belongs to both spectra — the dual-pathway caveat is surfaced.
    expect(lynch!.rec).toMatch(/both the Lynch/i);
  });

  it('lets one ovarian cancer seed BOTH the Lynch and HBOC referrals', () => {
    const record = seedRecord();
    // Clear the seed's breast cluster so HBOC can only be driven by ovarian; Edith's
    // seed colon keeps a second Lynch-spectrum cancer in play.
    for (const p of record.people) p.conds = p.conds.filter((c) => c.id !== 'brca');
    addCondition(record, 'susan', 'ovarian', 60);
    const flags = detectPatterns(record, catalog, 'you', AS_OF);
    expect(flags.find((f) => /hereditary breast/i.test(f.title))).toBeDefined();
    expect(flags.find((f) => /lynch/i.test(f.title))).toBeDefined();
  });
});

describe('detectPatterns (Lynch syndrome referral)', () => {
  it('flags early-onset colorectal cancer in a first-degree relative', () => {
    const record = seedRecord();
    // Emma is Maya's sister — a first-degree (degree 1) blood relative.
    addCondition(record, 'emma', 'colon', 45);
    const flags = detectPatterns(record, catalog, 'you', AS_OF);
    const lynch = flags.find((f) => /lynch/i.test(f.title));
    expect(lynch).toBeDefined();
    expect(lynch!.severity).toBe('referral');
    expect(lynch!.criterion).toMatch(/colorectal cancer before age 50/i);
  });

  it('flags clustered Lynch-spectrum cancers (colorectal + endometrial)', () => {
    const record = seedRecord();
    // Edith (great-grandmother) already carries colon cancer (onset 78) in the seed;
    // adding endometrial cancer to Susan (mother) clusters two Lynch-spectrum cancers.
    addCondition(record, 'susan', 'endometrial', 58);
    const flags = detectPatterns(record, catalog, 'you', AS_OF);
    const lynch = flags.find((f) => /lynch/i.test(f.title));
    expect(lynch).toBeDefined();
    expect(lynch!.severity).toBe('referral');
    expect(lynch!.criterion).toMatch(/Lynch-spectrum cancers/);
  });
});

describe('detectPatterns (premature cardiovascular disease)', () => {
  it('keeps the unmodified seed at "discuss" (Robert\'s onset of 60 misses the premature threshold)', () => {
    const flags = detectPatterns(seedRecord(), catalog, 'you', AS_OF);
    const cvd = flags.find((f) => /cardiovascular/i.test(f.title));
    expect(cvd).toBeDefined();
    expect(cvd!.severity).toBe('discuss');
  });

  it('escalates to a referral when a first-degree relative has premature coronary disease', () => {
    const record = seedRecord();
    const robert = record.people.find((p) => p.id === 'robert')!;
    // Robert (father) is male; onset before 55 is the premature threshold.
    robert.conds.find((c) => c.id === 'cad')!.onset = 50;
    const flags = detectPatterns(record, catalog, 'you', AS_OF);
    const cvd = flags.find((f) => /cardiovascular/i.test(f.title));
    expect(cvd).toBeDefined();
    expect(cvd!.severity).toBe('referral');
    expect(cvd!.criterion).toMatch(/premature coronary disease in a first-degree relative/i);
  });
});

describe('detectPatterns (generic autosomal-dominant sweep)', () => {
  it('flags a dominant, non-covered condition present across 2+ generations', () => {
    const record = seedRecord();
    // Huntington's ('hunt') is autosomal dominant and not owned by any specific
    // pattern block, so it only surfaces via the generic AD sweep. Susan (mother,
    // degree 1) and Helen (maternal grandmother, degree 2) span 2 generations.
    addCondition(record, 'susan', 'hunt');
    addCondition(record, 'helen', 'hunt');
    const flags = detectPatterns(record, catalog, 'you', AS_OF);
    const ad = flags.find((f) => /autosomal-dominant pattern/i.test(f.title));
    expect(ad).toBeDefined();
    expect(ad!.title).toContain('Huntington');
    expect(ad!.severity).toBe('referral');
    expect(ad!.criterion).toMatch(/across 2 generations/);
  });

  it('does NOT flag a dominant condition confined to a single distant relative', () => {
    const record = seedRecord();
    // Ray is a paternal cousin (degree 3, a single generation, not first-degree) —
    // one distant carrier should not trip the vertical-transmission sweep.
    addCondition(record, 'ray', 'hunt');
    const flags = detectPatterns(record, catalog, 'you', AS_OF);
    expect(flags.find((f) => /autosomal-dominant pattern/i.test(f.title))).toBeUndefined();
  });
});
