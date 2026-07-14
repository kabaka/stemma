import { describe, expect, it } from 'vitest';
import { seedRecord } from '@/data/seed';
import { calculatorsFor, dueCount, familySignal, screeningsFor } from './screening';

describe('screeningsFor', () => {
  const forMaya = screeningsFor(seedRecord(), 'you');
  const names = forMaya.map((s) => s.name);

  it('recommends a mammogram given breast tissue + family breast-cancer signal', () => {
    const mammogram = forMaya.find((s) => s.id === 'mammogram');
    expect(mammogram).toBeDefined();
    expect(mammogram!.status).toBe('Recommended');
    expect(mammogram!.why).toMatch(/family history/);
  });

  it('offers cervical screening (cervix present) but not prostate (no prostate)', () => {
    expect(names).toContain('Cervical screening (Pap/HPV)');
    expect(names).not.toContain('Prostate (PSA) discussion');
  });

  it('refers the BRCA panel when there is a hereditary-cancer signal', () => {
    const panel = forMaya.find((s) => s.id === 'brcapanel');
    expect(panel).toBeDefined();
    expect(panel!.status).toBe('Referred');
  });

  it('keys screening off the organ inventory, not gender', () => {
    // Ray is gender man, AFAB, with an explicit organ inventory (ovaries/uterus/cervix,
    // no breasts). He should be offered cervical screening but never a mammogram.
    const forRay = screeningsFor(seedRecord(), 'ray').map((s) => s.name);
    expect(forRay).toContain('Cervical screening (Pap/HPV)');
    expect(forRay).not.toContain('Mammogram');
    expect(forRay).not.toContain('Prostate (PSA) discussion');
  });

  it('counts screenings that need action', () => {
    expect(dueCount(forMaya)).toBeGreaterThan(0);
  });

  it('escalates the prostate PSA discussion on a family prostate-cancer signal', () => {
    // Robert (sab m) has a prostate; his brother Tom is a first-degree blood relative.
    // Giving Tom prostate cancer should escalate Robert's PSA discussion to Recommended.
    const record = seedRecord();
    record.people
      .find((p) => p.id === 'tom')!
      .conds.push({ id: 'prostate', onset: 62, prov: 'self' });
    const psa = screeningsFor(record, 'robert').find((s) => s.id === 'prostate');
    expect(psa).toBeDefined();
    expect(psa!.status).toBe('Recommended');
    expect(psa!.why).toMatch(/family history/);
  });

  it('leaves the prostate PSA discussion routine without a family signal', () => {
    // Robert has a prostate but (in the unmodified seed) no prostate-cancer/BRCA signal
    // among his blood relatives, so the screen stays routine.
    const psa = screeningsFor(seedRecord(), 'robert').find((s) => s.id === 'prostate');
    expect(psa).toBeDefined();
    expect(psa!.status).toBe('Routine');
  });
});

describe('familySignal', () => {
  it('collects condition codes across blood relatives', () => {
    const signal = familySignal(seedRecord(), 'you');
    expect(signal.has('brca')).toBe(true);
    expect(signal.has('t2d')).toBe(true);
  });
});

describe('calculatorsFor', () => {
  it('surfaces validated external models seeded by the family history', () => {
    const calcs = calculatorsFor(seedRecord(), 'you');
    const names = calcs.map((c) => c.name);
    expect(names).toContain('CanRisk / BOADICEA');
    expect(calcs[0].summary).toMatch(/affected relative/);
  });
});
