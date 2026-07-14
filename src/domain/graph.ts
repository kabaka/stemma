/**
 * Family-graph queries and kinship math.
 *
 * All functions are pure over a {@link FamilyRecord}. The kinship computation walks
 * genetic parentage edges to a coefficient of relatedness `r`, then bins it into a
 * degree of relationship and derives a human-readable label from any vantage — which
 * is what lets risk and screening be re-rooted on any person in the record.
 */
import type { Gender, Person, Sab, Union } from './types';
import { genderOf, sabOf } from './person';

/** O(1) lookup helpers built once from a record's people. */
export interface PeopleIndex {
  byId: Map<string, Person>;
  unions: Union[];
}

export function indexPeople(people: Person[], unions: Union[]): PeopleIndex {
  const byId = new Map<string, Person>();
  for (const p of people) byId.set(p.id, p);
  return { byId, unions };
}

export function personById(idx: PeopleIndex, id: string): Person | undefined {
  return idx.byId.get(id);
}

/** Genetic parents of `id`. */
export function parentsOf(idx: PeopleIndex, id: string): string[] {
  const out: string[] = [];
  for (const u of idx.unions) {
    if (u.children.includes(id)) for (const p of u.parents) out.push(p);
  }
  return out;
}

/** Genetic children of `id`. */
export function childrenOf(idx: PeopleIndex, id: string): string[] {
  const out: string[] = [];
  for (const u of idx.unions) {
    if (u.parents.includes(id)) for (const c of u.children) out.push(c);
  }
  return out;
}

/**
 * Map of every ancestor of `id` to its minimum generational distance (0 = `id`
 * itself). Uses a shortest-distance DFS so multiple paths collapse to the closest.
 */
export function ancestors(idx: PeopleIndex, id: string): Map<string, number> {
  const dist = new Map<string, number>();
  const dfs = (x: string, d: number): void => {
    const seen = dist.get(x);
    if (seen !== undefined && seen <= d) return;
    dist.set(x, d);
    for (const p of parentsOf(idx, x)) dfs(p, d + 1);
  };
  dfs(id, 0);
  return dist;
}

/** Degree of relationship: 0 = self, 1st/2nd/3rd, or `null` for non-blood. */
export type Degree = 0 | 1 | 2 | 3 | null;

export interface RelationInfo {
  /** Human-readable label from the root's vantage, e.g. `'Maternal aunt'`. */
  rel: string;
  degree: Degree;
  /** `'Paternal'` | `'Maternal'` | `'—'`. */
  side: string;
  /** Coefficient of relatedness (probability of sharing a given allele IBD). */
  r: number;
}

const EMDASH = '—';

/**
 * Kinship of `id` as seen from `rootId`. Sums `0.5^(depthRoot + depthId)` over the
 * most-recent common ancestors to a coefficient of relatedness, then bins it.
 */
export function relationInfo(idx: PeopleIndex, id: string, rootId: string): RelationInfo {
  if (id === rootId) {
    const self = personById(idx, rootId);
    return { rel: self?.isProband ? 'You' : 'Self', degree: 0, side: EMDASH, r: 1 };
  }
  const aRoot = ancestors(idx, rootId);
  const aX = ancestors(idx, id);
  const isCA = (n: string): boolean => aX.has(n) && aRoot.has(n);
  const common = [...aX.keys()].filter((k) => aRoot.has(k));
  // Most-recent common ancestors: common ancestors none of whose children are also common.
  const mrcas = common.filter((a) => !childrenOf(idx, a).some((c) => isCA(c)));

  let r = 0;
  for (const a of mrcas) r += Math.pow(0.5, (aRoot.get(a) ?? 0) + (aX.get(a) ?? 0));

  let degree: Degree = null;
  if (r >= 0.4) degree = 1;
  else if (r >= 0.2) degree = 2;
  else if (r >= 0.09) degree = 3;

  // Side is relative to the root's own mother/father.
  let side = EMDASH;
  const rootParents = parentsOf(idx, rootId).map((pid) => personById(idx, pid));
  const father = rootParents.find((pp) => pp && sabOf(pp) === 'm');
  const mother = rootParents.find((pp) => pp && sabOf(pp) === 'f');
  if (father && mother) {
    const ancF = new Set<string>([father.id, ...ancestors(idx, father.id).keys()]);
    const ancM = new Set<string>([mother.id, ...ancestors(idx, mother.id).keys()]);
    const pat = mrcas.some((a) => ancF.has(a));
    const mat = mrcas.some((a) => ancM.has(a));
    if (pat && !mat) side = 'Paternal';
    else if (mat && !pat) side = 'Maternal';
  }

  const rel = relLabel(idx, id, degree, aRoot, aX, side, rootId);
  return { rel, degree, side, r };
}

function relLabel(
  idx: PeopleIndex,
  id: string,
  degree: Degree,
  aRoot: Map<string, number>,
  aX: Map<string, number>,
  side: string,
  rootId: string,
): string {
  const p = personById(idx, id);
  const you = personById(idx, rootId);
  if (!p || !you) return degree ? `${degree}° relative` : 'By marriage';
  const gd = p.gen - you.gen;
  const g: Gender = genderOf(p);
  const sx = g === 'man' ? 'm' : g === 'woman' ? 'f' : 'x';
  const sp = side !== EMDASH ? `${side} ` : '';
  const pick = (m: string, f: string, x: string): string => (sx === 'm' ? m : sx === 'f' ? f : x);

  if (degree === null) {
    const spouseOfRoot = idx.unions.some(
      (u) => u.parents.includes(rootId) && u.parents.includes(id),
    );
    return spouseOfRoot ? 'Spouse' : 'By marriage';
  }
  const isAnc = aRoot.has(id);
  const isDesc = aX.has(rootId);
  if (isAnc) {
    if (gd === -1) return pick('Father', 'Mother', 'Parent');
    if (gd === -2) return sp + pick('Grandfather', 'Grandmother', 'Grandparent');
    if (gd === -3) return sp + pick('Great-grandfather', 'Great-grandmother', 'Great-grandparent');
    return 'Distant ancestor';
  }
  if (isDesc) {
    if (gd === 1) return pick('Son', 'Daughter', 'Child');
    if (gd === 2) return pick('Grandson', 'Granddaughter', 'Grandchild');
    return 'Descendant';
  }
  if (gd === 0) return degree === 1 ? pick('Brother', 'Sister', 'Sibling') : `${sp}Cousin`;
  if (gd === -1) return sp + pick('Uncle', 'Aunt', 'Aunt/Uncle');
  if (gd === 1) return pick('Nephew', 'Niece', 'Nibling');
  if (gd === -2) return `Great-${pick('uncle', 'aunt', 'aunt/uncle')}`;
  return `${degree}° relative`;
}

/** Short ordinal for a degree, e.g. `'1st'`. */
export function degreeShort(d: Degree): string {
  return d === 1 ? '1st' : d === 2 ? '2nd' : d === 3 ? '3rd' : EMDASH;
}

/** Long label for a degree, e.g. `'1st-degree'`. */
export function degreeLong(d: Degree): string {
  return d === 0
    ? 'Proband'
    : d === 1
      ? '1st-degree'
      : d === 2
        ? '2nd-degree'
        : d === 3
          ? '3rd-degree'
          : 'Non-blood';
}

// ---------------------------------------------------------------------------
// Pedigree layout
// ---------------------------------------------------------------------------

export interface LayoutNode {
  x: number;
  y: number;
  /** Centre-y of the node glyph. */
  cy: number;
}

export interface Layout {
  pos: Record<string, LayoutNode>;
  minGen: number;
  maxGen: number;
  gens: number[];
  /** Canvas width. */
  cw: number;
  /** Canvas height. */
  ch: number;
}

const MIN_SPACING = 88;
const GEN_HEIGHT = 170;

/** Compute a generation-banded layout, de-overlapping nodes within each row. */
export function computeLayout(people: Person[]): Layout {
  const byGen: Record<number, Person[]> = {};
  for (const p of people) (byGen[p.gen] ??= []).push(p);
  const gens = Object.keys(byGen)
    .map(Number)
    .sort((a, b) => a - b);
  const minGen = gens[0] ?? 0;
  const maxGen = gens[gens.length - 1] ?? 0;
  const pos: Record<string, LayoutNode> = {};
  let maxX = 0;
  for (const g of gens) {
    const row = byGen[g].slice().sort((a, b) => a.x - b.x);
    let cur = -1e9;
    for (const p of row) {
      const x = Math.max(p.x, cur + MIN_SPACING);
      cur = x;
      const y = 40 + (g - minGen) * GEN_HEIGHT;
      pos[p.id] = { x, y, cy: y + 24 };
      if (x > maxX) maxX = x;
    }
  }
  return {
    pos,
    minGen,
    maxGen,
    gens,
    cw: maxX + 150,
    ch: 40 + (maxGen - minGen) * GEN_HEIGHT + 120,
  };
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Connector line segments (partner bars, sibling buses, drop lines) for a layout. */
export function segments(unions: Union[], pos: Record<string, LayoutNode>): Segment[] {
  const segs: Segment[] = [];
  for (const u of unions) {
    const parts = u.parents.filter((id) => pos[id]);
    if (parts.length === 2) {
      const a = pos[parts[0]];
      const b = pos[parts[1]];
      segs.push({ x1: a.x, y1: a.cy, x2: b.x, y2: b.cy });
    }
    const kids = (u.children ?? []).filter((id) => pos[id]);
    if (kids.length) {
      const px = parts.map((id) => pos[id].x);
      const mx = px.length ? px.reduce((s, v) => s + v, 0) / px.length : pos[kids[0]].x;
      const py = parts.length ? pos[parts[0]].cy : null;
      const busY = pos[kids[0]].y - 22;
      if (py != null) segs.push({ x1: mx, y1: py, x2: mx, y2: busY });
      const cxs = kids.map((id) => pos[id].x);
      const minX = Math.min(...cxs);
      const maxX = Math.max(...cxs);
      if (maxX !== minX) segs.push({ x1: minX, y1: busY, x2: maxX, y2: busY });
      for (const cid of kids)
        segs.push({ x1: pos[cid].x, y1: busY, x2: pos[cid].x, y2: pos[cid].y });
    }
  }
  return segs;
}

/** Sab of a person as used by the pedigree geometry. */
export function pedigreeSab(p: Person): Sab {
  return sabOf(p);
}
