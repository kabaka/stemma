import { describe, expect, it } from 'vitest';
import { seedRecord } from '@/data/seed';
import { CONDITIONS, COMMON_CONDITIONS } from '@/data/conditions';
import { CATEGORY_LABELS } from '@/data/categories';
import { createCatalog } from './catalog';
import { detectPatterns, familyFindings } from './patterns';

const catalog = createCatalog([...CONDITIONS], [...COMMON_CONDITIONS], CATEGORY_LABELS);
const AS_OF = 2026;

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
