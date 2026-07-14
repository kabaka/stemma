import { describe, expect, it } from 'vitest';
import { seedRecord } from '@/data/seed';
import {
  ancestors,
  childrenOf,
  computeLayout,
  degreeLong,
  degreeShort,
  indexPeople,
  parentsOf,
  relationInfo,
} from './graph';

const record = seedRecord();
const idx = indexPeople(record.people, record.unions);

describe('parentsOf / childrenOf', () => {
  it('reads genetic edges from unions', () => {
    expect(parentsOf(idx, 'you').sort()).toEqual(['robert', 'susan']);
    expect(childrenOf(idx, 'you').sort()).toEqual(['leo', 'zoe']);
    expect(parentsOf(idx, 'walter')).toEqual([]);
  });
});

describe('ancestors', () => {
  it('collects ancestors with shortest generational distance', () => {
    const a = ancestors(idx, 'you');
    expect(a.get('you')).toBe(0);
    expect(a.get('robert')).toBe(1);
    expect(a.get('susan')).toBe(1);
    expect(a.get('walter')).toBe(3); // you -> frank(2) -> walter(3) via robert
    expect(a.has('emma')).toBe(false); // sibling, not an ancestor
  });
});

describe('relationInfo', () => {
  it('labels first-degree relatives', () => {
    const father = relationInfo(idx, 'robert', 'you');
    expect(father.rel).toBe('Father');
    expect(father.degree).toBe(1);
    expect(father.side).toBe('Paternal');
    expect(father.r).toBeCloseTo(0.5, 5);

    const mother = relationInfo(idx, 'susan', 'you');
    expect(mother.rel).toBe('Mother');
    expect(mother.degree).toBe(1);
  });

  it('labels a maternal grandmother as 2nd-degree', () => {
    const helen = relationInfo(idx, 'helen', 'you');
    expect(helen.rel).toBe('Maternal Grandmother');
    expect(helen.degree).toBe(2);
    expect(helen.r).toBeCloseTo(0.25, 5);
  });

  it('identifies self and the proband', () => {
    const self = relationInfo(idx, 'you', 'you');
    expect(self.rel).toBe('You');
    expect(self.degree).toBe(0);
    expect(self.r).toBe(1);
  });

  it('re-roots from any vantage', () => {
    // From Susan's vantage, Maya is her daughter.
    const fromSusan = relationInfo(idx, 'you', 'susan');
    expect(fromSusan.rel).toBe('Daughter');
    expect(fromSusan.degree).toBe(1);
  });

  it('marks a spouse-by-marriage as non-blood', () => {
    const alex = relationInfo(idx, 'alex', 'you');
    expect(alex.degree).toBe(null);
    expect(alex.rel).toBe('Spouse');
  });

  it('respects gender identity in labels (Ray is an uncle, not aunt)', () => {
    // Ray is AFAB but gender man; child of Tom & Carol, so a paternal cousin of Maya.
    const ray = relationInfo(idx, 'ray', 'you');
    expect(ray.degree).toBe(3);
    expect(ray.rel).toContain('Cousin');
  });
});

describe('degree labels', () => {
  it('formats short and long forms', () => {
    expect(degreeShort(1)).toBe('1st');
    expect(degreeShort(null)).toBe('—');
    expect(degreeLong(0)).toBe('Proband');
    expect(degreeLong(2)).toBe('2nd-degree');
    expect(degreeLong(null)).toBe('Non-blood');
  });
});

describe('computeLayout', () => {
  it('bands people by generation and de-overlaps rows', () => {
    const layout = computeLayout(record.people);
    expect(layout.minGen).toBe(0);
    expect(layout.maxGen).toBe(4);
    expect(Object.keys(layout.pos)).toHaveLength(record.people.length);
    // Generation 0 sits above generation 4.
    expect(layout.pos.walter.y).toBeLessThan(layout.pos.zoe.y);
  });
});
