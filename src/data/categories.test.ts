import { describe, expect, it } from 'vitest';
import { buildCatalog } from '@/domain/catalog';
import type { Person } from '@/domain/types';
import { CATEGORIES, legendCategories } from './categories';

const catalog = buildCatalog([]);

function mkPerson(id: string, condIds: string[]): Person {
  return {
    id,
    name: id,
    sab: 'u',
    gender: 'nb',
    gen: 0,
    x: 0,
    dead: false,
    birth: null,
    death: null,
    conds: condIds.map((cid) => ({ id: cid, onset: null, prov: 'self' })),
  };
}

describe('legendCategories', () => {
  it('lists only the categories actually present among the given people (canonical order, not insertion order)', () => {
    // brca -> 'canc', t2d -> 'endo', cad -> 'card'. Recorded here canc-then-endo-then-card,
    // deliberately out of CATEGORIES' canonical key order, to prove the function reorders.
    const people = [mkPerson('a', ['brca']), mkPerson('b', ['t2d']), mkPerson('c', ['cad'])];
    const cats = legendCategories(people, catalog);
    const canonicalOrder = Object.keys(CATEGORIES);
    // Every returned category is present, ordered by its index in the canonical key list.
    const indices = cats.map((c) => canonicalOrder.indexOf(c));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(cats).toEqual(['card', 'canc', 'endo']);
  });

  it('excludes categories with no representative among the given people', () => {
    const people = [mkPerson('a', ['brca'])];
    const cats = legendCategories(people, catalog);
    expect(cats).toEqual(['canc']);
    expect(cats).not.toContain('card');
    expect(cats).not.toContain('endo');
  });

  it('returns an empty list for people with no conditions', () => {
    const people = [mkPerson('a', []), mkPerson('b', [])];
    expect(legendCategories(people, catalog)).toEqual([]);
  });

  it('returns an empty list for an empty pedigree window', () => {
    expect(legendCategories([], catalog)).toEqual([]);
  });
});
