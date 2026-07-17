import { describe, expect, it } from 'vitest';
import { seedRecord } from '@/data/seed';
import type { Person } from './types';
import {
  ageOf,
  condEntry,
  condIds,
  defaultOrgans,
  genderLabel,
  genderSymbol,
  hasCond,
  organsOf,
  sabLabel,
} from './person';

const AS_OF = 2026;
const record = seedRecord();
const byId = (id: string): Person => record.people.find((p) => p.id === id)!;

/** Minimal fixture for edge cases the seed family doesn't cover. */
const basePerson: Person = {
  id: 'fixture',
  name: 'Fixture',
  sab: 'f',
  gender: 'woman',
  gen: 0,
  x: 0,
  dead: false,
  birth: null,
  death: null,
  conds: [],
};

describe('ageOf', () => {
  it('uses death year minus birth year for the deceased, not the wall clock', () => {
    // Walter died in 1994 — his age must stay 79 regardless of the as-of year.
    expect(ageOf(byId('walter'), AS_OF)).toBe(79);
    expect(ageOf(byId('walter'), 2050)).toBe(79);
  });

  it('uses asOfYear minus birth year for the living', () => {
    expect(ageOf(byId('you'), AS_OF)).toBe(38);
  });

  it('returns null when birth year is unknown', () => {
    expect(ageOf({ ...basePerson, birth: null }, AS_OF)).toBeNull();
  });

  it('falls through to asOfYear minus birth when dead but death year is unknown', () => {
    const p: Person = { ...basePerson, dead: true, death: null, birth: 1950 };
    expect(ageOf(p, AS_OF)).toBe(AS_OF - 1950);
  });
});

describe('defaultOrgans', () => {
  it('derives the AFAB default set', () => {
    expect(defaultOrgans('f')).toEqual(['breasts', 'ovaries', 'uterus', 'cervix']);
  });

  it('derives the AMAB default set', () => {
    expect(defaultOrgans('m')).toEqual(['prostate']);
  });

  it('derives an empty set for unknown sab', () => {
    expect(defaultOrgans('u')).toEqual([]);
  });

  it('derives an empty set for UAAB sab (no assumed organs, like unknown)', () => {
    expect(defaultOrgans('x')).toEqual([]);
  });
});

describe('organsOf', () => {
  it("honours a person's explicit organ inventory over the sab default", () => {
    // Ray is AFAB with an explicit inventory that omits breasts (surgical history).
    expect(organsOf(byId('ray'))).toEqual(['ovaries', 'uterus', 'cervix']);
  });

  it('falls back to the sab default when no explicit inventory is recorded', () => {
    expect(organsOf(byId('you'))).toEqual(defaultOrgans('f'));
  });
});

describe('condIds / hasCond / condEntry', () => {
  const robert = byId('robert');

  it('lists condition ids recorded on a person', () => {
    expect(condIds(robert).sort()).toEqual(['cad', 'chol', 'htn']);
  });

  it('reports whether a person carries a condition', () => {
    expect(hasCond(robert, 'cad')).toBe(true);
    expect(hasCond(robert, 'brca')).toBe(false);
  });

  it('resolves the recorded entry for a condition, including onset and provenance', () => {
    const entry = condEntry(robert, 'cad');
    expect(entry).toEqual({ id: 'cad', onset: 60, prov: 'record' });
  });

  it('returns undefined for a condition not carried', () => {
    expect(condEntry(robert, 'brca')).toBeUndefined();
  });
});

describe('label / symbol helpers', () => {
  it('labels sex assigned at birth', () => {
    expect(sabLabel('f')).toBe('AFAB');
    expect(sabLabel('m')).toBe('AMAB');
    expect(sabLabel('u')).toBe('unknown');
    expect(sabLabel('x')).toBe('UAAB');
  });

  it('labels gender identity', () => {
    expect(genderLabel('man')).toBe('Man');
    expect(genderLabel('woman')).toBe('Woman');
    expect(genderLabel('nb')).toBe('Nonbinary');
  });

  it('gives each gender identity a distinct display symbol', () => {
    expect(genderSymbol('man')).toBe('♂');
    expect(genderSymbol('woman')).toBe('♀');
    expect(genderSymbol('nb')).toBe('⚥');
  });
});
