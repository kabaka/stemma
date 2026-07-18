import { describe, expect, it } from 'vitest';
import { CONDITIONS, COMMON_CONDITIONS } from '@/data/conditions';
import { CATEGORY_LABELS } from '@/data/categories';
import { conditionFromCode, createCatalog, fallbackCondition, sanitizeExtensions } from './catalog';
import type { Condition } from './types';

const catalog = createCatalog([...CONDITIONS], [...COMMON_CONDITIONS], CATEGORY_LABELS);

describe('catalog lookup', () => {
  it('resolves curated conditions with baked-in codes', () => {
    const brca = catalog.get('brca');
    expect(brca.name).toBe('Breast cancer');
    expect(brca.icd10).toBe('C50.919');
    expect(brca.snomed).toBeDefined();
    expect(catalog.has('brca')).toBe(true);
  });

  it('falls back generically for unknown (long-tail) codes', () => {
    const unknown = catalog.get('C99.9');
    expect(unknown.name).toBe('C99.9');
    expect(unknown.cat).toBe('other');
    expect(catalog.has('C99.9')).toBe(false);
  });

  it('merges user extensions from vocabulary search', () => {
    const extended = createCatalog(
      [
        ...CONDITIONS,
        {
          id: 'C50.911',
          name: 'Malignant neoplasm of right female breast',
          cat: 'canc',
          base: 0,
          pattern: '—',
        },
      ],
      [...COMMON_CONDITIONS],
      CATEGORY_LABELS,
    );
    expect(extended.has('C50.911')).toBe(true);
    expect(extended.get('C50.911').name).toMatch(/right female breast/);
  });
});

describe('catalog search', () => {
  it('returns the common set (in order) for an empty query', () => {
    const hits = catalog.search('');
    expect(hits[0].id).toBe('htn');
    expect(hits.map((h) => h.id)).toEqual(expect.arrayContaining(['t2d', 'cad', 'brca']));
  });

  it('ranks exact and prefix matches, and searches synonyms', () => {
    const diabetes = catalog.search('diabetes').map((h) => h.id);
    expect(diabetes).toContain('t2d');
    expect(diabetes).toContain('t1d');

    // "mi" is a synonym for coronary heart disease.
    const mi = catalog.search('mi').map((h) => h.id);
    expect(mi).toContain('cad');
  });

  it('excludes already-selected ids', () => {
    const hits = catalog.search('', new Set(['htn']));
    expect(hits.map((h) => h.id)).not.toContain('htn');
  });

  it('caps the number of results returned', () => {
    // A single common letter matches far more than 3 of the 115 curated conditions.
    const hits = catalog.search('a', undefined, 3);
    expect(hits).toHaveLength(3);
  });

  it('ranks match tiers: exact > name-prefix > word-boundary > synonym-substring', () => {
    // A small crafted catalog isolates one condition per tier against the same query,
    // so the only thing under test is score ordering, not which real conditions match.
    const tiered = createCatalog(
      [
        { id: 'c-exact', name: 'Cat', cat: 'other', base: 0, pattern: '—' },
        { id: 'c-prefix', name: 'Catalepsy', cat: 'other', base: 0, pattern: '—' },
        { id: 'c-wordb', name: 'Scratch Cat Fever', cat: 'other', base: 0, pattern: '—' },
        {
          id: 'c-synsub',
          name: 'Unrelated Finding',
          cat: 'other',
          base: 0,
          pattern: '—',
          syn: ['Advocate Something'], // "advocate" contains "cat" mid-word, not as a prefix
        },
      ],
      [],
      CATEGORY_LABELS,
    );
    const hits = tiered.search('cat').map((h) => h.id);
    expect(hits).toEqual(['c-exact', 'c-prefix', 'c-wordb', 'c-synsub']);
  });
});

describe('catalog byCode', () => {
  // 'brca' is curated with icd10: 'C50.919', snomed: '254837009' (src/data/conditions.ts).
  it('resolves an exact ICD-10-CM code to its curated condition', () => {
    const hit = catalog.byCode('ICD-10-CM', 'C50.919');
    expect(hit?.id).toBe('brca');
  });

  it('falls back to the 3-character ICD-10-CM category when there is no exact curated code', () => {
    // No curated condition carries C50.911 exactly; 'brca' (C50.919) is the curated condition
    // for the C50 category, so a full code in that family should still resolve to it.
    const hit = catalog.byCode('ICD-10-CM', 'C50.911');
    expect(hit?.id).toBe('brca');
  });

  it('is case-insensitive on the ICD-10-CM code', () => {
    expect(catalog.byCode('ICD-10-CM', 'c50.919')?.id).toBe('brca');
  });

  it('returns undefined for an ICD-10-CM code with no exact or category match', () => {
    expect(catalog.byCode('ICD-10-CM', 'Z99.999')).toBeUndefined();
  });

  it('resolves an exact SNOMED-CT code to its curated condition', () => {
    expect(catalog.byCode('SNOMED-CT', '254837009')?.id).toBe('brca');
  });

  it('returns undefined for a SNOMED-CT code with no curated match (no category fallback for SNOMED)', () => {
    expect(catalog.byCode('SNOMED-CT', '000000000')).toBeUndefined();
  });

  it('returns undefined for an empty or whitespace-only code', () => {
    expect(catalog.byCode('ICD-10-CM', '')).toBeUndefined();
    expect(catalog.byCode('ICD-10-CM', '   ')).toBeUndefined();
  });
});

describe('conditionFromCode', () => {
  it('produces the long-tail shape for an ICD-10-CM code: id===code, cat "other", base 0, icd10 set', () => {
    const cond = conditionFromCode('ICD-10-CM', 'S72.001A', 'Fracture of neck of right femur');
    expect(cond).toEqual({
      id: 'S72.001A',
      name: 'Fracture of neck of right femur',
      cat: 'other',
      base: 0,
      pattern: '—',
      icd10: 'S72.001A',
    });
    expect(cond.snomed).toBeUndefined();
  });

  it('produces the long-tail shape for a SNOMED-CT code: id===code, cat "other", base 0, snomed set', () => {
    const cond = conditionFromCode('SNOMED-CT', '444814009', 'Rare inherited metabolic disorder');
    expect(cond).toEqual({
      id: '444814009',
      name: 'Rare inherited metabolic disorder',
      cat: 'other',
      base: 0,
      pattern: '—',
      snomed: '444814009',
    });
    expect(cond.icd10).toBeUndefined();
  });
});

describe('fallbackCondition', () => {
  it('produces a generic stand-in', () => {
    expect(fallbackCondition('X').name).toBe('X');
  });
});

describe('sanitizeExtensions', () => {
  const good: Condition = { id: 'x1', name: 'Long tail', cat: 'other', base: 0.1, pattern: '—' };

  it('keeps well-formed extensions', () => {
    expect(sanitizeExtensions([good])).toEqual([good]);
  });

  it('returns [] for non-array input', () => {
    expect(sanitizeExtensions(undefined)).toEqual([]);
    expect(sanitizeExtensions('nope')).toEqual([]);
  });

  it('drops malformed shapes and unknown categories', () => {
    expect(sanitizeExtensions([{ id: 'x' }])).toEqual([]);
    expect(
      sanitizeExtensions([{ id: 'x', name: 'n', cat: 'bogus', base: 1, pattern: 'p' }]),
    ).toEqual([]);
  });

  it('never lets an extension shadow a curated condition', () => {
    const curatedId = CONDITIONS[0].id;
    expect(
      sanitizeExtensions([{ id: curatedId, name: 'Fake', cat: 'other', base: 9, pattern: 'x' }]),
    ).toEqual([]);
  });

  it('dedupes by id (first wins)', () => {
    const out = sanitizeExtensions([good, { ...good, name: 'Dup' }]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Long tail');
  });
});
