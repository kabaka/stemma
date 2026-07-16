import { describe, expect, it } from 'vitest';
import { seedRecord } from '@/data/seed';
import { buildCatalog } from '@/domain/catalog';
import { layoutFromGraph, removePerson } from './record';
import type { FamilyRecord, Person, Union } from './types';
import { detectPatterns, familyFindings } from './patterns';
import {
  ancestors,
  childrenOf,
  computeLayout,
  degreeLong,
  degreeShort,
  indexPeople,
  offsetParallel,
  parentsOf,
  relationInfo,
  segments,
  type LayoutNode,
  type Segment,
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
    // A spouse shares no ancestry (r=0) — `blood` is false — but the spouse check outranks
    // the blood ternary in relLabel, so the label still reads 'Spouse', never "By marriage".
    expect(alex.blood).toBe(false);
  });

  it('respects gender identity, not sex assigned at birth, in a gendered label (Uncle vs Aunt)', () => {
    // The seed's Ray (AFAB, gender man) is a Cousin from Maya's vantage — but relLabel's
    // pick() is NEVER invoked for a plain "Cousin" (only the Half-sibling branch uses it),
    // so the original version of this test asserting `.toContain('Cousin')` could not
    // actually exercise gender at all; it passed unconditionally regardless of Ray's gender.
    // Rebuild the same "sab disagrees with gender" shape one generation up, where relLabel
    // DOES pick a gendered word (gd === -1 → Uncle/Aunt), so the assertion can actually fail
    // under a wrong-but-plausible implementation that read `sab` instead of `gender`.
    const mk = (id: string, overrides: Partial<Person>): Person => ({
      id,
      name: id,
      sab: 'u',
      gender: 'nb',
      gen: 0,
      x: 0,
      dead: false,
      birth: null,
      death: null,
      conds: [],
      ...overrides,
    });
    const people: Person[] = [
      mk('grandpa', { sab: 'm', gender: 'man', gen: 0 }),
      mk('grandma', { sab: 'f', gender: 'woman', gen: 0 }),
      mk('dad', { sab: 'm', gender: 'man', gen: 1 }),
      // Mirrors the seed's Ray: sab 'f' (AFAB) but gender identity 'man' — sab and gender
      // deliberately disagree so a label driven by the wrong field is caught.
      mk('uncleAfab', { sab: 'f', gender: 'man', gen: 1 }),
      // The mirror image: sab 'm' (AMAB) but gender identity 'woman'.
      mk('auntAmab', { sab: 'm', gender: 'woman', gen: 1 }),
      mk('mom', { sab: 'f', gender: 'woman', gen: 1 }),
      mk('root', { sab: 'f', gender: 'woman', gen: 2, isProband: true }),
    ];
    const unions: Union[] = [
      { parents: ['grandpa', 'grandma'], children: ['dad', 'uncleAfab', 'auntAmab'] },
      { parents: ['dad', 'mom'], children: ['root'] },
    ];
    const localIdx = indexPeople(people, unions);

    const uncle = relationInfo(localIdx, 'uncleAfab', 'root');
    expect(uncle.degree).toBe(2);
    expect(uncle.rel).toBe('Paternal Uncle'); // gender 'man' wins despite sab 'f'

    const aunt = relationInfo(localIdx, 'auntAmab', 'root');
    expect(aunt.degree).toBe(2);
    expect(aunt.rel).toBe('Paternal Aunt'); // gender 'woman' wins despite sab 'm'
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
  it('bands people by generation and returns a position for everyone', () => {
    const layout = computeLayout(record.people, record.unions);
    expect(layout.minGen).toBe(0);
    expect(layout.maxGen).toBe(4);
    expect(Object.keys(layout.pos)).toHaveLength(record.people.length);
    // Generation 0 sits above generation 4.
    expect(layout.pos.walter.y).toBeLessThan(layout.pos.zoe.y);
  });

  it('keeps at least the minimum horizontal gap between neighbours in a row', () => {
    const layout = computeLayout(record.people, record.unions);
    for (const g of layout.gens) {
      const xs = record.people
        .filter((p) => p.gen === g)
        .map((p) => layout.pos[p.id].x)
        .sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(95); // H_GAP (96) minus rounding slack
      }
    }
  });

  it('is deterministic — the same record lays out identically twice (idempotent)', () => {
    const a = computeLayout(record.people, record.unions);
    const b = computeLayout(record.people, record.unions);
    expect(a.pos).toEqual(b.pos);
    expect(a.cw).toBe(b.cw);
    expect(a.ch).toBe(b.ch);
  });

  it('centres a couple’s children under the middle of their partner bar', () => {
    const layout = computeLayout(record.people, record.unions);
    // Robert + Susan → Jack, Maya, Emma. The midpoint of the parents should sit within the
    // horizontal span of their children (so the drop line lands on the sibling bus).
    const mx = (layout.pos.robert.x + layout.pos.susan.x) / 2;
    const kidsX = ['jack', 'you', 'emma'].map((id) => layout.pos[id].x);
    expect(mx).toBeGreaterThanOrEqual(Math.min(...kidsX) - 1);
    expect(mx).toBeLessThanOrEqual(Math.max(...kidsX) + 1);
  });

  it('works without unions (Overview call site) — still bands by generation', () => {
    const layout = computeLayout(record.people);
    expect(layout.minGen).toBe(0);
    expect(layout.maxGen).toBe(4);
    expect(Object.keys(layout.pos)).toHaveLength(record.people.length);
  });

  it('handles an empty people list', () => {
    const layout = computeLayout([], []);
    expect(layout.pos).toEqual({});
    expect(layout.gens).toEqual([]);
  });
});

/** Are `(ax,ay)` and `(bx,by)` in the same connected component of the drawn (axis-aligned)
 * segment network? Union-find with T-junction support: any query point lying on a segment is
 * connected to that segment's endpoints, so a jogged line of descent (riser → jog → drop) is
 * traced end to end just like a plain vertical. */
function pathConnects(segs: Segment[], ax: number, ay: number, bx: number, by: number): boolean {
  const key = (x: number, y: number): string => `${Math.round(x * 10)},${Math.round(y * 10)}`;
  const parent = new Map<string, string>();
  const add = (k: string): void => {
    if (!parent.has(k)) parent.set(k, k);
  };
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) {
      parent.set(r, parent.get(parent.get(r)!)!);
      r = parent.get(r)!;
    }
    return r;
  };
  const union = (p: string, q: string): void => {
    add(p);
    add(q);
    parent.set(find(p), find(q));
  };
  const pts: Array<[number, number]> = [
    [ax, ay],
    [bx, by],
  ];
  for (const s of segs) {
    pts.push([s.x1, s.y1]);
    pts.push([s.x2, s.y2]);
  }
  for (const [x, y] of pts) add(key(x, y));
  const onSeg = (s: Segment, x: number, y: number): boolean => {
    if (
      x < Math.min(s.x1, s.x2) - 0.05 ||
      x > Math.max(s.x1, s.x2) + 0.05 ||
      y < Math.min(s.y1, s.y2) - 0.05 ||
      y > Math.max(s.y1, s.y2) + 0.05
    )
      return false;
    return Math.abs((s.x2 - s.x1) * (y - s.y1) - (s.y2 - s.y1) * (x - s.x1)) < 0.5;
  };
  for (const s of segs) {
    const end = key(s.x1, s.y1);
    union(end, key(s.x2, s.y2));
    for (const [x, y] of pts) if (onSeg(s, x, y)) union(key(x, y), end);
  }
  return find(key(ax, ay)) === find(key(bx, by));
}

/** For every union with parents and children, the line of descent from the parents' midpoint
 * must actually reach at least one child through the drawn network. Returns the ids of any
 * union whose descent floats free — the defect the connector fix guards against. Each union is
 * traced in isolation (its own segments only) so connectivity can't leak through a neighbour. */
function disconnectedUnions(unions: Union[], pos: Record<string, LayoutNode>): string[][] {
  const bad: string[][] = [];
  for (const u of unions) {
    const parts = u.parents.filter((id) => pos[id]);
    const kids = (u.children ?? []).filter((id) => pos[id]);
    if (!kids.length || !parts.length) continue; // parentless group: no line of descent to trace
    const segs = segments([u], pos);
    const mx = parts.reduce((s, id) => s + pos[id].x, 0) / parts.length;
    const py = pos[parts[0]].cy;
    if (!kids.some((cid) => pathConnects(segs, mx, py, pos[cid].x, pos[cid].y)))
      bad.push(u.parents);
  }
  return bad;
}

/** Collinear, same-y horizontal segments whose x-ranges overlap — two drawn lines merged into
 * one, which a reader cannot disambiguate. Empty for a standard-adherent layout. */
function overlappingHorizontals(segs: Segment[]): string[] {
  const hor = segs
    .filter((s) => Math.abs(s.y1 - s.y2) < 0.01)
    .map((s) => ({ y: s.y1, lo: Math.min(s.x1, s.x2), hi: Math.max(s.x1, s.x2) }));
  const out: string[] = [];
  for (let i = 0; i < hor.length; i++)
    for (let j = i + 1; j < hor.length; j++) {
      if (Math.abs(hor[i].y - hor[j].y) > 0.01) continue;
      if (Math.min(hor[i].hi, hor[j].hi) - Math.max(hor[i].lo, hor[j].lo) > 0.5)
        out.push(
          `y=${Math.round(hor[i].y)} [${Math.round(Math.max(hor[i].lo, hor[j].lo))},${Math.round(
            Math.min(hor[i].hi, hor[j].hi),
          )}]`,
        );
    }
  return out;
}

describe('segments', () => {
  const layout = computeLayout(record.people, record.unions);
  const segs = segments(record.unions, layout.pos);

  it('draws a partner bar between two unioned parents at equal cy', () => {
    const robert = layout.pos.robert;
    const susan = layout.pos.susan;
    // Every relationship-line segment now explicitly carries `double` (true for a
    // consanguineous union, false otherwise — see the `consanguinity` describe block below).
    expect(segs).toContainEqual({
      x1: robert.x,
      y1: robert.cy,
      x2: susan.x,
      y2: susan.cy,
      double: false,
    });
    expect(robert.cy).toBe(susan.cy);
  });

  it("draws a sibling bus spanning at least Robert+Susan's 3 children (Jack, Maya, Emma)", () => {
    const kids = ['jack', 'you', 'emma'].map((id) => layout.pos[id]);
    const busY = kids[0].y - 22;
    const minX = Math.min(...kids.map((k) => k.x));
    const maxX = Math.max(...kids.map((k) => k.x));
    // Several families' buses share this Y; at least one (theirs) covers the children span
    // (and, if needed, extends to the parents' descent point).
    const covers = segs.some(
      (s) =>
        s.y1 === busY &&
        s.y2 === busY &&
        Math.min(s.x1, s.x2) <= minX + 0.01 &&
        Math.max(s.x1, s.x2) >= maxX - 0.01,
    );
    expect(covers).toBe(true);
  });

  it('drops a vertical line from the sibling bus down to each child', () => {
    const jack = layout.pos.jack;
    const busY = jack.y - 22;
    expect(segs).toContainEqual({ x1: jack.x, y1: busY, x2: jack.x, y2: jack.y });
  });

  it('connects every parent drop line to its sibling bus (no floating descents) in the seed', () => {
    expect(disconnectedUnions(record.unions, layout.pos)).toEqual([]);
  });
});

describe('large / imported tree layout (regression for unreadable connectors)', () => {
  const mk = (id: string): Person => ({
    id,
    name: id,
    sab: 'u',
    gender: 'nb',
    gen: 0,
    x: 0,
    dead: false,
    birth: null,
    death: null,
    conds: [],
  });

  // An imported-style tree (gen/x derived by layoutFromGraph, exactly as GEDCOM import does):
  // four founder couples, cross-family marriages, grandchildren — the shape that produced
  // the reported "descent line floats away from the sibling bus" defect.
  function importedTree(): FamilyRecord {
    const people: Person[] = [];
    const unions: Union[] = [];
    for (let f = 0; f < 4; f++) {
      people.push(mk(`f${f}a`), mk(`f${f}b`));
      unions.push({ parents: [`f${f}a`, `f${f}b`], children: [`c${f}0`, `c${f}1`] });
      people.push(mk(`c${f}0`), mk(`c${f}1`));
    }
    people.push(mk('gc0'), mk('gc1'), mk('gc2'), mk('gc3'));
    unions.push({ parents: ['c00', 'c10'], children: ['gc0', 'gc1'] });
    unions.push({ parents: ['c20', 'c30'], children: ['gc2', 'gc3'] });
    return layoutFromGraph({ people, unions, timeline: [], probandId: 'gc0' });
  }

  it('connects every parent drop line to its sibling bus', () => {
    const rec = importedTree();
    const { pos } = computeLayout(rec.people, rec.unions);
    expect(disconnectedUnions(rec.unions, pos)).toEqual([]);
  });

  it('keeps every partner bar short (a small, bounded number of cells, never row-wide)', () => {
    const rec = importedTree();
    const { pos } = computeLayout(rec.people, rec.unions);
    for (const u of rec.unions) {
      if (u.parents.length !== 2) continue;
      const width = Math.abs(pos[u.parents[0]].x - pos[u.parents[1]].x);
      // Keeping each partner in their own contiguous sibship means a marriage *between* two
      // in-tree families spans the gap between their two blocks (~2 cells here) rather than
      // interleaving them — still a short, bounded bar, never proportional to the row width.
      expect(width).toBeLessThanOrEqual(96 * 2); // ≤ 2 cells, not the 8-cell row-wide tangle
    }
  });

  it('lays out a windowed subset with the full union set (SVG export scenario) without crashing', () => {
    const rec = importedTree();
    // Mimic pedigree-svg: keep only two generations but pass ALL unions (many now point at
    // people outside the window). Must not throw and must position every included person.
    const included = rec.people.filter((p) => p.gen >= 1 && p.gen <= 2);
    const { pos } = computeLayout(included, rec.unions);
    expect(Object.keys(pos).sort()).toEqual(included.map((p) => p.id).sort());
    for (const p of included) expect(Number.isFinite(pos[p.id].x)).toBe(true);
    // The in-window union (c00×c10 → gc0,gc1) still connects.
    expect(disconnectedUnions(rec.unions, pos)).toEqual([]);
  });
});

/** Left-to-right id order of each generation, by laid-out x. */
function rowsByGen(people: Person[], pos: Record<string, LayoutNode>): Map<number, string[]> {
  const rows = new Map<number, string[]>();
  for (const p of people) {
    const a = rows.get(p.gen);
    if (a) a.push(p.id);
    else rows.set(p.gen, [p.id]);
  }
  for (const [, ids] of rows) ids.sort((a, b) => pos[a].x - pos[b].x);
  return rows;
}

/** A person is "expected" under a union's sibling bus only if they're a child of it or the
 * married-in partner of one of those children — anyone else between the first and last child
 * is an unrelated interloper (the reported defect). */
function unrelatedUnderBus(rec: FamilyRecord, pos: Record<string, LayoutNode>): string[][] {
  const rows = rowsByGen(rec.people, pos);
  const genOf = new Map(rec.people.map((p) => [p.id, p.gen]));
  const bad: string[][] = [];
  for (const u of rec.unions) {
    const kids = (u.children ?? []).filter((id) => pos[id]);
    if (kids.length < 2) continue;
    const row = rows.get(genOf.get(kids[0])!)!;
    const positions = kids.map((k) => row.indexOf(k)).sort((a, b) => a - b);
    const span = row.slice(positions[0], positions[positions.length - 1] + 1);
    const intruders = span.filter(
      (id) =>
        !kids.includes(id) &&
        !kids.some((k) => rec.unions.some((v) => v.parents.includes(k) && v.parents.includes(id))),
    );
    if (intruders.length) bad.push(intruders);
  }
  return bad;
}

/** X-range each union's sibship line occupies — its children only, per the NSGC convention
 * (the line of descent's offset is carried by a jog, never by widening this line). */
function busOverlaps(rec: FamilyRecord, pos: Record<string, LayoutNode>): string[] {
  const genOf = new Map(rec.people.map((p) => [p.id, p.gen]));
  const ranges = rec.unions
    .map((u) => {
      const kids = (u.children ?? []).filter((id) => pos[id]);
      if (!kids.length) return null;
      const cxs = kids.map((id) => pos[id].x);
      return {
        gen: genOf.get(kids[0])!,
        label: u.parents.join('+'),
        min: Math.min(...cxs),
        max: Math.max(...cxs),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null);
  const clashes: string[] = [];
  for (let i = 0; i < ranges.length; i++)
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i];
      const b = ranges[j];
      if (a.gen === b.gen && Math.min(a.max, b.max) - Math.max(a.min, b.min) > 0.01)
        clashes.push(`${a.label} vs ${b.label}`);
    }
  return clashes;
}

describe('sibship contiguity and remarriage (regression for merged lineage lines)', () => {
  const mk = (id: string): Person => ({
    id,
    name: id,
    sab: 'u',
    gender: 'nb',
    gen: 0,
    x: 0,
    dead: false,
    birth: null,
    death: null,
    conds: [],
  });

  // Four founder couples, each with 3 children; a cross-family marriage; and a remarriage
  // (one person with two married-in spouses). Reproduces the reported "unrelated people share
  // one lineage line" and "divorce/marriage overlapping lines" defects.
  function tangledTree(): FamilyRecord {
    const people: Person[] = [];
    const unions: Union[] = [];
    const kidsByCouple: string[][] = [];
    for (let i = 0; i < 4; i++) {
      const a = `f${i}a`,
        b = `f${i}b`;
      people.push(mk(a), mk(b));
      const kids = [`c${i}0`, `c${i}1`, `c${i}2`];
      kids.forEach((k) => people.push(mk(k)));
      unions.push({ parents: [a, b], children: kids });
      kidsByCouple.push(kids);
    }
    // cross-family marriage: c01 × c11 → two children
    people.push(mk('gc0'), mk('gc1'));
    unions.push({ parents: [kidsByCouple[0][1], kidsByCouple[1][1]], children: ['gc0', 'gc1'] });
    // remarriage: c20 marries spouse X (→ rx) and spouse Y (→ ry)
    people.push(mk('spX'), mk('spY'), mk('rx'), mk('ry'));
    unions.push({ parents: [kidsByCouple[2][0], 'spX'], children: ['rx'] });
    unions.push({ parents: [kidsByCouple[2][0], 'spY'], children: ['ry'] });
    return layoutFromGraph({ people, unions, timeline: [], probandId: 'gc0' });
  }

  it('never draws an unrelated person under a sibling bus', () => {
    const rec = tangledTree();
    const { pos } = computeLayout(rec.people, rec.unions);
    expect(unrelatedUnderBus(rec, pos)).toEqual([]);
  });

  it('never overlaps two different unions’ sibling buses in the same generation', () => {
    const rec = tangledTree();
    const { pos } = computeLayout(rec.people, rec.unions);
    expect(busOverlaps(rec, pos)).toEqual([]);
  });

  it('places a remarried person between their two spouses, each marriage connecting its child', () => {
    const rec = tangledTree();
    const { pos } = computeLayout(rec.people, rec.unions);
    // c20 married both spX and spY: c20 sits between them.
    const [xX, xC, xY] = [pos.spX.x, pos.c20.x, pos.spY.x];
    expect((xX < xC && xC < xY) || (xY < xC && xC < xX)).toBe(true);
    // Both marriages' children still connect to their own bar.
    expect(disconnectedUnions(rec.unions, pos)).toEqual([]);
  });

  it('handles a person married to two siblings of the same sibship without blowing up', () => {
    // Divorce-then-marry-the-sibling (or a sororate/levirate remarriage): `x` is the spouse
    // of both `s1` and `s2`, who are siblings. Each person must appear exactly once and the
    // canvas must stay bounded — a duplicated node here compounds across ordering rounds.
    const rec = layoutFromGraph({
      people: ['dad', 'mom', 's1', 's2', 'x', 'k1', 'k2'].map(mk),
      unions: [
        { parents: ['dad', 'mom'], children: ['s1', 's2'] },
        { parents: ['s1', 'x'], children: ['k1'] },
        { parents: ['s2', 'x'], children: ['k2'] },
      ],
      timeline: [],
      probandId: 'k1',
    });
    const layout = computeLayout(rec.people, rec.unions);
    // Every person positioned exactly once, no phantom coordinates.
    expect(Object.keys(layout.pos).sort()).toEqual(rec.people.map((p) => p.id).sort());
    // Canvas stays sane (a duplication bug ballooned this to millions of px).
    expect(layout.cw).toBeLessThan(2000);
    for (const p of rec.people) expect(Number.isFinite(layout.pos[p.id].x)).toBe(true);
  });

  it('keeps the seed and imported trees free of unrelated bus intruders', () => {
    for (const rec of [seedRecord()]) {
      const { pos } = computeLayout(rec.people, rec.unions);
      expect(unrelatedUnderBus(rec, pos)).toEqual([]);
      expect(busOverlaps(rec, pos)).toEqual([]);
      // No two drawn horizontals merge into one line anywhere in the whole layout.
      expect(overlappingHorizontals(segments(rec.unions, pos))).toEqual([]);
    }
  });

  it('places a cross-family couple (with a child) adjacent, not with others drawn between', () => {
    // Two families each with three children; one child from each marries the other and they
    // have a child — the reported "bar drawn straight across the row from mother to father,
    // through unrelated people" case. Their sibships stay contiguous AND the couple is adjacent.
    const rec = layoutFromGraph({
      people: ['a1', 'a2', 'b1', 'b2', 'ax', 'ay', 'az', 'bx', 'by', 'bz', 'kid'].map(mk),
      unions: [
        { parents: ['a1', 'a2'], children: ['ax', 'ay', 'az'] },
        { parents: ['b1', 'b2'], children: ['bx', 'by', 'bz'] },
        { parents: ['ay', 'by'], children: ['kid'] }, // middle children of each family marry
      ],
      timeline: [],
      probandId: 'kid',
    });
    const { pos } = computeLayout(rec.people, rec.unions);
    expect(Math.abs(pos.ay.x - pos.by.x)).toBeLessThanOrEqual(96 + 0.5); // one cell apart
    const gen = rec.people.find((p) => p.id === 'ay')!.gen;
    const lo = Math.min(pos.ay.x, pos.by.x);
    const hi = Math.max(pos.ay.x, pos.by.x);
    const between = rec.people
      .filter((p) => p.gen === gen && pos[p.id].x > lo + 0.5 && pos[p.id].x < hi - 0.5)
      .map((p) => p.id);
    expect(between).toEqual([]);
  });

  it('bridges two sibships through a founder who has a child in each (no bar across the row)', () => {
    // `z` is a founder (no parents in view) who has a child with `a2` (sibship A) and another
    // with `b2` (sibship B). A founder with real children must be treated as a chain node, not
    // a held-out leaf — otherwise the two child-bearing marriages never bridge the sibships and
    // z's bar to b2 is drawn across A's siblings.
    const rec = layoutFromGraph({
      people: ['ga1', 'ga2', 'gb1', 'gb2', 'a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'z', 'ka', 'kb'].map(
        mk,
      ),
      unions: [
        { parents: ['ga1', 'ga2'], children: ['a1', 'a2', 'a3'] },
        { parents: ['gb1', 'gb2'], children: ['b1', 'b2', 'b3'] },
        { parents: ['a2', 'z'], children: ['ka'] },
        { parents: ['z', 'b2'], children: ['kb'] },
      ],
      timeline: [],
      probandId: 'ka',
    });
    const { pos } = computeLayout(rec.people, rec.unions);
    // z sits directly between its two co-parents, adjacent to each.
    expect(Math.abs(pos.z.x - pos.a2.x)).toBeLessThanOrEqual(96 + 0.5);
    expect(Math.abs(pos.z.x - pos.b2.x)).toBeLessThanOrEqual(96 + 0.5);
  });

  it('keeps a nuclear couple adjacent even when one partner has extra childless marriages', () => {
    // `you` married `w` (child `kid`) and also `w2`, `w3` (childless). The child-bearing couple
    // must be adjacent; the extra spouses sit nearby but never wedge between you and w.
    const rec = layoutFromGraph({
      people: ['ga', 'gb', 'you', 'sib', 'w', 'w2', 'w3', 'kid'].map(mk),
      unions: [
        { parents: ['ga', 'gb'], children: ['you', 'sib'] },
        { parents: ['you', 'w'], children: ['kid'] },
        { parents: ['you', 'w2'], children: [] },
        { parents: ['you', 'w3'], children: [] },
      ],
      timeline: [],
      probandId: 'kid',
    });
    const { pos } = computeLayout(rec.people, rec.unions);
    expect(Math.abs(pos.you.x - pos.w.x)).toBeLessThanOrEqual(96 + 0.5); // nuclear couple adjacent
  });
});

describe('multi-mating half-siblings (regression for merged lines of descent)', () => {
  const mk = (id: string, gen: number): Person => ({
    id,
    name: id,
    sab: 'u',
    gender: 'nb',
    gen,
    x: 0,
    dead: false,
    birth: null,
    death: null,
    conds: [],
  });

  // Kim has a child with Matt (Alexis) AND a child by a partner not in the file (Matthew Allan,
  // a half-sibling); Matt also has children by an earlier, unshown partner (Kevin, R1, R2).
  // Asymmetric sibship sizes push the children off-centre from their parents, which used to make
  // Kim's solo line of descent and the couple's line of descent share a horizontal at the same
  // level — so a reader saw the half-sibling hanging off the couple. See the reported defect.
  const rec = (): FamilyRecord =>
    layoutFromGraph({
      people: [
        mk('kdad', 0),
        mk('kmom', 0),
        mk('kim', 1),
        mk('matt', 1),
        mk('mattallan', 2),
        mk('alexis', 2),
        mk('kevin', 2),
        mk('kevsp', 2),
        mk('r1', 2),
        mk('r2', 2),
        mk('gk1', 3),
        mk('gk2', 3),
      ],
      unions: [
        { parents: ['kdad', 'kmom'], children: ['kim'] },
        { parents: ['kim'], children: ['mattallan'] }, // Kim + unshown partner
        { parents: ['kim', 'matt'], children: ['alexis'] },
        { parents: ['matt'], children: ['kevin', 'r1', 'r2'] }, // Matt + unshown partner
        { parents: ['kevin', 'kevsp'], children: ['gk1', 'gk2'] },
      ],
      timeline: [],
      probandId: 'alexis',
    });

  it('never merges two lines of descent into one horizontal', () => {
    const { pos } = computeLayout(rec().people, rec().unions);
    expect(overlappingHorizontals(segments(rec().unions, pos))).toEqual([]);
  });

  it('keeps every union connected to its own children', () => {
    const r = rec();
    const { pos } = computeLayout(r.people, r.unions);
    expect(disconnectedUnions(r.unions, pos)).toEqual([]);
  });

  it('never stretches a sibship line across another union in the same generation', () => {
    const r = rec();
    const { pos } = computeLayout(r.people, r.unions);
    expect(busOverlaps(r, pos)).toEqual([]);
    expect(unrelatedUnderBus(r, pos)).toEqual([]);
  });

  it('draws an exact-duplicate union once, not as two stacked lines of descent', () => {
    // A child whose GEDCOM records the same parentage under two families yields two identical
    // unions; the line of descent must be drawn once, not stacked on two lanes.
    const pos: Record<string, LayoutNode> = {
      kim: { x: 40, y: 40, cy: 64 },
      allan: { x: 160, y: 210, cy: 234 }, // pushed right → the descent jogs
    };
    const once = segments([{ parents: ['kim'], children: ['allan'] }], pos);
    const twice = segments(
      [
        { parents: ['kim'], children: ['allan'] },
        { parents: ['kim'], children: ['allan'] },
      ],
      pos,
    );
    expect(twice).toEqual(once);
  });

  it('separates many overlapping off-centre descents in one generation onto distinct lanes', () => {
    // Twelve single-parent unions whose only child is pushed far to the right, so every line of
    // descent must jog and all their horizontal reaches overlap — well past the ~7 lanes a fixed
    // gap could hold at GEN_HEIGHT. The lanes must compress to stay distinct rather than collapse
    // onto one line (which would silently re-merge descents in a dense generation).
    const pos: Record<string, LayoutNode> = {};
    const unions: Union[] = [];
    for (let k = 0; k < 12; k++) {
      pos[`p${k}`] = { x: k * 4, y: 40, cy: 64 }; // parents clustered on the left
      pos[`c${k}`] = { x: 500 + k * 96, y: 210, cy: 234 }; // children fanned out far right
      unions.push({ parents: [`p${k}`], children: [`c${k}`] });
    }
    expect(overlappingHorizontals(segments(unions, pos))).toEqual([]);
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

// ---------------------------------------------------------------------------
// Defect 2 — half-sibling label + side (relLabel, gd === 0 branch)
// ---------------------------------------------------------------------------

describe('half-siblings (relLabel)', () => {
  const mk = (id: string, overrides: Partial<Person>): Person => ({
    id,
    name: id,
    sab: 'u',
    gender: 'nb',
    gen: 0,
    x: 0,
    dead: false,
    birth: null,
    death: null,
    conds: [],
    ...overrides,
  });

  // dad + mom => root, fullSib (full siblings). dad + otherPartner1 => halfPat (shares only
  // dad). mom + otherPartner2 => halfMat (shares only mom). One fixture exercises both the
  // paternal and maternal half-sibling case, plus a full-sibling control.
  const people: Person[] = [
    mk('dad', { sab: 'm', gender: 'man', gen: 0 }),
    mk('mom', { sab: 'f', gender: 'woman', gen: 0 }),
    mk('otherPartner1', { sab: 'f', gender: 'woman', gen: 0 }),
    mk('otherPartner2', { sab: 'm', gender: 'man', gen: 0 }),
    mk('root', { sab: 'f', gender: 'woman', gen: 1, isProband: true }),
    mk('fullSib', { sab: 'f', gender: 'woman', gen: 1 }),
    mk('halfPat', { sab: 'f', gender: 'woman', gen: 1 }),
    mk('halfMat', { sab: 'm', gender: 'man', gen: 1 }),
  ];
  const unions: Union[] = [
    { parents: ['dad', 'mom'], children: ['root', 'fullSib'] },
    { parents: ['dad', 'otherPartner1'], children: ['halfPat'] },
    { parents: ['mom', 'otherPartner2'], children: ['halfMat'] },
  ];
  const idx = indexPeople(people, unions);

  it('labels a relative sharing only the father as a paternal half-sibling (degree 2, r=0.25)', () => {
    const info = relationInfo(idx, 'halfPat', 'root');
    expect(info.rel).toBe('Paternal Half-sister');
    expect(info.degree).toBe(2);
    expect(info.side).toBe('Paternal');
    expect(info.r).toBeCloseTo(0.25, 5);
  });

  it('labels a relative sharing only the mother as a maternal half-sibling (degree 2, r=0.25)', () => {
    const info = relationInfo(idx, 'halfMat', 'root');
    expect(info.rel).toBe('Maternal Half-brother');
    expect(info.degree).toBe(2);
    expect(info.side).toBe('Maternal');
    expect(info.r).toBeCloseTo(0.25, 5);
  });

  it('still labels a relative sharing BOTH parents as a full sibling, never "Half-"', () => {
    const info = relationInfo(idx, 'fullSib', 'root');
    expect(info.rel).toBe('Sister');
    expect(info.rel).not.toMatch(/half/i);
    expect(info.degree).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Defect 3 — one-parent-recorded side (relationInfo's per-lineage side resolution)
// ---------------------------------------------------------------------------

describe('one-parent-recorded side (relationInfo)', () => {
  const mk = (id: string, overrides: Partial<Person>): Person => ({
    id,
    name: id,
    sab: 'u',
    gender: 'nb',
    gen: 0,
    x: 0,
    dead: false,
    birth: null,
    death: null,
    conds: [],
    ...overrides,
  });

  it("resolves 'Paternal' from a single recorded father, with no mother in the record at all", () => {
    // A normal in-progress pedigree: root has recorded ONLY a father. Before the fix, side
    // was gated on `father && mother` both being present, so it silently went '—' for every
    // relative — even one squarely on the recorded father's own side.
    const people: Person[] = [
      mk('grandpa', { sab: 'm', gender: 'man', gen: 0 }),
      mk('grandma', { sab: 'f', gender: 'woman', gen: 0 }),
      mk('dad', { sab: 'm', gender: 'man', gen: 1 }),
      mk('auntPat', { sab: 'f', gender: 'woman', gen: 1 }),
      mk('root', { sab: 'f', gender: 'woman', gen: 2, isProband: true }),
    ];
    const unions: Union[] = [
      { parents: ['grandpa', 'grandma'], children: ['dad', 'auntPat'] },
      { parents: ['dad'], children: ['root'] }, // root's ONLY recorded parent
    ];
    const idx = indexPeople(people, unions);
    const info = relationInfo(idx, 'auntPat', 'root');
    expect(info.side).toBe('Paternal');
    expect(info.degree).toBe(2);
  });

  it("resolves 'Maternal' from a single recorded mother, with no father in the record at all", () => {
    const people: Person[] = [
      mk('grandpa', { sab: 'm', gender: 'man', gen: 0 }),
      mk('grandma', { sab: 'f', gender: 'woman', gen: 0 }),
      mk('mom', { sab: 'f', gender: 'woman', gen: 1 }),
      mk('uncleMat', { sab: 'm', gender: 'man', gen: 1 }),
      mk('root', { sab: 'f', gender: 'woman', gen: 2, isProband: true }),
    ];
    const unions: Union[] = [
      { parents: ['grandpa', 'grandma'], children: ['mom', 'uncleMat'] },
      { parents: ['mom'], children: ['root'] }, // root's ONLY recorded parent
    ];
    const idx = indexPeople(people, unions);
    const info = relationInfo(idx, 'uncleMat', 'root');
    expect(info.side).toBe('Maternal');
    expect(info.degree).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Defect 4 — RelationInfo.blood: distinguishes a distant blood relative from a true in-law
// ---------------------------------------------------------------------------

describe('RelationInfo.blood — distant blood relatives vs true in-laws', () => {
  it('a great-great-grandparent (r=0.0625, below the 3rd-degree cutoff) is degree null but blood true, labelled "Distant relative"', () => {
    const mk = (id: string, gen: number, overrides: Partial<Person> = {}): Person => ({
      id,
      name: id,
      sab: 'u',
      gender: 'nb',
      gen,
      x: 0,
      dead: false,
      birth: null,
      death: null,
      conds: [],
      ...overrides,
    });
    // A single-parent-per-generation chain, four generations up — deliberately also
    // one-parent-recorded at every level, so side still resolves via Defect 3's fix.
    const people: Person[] = [
      mk('ggg', 0),
      mk('gg', 1),
      mk('g', 2),
      mk('p', 3, { sab: 'm' }),
      mk('root', 4, { isProband: true }),
    ];
    const unions: Union[] = [
      { parents: ['ggg'], children: ['gg'] },
      { parents: ['gg'], children: ['g'] },
      { parents: ['g'], children: ['p'] },
      { parents: ['p'], children: ['root'] },
    ];
    const idx = indexPeople(people, unions);
    const info = relationInfo(idx, 'ggg', 'root');
    expect(info.degree).toBeNull();
    expect(info.r).toBeCloseTo(0.0625, 5);
    expect(info.blood).toBe(true);
    expect(info.rel).toBe('Paternal Distant relative');
  });

  it('a true non-blood in-law (no shared ancestry) is degree null AND blood false, labelled "By marriage"', () => {
    // Carol (seed): Tom's wife, Maya's paternal-uncle's-wife — shares no ancestry with Maya
    // at all (r=0), the genuine non-blood case `blood` exists to distinguish from the above.
    // (The spouse case, degree null but rel 'Spouse' regardless of blood, is covered by the
    // "marks a spouse-by-marriage as non-blood" test above.)
    const carol = relationInfo(idx, 'carol', 'you');
    expect(carol.degree).toBeNull();
    expect(carol.r).toBe(0);
    expect(carol.blood).toBe(false);
    expect(carol.rel).toBe('By marriage');
  });
});

// ---------------------------------------------------------------------------
// Cross-defect integration — removePerson (record.ts) feeding relationInfo (graph.ts)
// ---------------------------------------------------------------------------

describe('cross-defect integration — removing a shared parent demotes a full sibling to a half-sibling', () => {
  it('turns a full sister into a "Paternal Half-sister" (degree 2, correct side) once her mother is removed', () => {
    const dad: Person = {
      id: 'dad',
      name: 'Dad',
      sab: 'm',
      gender: 'man',
      gen: 0,
      x: 0,
      dead: false,
      birth: null,
      death: null,
      conds: [],
    };
    const mom: Person = {
      id: 'mom',
      name: 'Mom',
      sab: 'f',
      gender: 'woman',
      gen: 0,
      x: 0,
      dead: false,
      birth: null,
      death: null,
      conds: [],
    };
    const root: Person = {
      id: 'root',
      name: 'Root',
      sab: 'f',
      gender: 'woman',
      gen: 1,
      x: 0,
      dead: false,
      birth: null,
      death: null,
      conds: [],
      isProband: true,
    };
    const sister: Person = {
      id: 'sister',
      name: 'Sister',
      sab: 'f',
      gender: 'woman',
      gen: 1,
      x: 0,
      dead: false,
      birth: null,
      death: null,
      conds: [],
    };
    const record: FamilyRecord = {
      people: [dad, mom, root, sister],
      unions: [{ parents: ['dad', 'mom'], children: ['root', 'sister'] }],
      timeline: [],
      probandId: 'root',
    };

    // Sanity: while both parents are recorded, she is a full sister (degree 1, no side).
    const before = indexPeople(record.people, record.unions);
    expect(relationInfo(before, 'sister', 'root').rel).toBe('Sister');

    const after = removePerson(record, 'mom');
    const idxAfter = indexPeople(after.people, after.unions);
    const info = relationInfo(idxAfter, 'sister', 'root');
    expect(info.rel).toBe('Paternal Half-sister');
    expect(info.degree).toBe(2);
    expect(info.side).toBe('Paternal');
    expect(info.r).toBeCloseTo(0.25, 5);
  });
});

// ---------------------------------------------------------------------------
// PR 3 — consanguinity double-line, twin notation, offsetParallel (segments())
// ---------------------------------------------------------------------------

describe('consanguinity — segments() marks the relationship line double', () => {
  it("marks a consanguineous union's relationship-line segment double: true", () => {
    const pos: Record<string, LayoutNode> = {
      p1: { x: 0, y: 100, cy: 124 },
      p2: { x: 96, y: 100, cy: 124 },
    };
    const unions: Union[] = [{ parents: ['p1', 'p2'], children: [], consanguineous: true }];
    const segs = segments(unions, pos);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ x1: 0, y1: 124, x2: 96, y2: 124, double: true });
  });

  it('never marks double on a non-consanguineous union (relationship, sibship, or descent segments)', () => {
    const pos: Record<string, LayoutNode> = {
      p1: { x: 0, y: 100, cy: 124 },
      p2: { x: 96, y: 100, cy: 124 },
      c1: { x: 0, y: 270, cy: 294 },
      c2: { x: 96, y: 270, cy: 294 },
    };
    const unions: Union[] = [{ parents: ['p1', 'p2'], children: ['c1', 'c2'] }];
    const segs = segments(unions, pos);
    expect(segs.length).toBeGreaterThan(0);
    expect(segs.every((s) => !s.double)).toBe(true);
  });
});

describe('offsetParallel', () => {
  it('offsets a horizontal segment vertically by ±gap/2', () => {
    const s: Segment = { x1: 0, y1: 10, x2: 20, y2: 10 };
    const [a, b] = offsetParallel(s, 4);
    expect(a).toEqual({ x1: 0, y1: 12, x2: 20, y2: 12 });
    expect(b).toEqual({ x1: 0, y1: 8, x2: 20, y2: 8 });
  });

  it('offsets a vertical segment horizontally by ±gap/2', () => {
    const s: Segment = { x1: 5, y1: 0, x2: 5, y2: 30 };
    const [a, b] = offsetParallel(s, 6);
    expect(a).toEqual({ x1: 2, y1: 0, x2: 2, y2: 30 });
    expect(b).toEqual({ x1: 8, y1: 0, x2: 8, y2: 30 });
  });

  it('offsets a diagonal segment perpendicular to its own direction', () => {
    const s: Segment = { x1: 0, y1: 0, x2: 10, y2: 10 };
    const [a, b] = offsetParallel(s, 2);
    // 45° diagonal, gap 2 ⇒ perpendicular offset magnitude gap/2 * 1/√2 = 1/√2 on each axis.
    const off = Math.SQRT1_2;
    expect(a.x1).toBeCloseTo(-off, 10);
    expect(a.y1).toBeCloseTo(off, 10);
    expect(a.x2).toBeCloseTo(10 - off, 10);
    expect(a.y2).toBeCloseTo(10 + off, 10);
    expect(b.x1).toBeCloseTo(off, 10);
    expect(b.y1).toBeCloseTo(-off, 10);
    expect(b.x2).toBeCloseTo(10 + off, 10);
    expect(b.y2).toBeCloseTo(10 - off, 10);
  });

  it('returns two coincident copies for a zero-length segment, with no NaN', () => {
    const s: Segment = { x1: 5, y1: 5, x2: 5, y2: 5 };
    const [a, b] = offsetParallel(s, 10);
    expect(a).toEqual({ x1: 5, y1: 5, x2: 5, y2: 5 });
    expect(b).toEqual({ x1: 5, y1: 5, x2: 5, y2: 5 });
    for (const seg of [a, b]) {
      expect(Number.isNaN(seg.x1)).toBe(false);
      expect(Number.isNaN(seg.y1)).toBe(false);
      expect(Number.isNaN(seg.x2)).toBe(false);
      expect(Number.isNaN(seg.y2)).toBe(false);
    }
  });
});

describe('twin notation (segments()) — di, mono, triplets, mixed sibships, degrade', () => {
  const parentsPos = (): Record<string, LayoutNode> => ({
    p1: { x: 0, y: 100, cy: 124 },
    p2: { x: 96, y: 100, cy: 124 },
  });

  it('dizygotic twins: two diagonals from a shared confluence, no bar, no ordinary verticals', () => {
    const pos: Record<string, LayoutNode> = {
      ...parentsPos(),
      t1: { x: 0, y: 270, cy: 294 },
      t2: { x: 96, y: 270, cy: 294 },
    };
    const unions: Union[] = [
      {
        parents: ['p1', 'p2'],
        children: ['t1', 't2'],
        twins: [{ members: ['t1', 't2'], zygosity: 'di' }],
      },
    ];
    const segs = segments(unions, pos);
    const busY = 248; // pos[t1].y (270) - 22
    const midX = 48; // mean of present members' x (0, 96)
    // Both diagonals share the confluence point (midX, busY) — same x1,y1.
    expect(segs).toContainEqual({ x1: midX, y1: busY, x2: 0, y2: 270 });
    expect(segs).toContainEqual({ x1: midX, y1: busY, x2: 96, y2: 270 });
    // The ordinary per-child verticals are ABSENT for both twins.
    expect(segs).not.toContainEqual({ x1: 0, y1: busY, x2: 0, y2: 270 });
    expect(segs).not.toContainEqual({ x1: 96, y1: busY, x2: 96, y2: 270 });
    // Dizygotic: no connecting bar anywhere strictly between the bus and the child row.
    expect(segs.some((s) => s.y1 === s.y2 && s.y1 > busY && s.y1 < 270)).toBe(false);
  });

  it('monozygotic twins: two diagonals plus one bar at busY + (childY − busY) × 0.4', () => {
    const pos: Record<string, LayoutNode> = {
      ...parentsPos(),
      t1: { x: 0, y: 270, cy: 294 },
      t2: { x: 96, y: 270, cy: 294 },
    };
    const unions: Union[] = [
      {
        parents: ['p1', 'p2'],
        children: ['t1', 't2'],
        twins: [{ members: ['t1', 't2'], zygosity: 'mono' }],
      },
    ];
    const segs = segments(unions, pos);
    const busY = 248;
    const childY = 270;
    const barY = busY + (childY - busY) * 0.4;
    const bar = segs.find((s) => s.y1 === s.y2 && Math.abs(s.y1 - barY) < 1e-9);
    expect(bar).toBeDefined();
    // Its ends land exactly on the two diagonals interpolated at barY (t = 0.4 along each):
    // midX=48, t1 → 48 + (0-48)*0.4 = 28.8; t2 → 48 + (96-48)*0.4 = 67.2.
    expect(Math.min(bar!.x1, bar!.x2)).toBeCloseTo(28.8, 9);
    expect(Math.max(bar!.x1, bar!.x2)).toBeCloseTo(67.2, 9);
    // Both diagonals are still present alongside the bar.
    expect(segs).toContainEqual({ x1: 48, y1: busY, x2: 0, y2: 270 });
    expect(segs).toContainEqual({ x1: 48, y1: busY, x2: 96, y2: 270 });
  });

  it('triplet monozygotic set: three diagonals plus one bar spanning the extremes', () => {
    const pos: Record<string, LayoutNode> = {
      ...parentsPos(),
      t1: { x: 0, y: 270, cy: 294 },
      t2: { x: 96, y: 270, cy: 294 },
      t3: { x: 192, y: 270, cy: 294 },
    };
    const unions: Union[] = [
      {
        parents: ['p1', 'p2'],
        children: ['t1', 't2', 't3'],
        twins: [{ members: ['t1', 't2', 't3'], zygosity: 'mono' }],
      },
    ];
    const segs = segments(unions, pos);
    const busY = 248;
    const midX = 96; // mean of 0, 96, 192
    expect(segs).toContainEqual({ x1: midX, y1: busY, x2: 0, y2: 270 });
    expect(segs).toContainEqual({ x1: midX, y1: busY, x2: 96, y2: 270 });
    expect(segs).toContainEqual({ x1: midX, y1: busY, x2: 192, y2: 270 });
    const barY = busY + (270 - busY) * 0.4;
    const bar = segs.find((s) => s.y1 === s.y2 && Math.abs(s.y1 - barY) < 1e-9);
    expect(bar).toBeDefined();
    // Spans the extremes (leftmost/rightmost diagonal), not the middle triplet.
    expect(Math.min(bar!.x1, bar!.x2)).toBeCloseTo(57.6, 9);
    expect(Math.max(bar!.x1, bar!.x2)).toBeCloseTo(134.4, 9);
  });

  it('mixed sibship: a twin pair keeps its diagonals while a non-twin sibling keeps its ordinary vertical', () => {
    const pos: Record<string, LayoutNode> = {
      ...parentsPos(),
      t1: { x: 0, y: 270, cy: 294 },
      t2: { x: 96, y: 270, cy: 294 },
      s1: { x: 192, y: 270, cy: 294 },
    };
    const unions: Union[] = [
      {
        parents: ['p1', 'p2'],
        children: ['t1', 't2', 's1'],
        twins: [{ members: ['t1', 't2'], zygosity: 'di' }],
      },
    ];
    const segs = segments(unions, pos);
    const busY = 248;
    expect(segs).toContainEqual({ x1: 48, y1: busY, x2: 0, y2: 270 });
    expect(segs).toContainEqual({ x1: 48, y1: busY, x2: 96, y2: 270 });
    // The non-twin sibling keeps an ordinary individual vertical.
    expect(segs).toContainEqual({ x1: 192, y1: busY, x2: 192, y2: 270 });
  });

  it('degrades to an ordinary vertical when fewer than two of a TwinSet’s members are present', () => {
    // t2 has no laid-out position (e.g. pruned from a windowed view) even though the union's
    // `children` and the TwinSet still name it — present.length < 2 must degrade gracefully,
    // never throw, and never leave a NaN coordinate.
    const pos: Record<string, LayoutNode> = {
      ...parentsPos(),
      t1: { x: 0, y: 270, cy: 294 },
    };
    const unions: Union[] = [
      {
        parents: ['p1', 'p2'],
        children: ['t1', 't2'],
        twins: [{ members: ['t1', 't2'], zygosity: 'di' }],
      },
    ];
    expect(() => segments(unions, pos)).not.toThrow();
    const segs = segments(unions, pos);
    const busY = 248;
    // t1 falls back to its ordinary individual vertical.
    expect(segs).toContainEqual({ x1: 0, y1: busY, x2: 0, y2: 270 });
    for (const s of segs) {
      expect(Number.isNaN(s.x1)).toBe(false);
      expect(Number.isNaN(s.y1)).toBe(false);
      expect(Number.isNaN(s.x2)).toBe(false);
      expect(Number.isNaN(s.y2)).toBe(false);
    }
  });
});
