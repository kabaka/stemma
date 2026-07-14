import { describe, expect, it } from 'vitest';
import { seedRecord } from '@/data/seed';
import { buildCatalog } from '@/domain/catalog';
import { detectPatterns, familyFindings } from './patterns';
import {
  ancestors,
  childrenOf,
  computeLayout,
  degreeLong,
  degreeShort,
  indexPeople,
  parentsOf,
  relationInfo,
  segments,
} from './graph';

const record = seedRecord();
const idx = indexPeople(record.people, record.unions);
const catalog = buildCatalog([]);
const AS_OF = 2026;

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

  it('distinguishes paternal vs maternal cousin side', () => {
    // Ray: son of Tom, Robert's brother — a paternal-side cousin.
    const ray = relationInfo(idx, 'ray', 'you');
    // Mia: daughter of Linda, Susan's sister — a maternal-side cousin.
    const mia = relationInfo(idx, 'mia', 'you');
    expect(ray.side).toBe('Paternal');
    expect(mia.side).toBe('Maternal');
  });

  it('bins a first cousin at the 3rd-degree boundary (r ≈ 0.125)', () => {
    const ray = relationInfo(idx, 'ray', 'you');
    expect(ray.degree).toBe(3);
    expect(ray.r).toBeCloseTo(0.125, 5);
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

describe('segments', () => {
  const layout = computeLayout(record.people);
  const segs = segments(record.unions, layout.pos);

  it('draws a partner bar between two unioned parents at equal cy', () => {
    const robert = layout.pos.robert;
    const susan = layout.pos.susan;
    expect(segs).toContainEqual({ x1: robert.x, y1: robert.cy, x2: susan.x, y2: susan.cy });
    expect(robert.cy).toBe(susan.cy);
  });

  it("draws a sibling bus spanning Robert+Susan's 3 children (Jack, Maya, Emma)", () => {
    const kids = ['jack', 'you', 'emma'].map((id) => layout.pos[id]);
    const busY = kids[0].y - 22;
    const minX = Math.min(...kids.map((k) => k.x));
    const maxX = Math.max(...kids.map((k) => k.x));
    expect(segs).toContainEqual({ x1: minX, y1: busY, x2: maxX, y2: busY });
  });

  it('drops a vertical line from the sibling bus down to each child', () => {
    const jack = layout.pos.jack;
    const busY = jack.y - 22;
    expect(segs).toContainEqual({ x1: jack.x, y1: busY, x2: jack.x, y2: jack.y });
  });
});

describe('re-rooting from a non-proband (Helen)', () => {
  it('still raises the HBOC referral when detectPatterns is rooted at Helen', () => {
    // Linda (daughter, degree 1, onset 47) and Mia (granddaughter, degree 2, onset 28)
    // are blood relatives of Helen with early-onset breast cancer.
    const flags = detectPatterns(seedRecord(), catalog, 'helen', AS_OF);
    const hboc = flags.find((f) => /hereditary breast/i.test(f.title));
    expect(hboc).toBeDefined();
    expect(hboc!.severity).toBe('referral');
  });

  it('phrases an age-of-onset criterion in the third person ("Helen is"), not "you are"', () => {
    const rerooted = seedRecord();
    // Rosa is Helen's mother (1st-degree). Her age-of-onset (82) lands within the proximity
    // window of Helen's own age (84 in AS_OF 2026), which the unmodified seed never triggers.
    rerooted.people.find((p) => p.id === 'rosa')!.conds.push({ id: 'oa', onset: 82, prov: 'self' });
    const flags = detectPatterns(rerooted, catalog, 'helen', AS_OF);
    const alert = flags.find((f) => /age-of-onset/i.test(f.title));
    expect(alert).toBeDefined();
    expect(alert!.criterion).toMatch(/Helen is 84/);
    expect(alert!.criterion).not.toMatch(/you are/i);
  });

  it("marks Helen's own condition as Diagnosed in familyFindings rooted at Helen", () => {
    const findings = familyFindings(seedRecord(), catalog, 'helen');
    const brca = findings.find((f) => f.id === 'brca');
    expect(brca).toBeDefined();
    expect(brca!.diagnosed).toBe(true);
    expect(brca!.band).toBe('Diagnosed');
  });
});
