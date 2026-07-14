import { describe, expect, it } from 'vitest';
import { CONDITIONS, COMMON_CONDITIONS } from '@/data/conditions';
import { CATEGORY_LABELS } from '@/data/categories';
import { createCatalog, fallbackCondition } from './catalog';

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
});

describe('fallbackCondition', () => {
  it('produces a generic stand-in', () => {
    expect(fallbackCondition('X').name).toBe('X');
  });
});
