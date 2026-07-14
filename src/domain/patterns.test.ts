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

// ---------------------------------------------------------------------------
// Positive branches the unmodified seed never trips. These are safety-critical:
// a regression that silently stops emitting one of these referrals would still
// pass the rest of the suite, since the seed pedigree happens not to cross any
// of these thresholds. See CONTRIBUTING.md "Add a pattern rule".
// ---------------------------------------------------------------------------

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
