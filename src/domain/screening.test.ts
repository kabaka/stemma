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
