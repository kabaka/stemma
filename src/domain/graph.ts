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

/** Minimum horizontal centre-to-centre distance between two nodes in the same row. */
const H_GAP = 96;
const GEN_HEIGHT = 170;
/** Left margin for the leftmost node's centre, so the negative-x generation label and
 * the node's own half-width both clear the canvas edge. */
const LEFT_MARGIN = 40;
/** Fixed sweep counts (deterministic — never a wall-clock/perf bailout). Each round is a
 * single top-down or bottom-up pass, alternating direction; rows are updated in place, so a
 * node already sees its just-swept neighbours' new positions within the same pass. These
 * counts sit comfortably above what any real pedigree depth needs to settle. */
const ORDER_ROUNDS = 16;
const COORD_ROUNDS = 40;

/** Parent / child / spouse adjacency for the layout, restricted to the people actually
 * being laid out — a union member absent from `ids` (e.g. an ancestor outside the SVG
 * export's generation window) is skipped, never dereferenced. */
interface LayoutAdj {
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
  spouses: Map<string, string[]>;
  /** Person → index of the union they are a *child* of (their sibship), for the first such
   * union that has a placed parent. The unit that must stay contiguous within a row. */
  birthUnion: Map<string, number>;
  /** Person → index of the first union they are a *parent* of (their primary mating), used
   * to keep a childless / married-in couple together when neither has a sibship in view. */
  matingUnion: Map<string, number>;
}

function buildLayoutAdj(ids: Set<string>, unions: Union[]): LayoutAdj {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const spouses = new Map<string, string[]>();
  const birthUnion = new Map<string, number>();
  const matingUnion = new Map<string, number>();
  const push = (m: Map<string, string[]>, k: string, v: string): void => {
    const a = m.get(k);
    if (a) {
      if (!a.includes(v)) a.push(v);
    } else m.set(k, [v]);
  };
  unions.forEach((u, ui) => {
    const ps = u.parents.filter((id) => ids.has(id));
    const cs = (u.children ?? []).filter((id) => ids.has(id));
    for (const c of cs) {
      if (ps.length && !birthUnion.has(c)) birthUnion.set(c, ui);
      for (const p of ps) {
        push(parents, c, p);
        push(children, p, c);
      }
    }
    for (const p of ps) if (!matingUnion.has(p)) matingUnion.set(p, ui);
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        push(spouses, ps[i], ps[j]);
        push(spouses, ps[j], ps[i]);
      }
  });
  return { parents, children, spouses, birthUnion, matingUnion };
}

/** Mean of the given numbers, or `null` when the list is empty. */
function meanOf(vals: number[]): number | null {
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/**
 * L2 isotonic regression by pool-adjacent-violators: the non-decreasing sequence closest
 * (least squares) to `e`. The building block for order-preserving, minimum-gap placement.
 */
function isotonic(e: number[]): number[] {
  const val: number[] = [];
  const wt: number[] = [];
  for (const x of e) {
    let v = x;
    let w = 1;
    while (val.length && val[val.length - 1] > v) {
      const pv = val.pop() as number;
      const pw = wt.pop() as number;
      v = (v * w + pv * pw) / (w + pw);
      w += pw;
    }
    val.push(v);
    wt.push(w);
  }
  const out: number[] = [];
  for (let k = 0; k < val.length; k++) for (let j = 0; j < wt[k]; j++) out.push(val[k]);
  return out;
}

/**
 * Place ordered nodes as close as possible (least squares) to their `desired` positions
 * while keeping the input order and at least `gap` between neighbours. Substituting
 * `z[i] = x[i] - i*gap` turns the min-gap constraint into monotonicity, solved by
 * {@link isotonic}.
 */
function placeRow(desired: number[], gap: number): number[] {
  const z = isotonic(desired.map((d, i) => d - i * gap));
  return z.map((v, i) => v + i * gap);
}

/**
 * Reorder one generation's row so that **each sibship stays contiguous**. A sibship — a
 * union's children — is the unit that must never be split by unrelated people, otherwise its
 * sibling bus is drawn across strangers and merges with a neighbour's (the reported
 * "unrelated people share one lineage line" defect). Structurally:
 *
 * - every child of the same union shares a group id, so they sort as one block;
 * - a married-in partner (no sibship of their own in view) joins their mate's block and is
 *   placed beside them — a lone spouse to the block's outer edge, a remarried person between
 *   their two spouses (so each marriage's children drop from their own short bar);
 * - blocks are ordered by the barycentre of each sibship's parents, so children sit under
 *   them; within a block, siblings order by the barycentre of *their* children.
 *
 * `idx` is every person's current index within its own row (all generations), the coordinate
 * the barycentres are taken over. Pure and deterministic — ties broken by prior position.
 */
function orderRow(
  row: string[],
  idx: Map<string, number>,
  adj: LayoutAdj,
  unions: Union[],
): string[] {
  const inRow = new Set(row);
  const append = (m: Map<string, string[]>, k: string, v: string): void => {
    const a = m.get(k);
    if (a) a.push(v);
    else m.set(k, [v]);
  };

  // Group id: sibship members share `s<unionIdx>`; a married-in person joins a sibship
  // spouse's group; an otherwise-free person shares `m<matingIdx>` with their spouse (keeps a
  // founder couple together) or is a singleton `o<id>`.
  const groupId = new Map<string, string>();
  for (const id of row) {
    const bu = adj.birthUnion.get(id);
    if (bu != null) groupId.set(id, `s${bu}`);
  }
  for (const id of row) {
    if (groupId.has(id)) continue;
    const host = (adj.spouses.get(id) ?? []).find(
      (s) => inRow.has(s) && groupId.get(s)?.startsWith('s'),
    );
    if (host) groupId.set(id, groupId.get(host)!);
    else {
      const mu = adj.matingUnion.get(id);
      groupId.set(id, mu != null ? `m${mu}` : `o${id}`);
    }
  }

  const tie = (a: string, b: string): number => idx.get(a)! - idx.get(b)!;
  const childBary = (id: string): number => {
    const m = meanOf(
      (adj.children.get(id) ?? []).filter((c) => idx.has(c)).map((c) => idx.get(c)!),
    );
    return m != null ? m : idx.get(id)!;
  };

  const groups = new Map<string, string[]>();
  for (const id of row) append(groups, groupId.get(id)!, id);

  // Anchor: a sibship sits under its parents' barycentre; a free group over its members' own
  // children; either falls back to the group's current position.
  const anchor = new Map<string, number>();
  for (const [gid, mem] of groups) {
    const here = meanOf(mem.map((m) => idx.get(m)!))!;
    if (gid.startsWith('s')) {
      const par = (unions[Number(gid.slice(1))]?.parents ?? []).filter((p) => idx.has(p));
      anchor.set(gid, meanOf(par.map((p) => idx.get(p)!)) ?? here);
    } else {
      anchor.set(gid, meanOf(mem.map((m) => childBary(m))) ?? here);
    }
  }
  const orderedGroups = [...groups.keys()].sort(
    (a, b) => anchor.get(a)! - anchor.get(b)! || (a < b ? -1 : a > b ? 1 : 0),
  );

  const out: string[] = [];
  for (const gid of orderedGroups) {
    const mem = groups.get(gid)!;
    if (!gid.startsWith('s')) {
      out.push(...mem.slice().sort((a, b) => childBary(a) - childBary(b) || tie(a, b)));
      continue;
    }
    const sibs = mem
      .filter((m) => adj.birthUnion.get(m) != null && groupId.get(m) === gid)
      .sort((a, b) => childBary(a) - childBary(b) || tie(a, b));
    const frees = mem.filter((m) => adj.birthUnion.get(m) == null);
    const used = new Set<string>();
    sibs.forEach((s, i) => {
      const mine = frees.filter((f) => (adj.spouses.get(f) ?? []).includes(s));
      // A lone spouse goes to the block's outer edge; a remarried sibling sits between two
      // spouses (spouse-person-spouse), so each marriage bar stays short.
      const outerLeft = i < sibs.length / 2;
      const left: string[] = [];
      const right: string[] = [];
      mine.forEach((f, k) => ((k % 2 === 0) === outerLeft ? left : right).push(f));
      for (const f of [...left, s, ...right]) {
        out.push(f);
        used.add(f);
      }
    });
    // A married-in person whose only spouse is themselves married-in (no sibling host) —
    // trail them after the sibship rather than drop them.
    for (const f of frees) if (!used.has(f)) out.push(f);
  }
  return out;
}

/**
 * Generation-banded pedigree layout. Bands people by their (authoritative) `gen`, orders
 * each row so every sibship stays contiguous and partners sit adjacent (see {@link orderRow}),
 * then assigns x-coordinates so children sit centred under their parents and partners sit
 * side by side. Keeping sibships contiguous is what stops a union's sibling bus from being
 * drawn across unrelated people or merging with a neighbour's.
 *
 * The heavy lifting lives here, at render time, rather than in the stored `Person.x`: that
 * field is only ever a partial hint (hand-authored in the seed, a barycentre pass in
 * {@link layoutFromGraph} for imports, a local guess in `linkRelative`), so doing the real
 * placement here fixes every source uniformly. `gen` stays authoritative input and is never
 * re-derived (it also drives relationship labels); only horizontal order/position is owned
 * here. Ordering and coordinates seed from the stored `x` order, so the result is stable and
 * a decent starting point is preserved.
 *
 * `unions` is optional: with none given (e.g. Overview, which reads only the gen range) this
 * degrades to a de-overlapped row packing. Pure and deterministic — fixed sweep counts, and
 * every tie broken by the record's own order (`fileIndex`).
 */
export function computeLayout(people: Person[], unions: Union[] = []): Layout {
  const ids = new Set(people.map((p) => p.id));
  const adj = buildLayoutAdj(ids, unions);
  const fileIndex = new Map(people.map((p, i) => [p.id, i]));

  const byGen = new Map<number, Person[]>();
  for (const p of people) {
    const a = byGen.get(p.gen);
    if (a) a.push(p);
    else byGen.set(p.gen, [p]);
  }
  const gens = [...byGen.keys()].sort((a, b) => a - b);
  const minGen = gens[0] ?? 0;
  const maxGen = gens[gens.length - 1] ?? 0;

  // --- ordering: keep each sibship contiguous, partners adjacent, sibships under parents ---
  const order = new Map<number, string[]>();
  for (const g of gens) {
    const row = byGen
      .get(g)!
      .slice()
      .sort((a, b) => a.x - b.x || fileIndex.get(a.id)! - fileIndex.get(b.id)!);
    order.set(
      g,
      row.map((p) => p.id),
    );
  }
  const idx = new Map<string, number>();
  const reindex = (): void => {
    for (const g of gens) order.get(g)!.forEach((id, i) => idx.set(id, i));
  };
  for (let r = 0; r < ORDER_ROUNDS; r++) {
    reindex();
    // Top-down each round: a sibship's block position reads its (already-updated) parents,
    // while sibling order within a block reads children from the previous round — a few
    // rounds settle both.
    for (const g of gens) {
      const reordered = orderRow(order.get(g)!, idx, adj, unions);
      order.set(g, reordered);
      reordered.forEach((id, i) => idx.set(id, i));
    }
  }

  // --- coordinate assignment: children centred under parents, partners side by side ---
  const x = new Map<string, number>();
  for (const g of gens) order.get(g)!.forEach((id, i) => x.set(id, i * H_GAP));
  for (let r = 0; r < COORD_ROUNDS; r++) {
    const down = r % 2 === 0;
    const sweep = down ? gens : [...gens].reverse();
    for (const g of sweep) {
      const row = order.get(g)!;
      // Balance the parent-side and child-side barycentres (each counted once, so a large
      // sibship doesn't outvote two parents), blended with the spouse's target so couples
      // share a centre. Unanchored nodes hold position.
      const want = (id: string): number | null => {
        const pm = meanOf((adj.parents.get(id) ?? []).map((n) => x.get(n)!));
        const cm = meanOf((adj.children.get(id) ?? []).map((n) => x.get(n)!));
        return meanOf([pm, cm].filter((v): v is number => v != null));
      };
      const desired = row.map((id) => {
        const group = [want(id), ...(adj.spouses.get(id) ?? []).map((s) => want(s))].filter(
          (v): v is number => v != null,
        );
        return group.length ? (meanOf(group) as number) : x.get(id)!;
      });
      placeRow(desired, H_GAP).forEach((v, i) => x.set(row[i], v));
    }
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const v of x.values()) {
    if (v < minX) minX = v;
    if (v > maxX) maxX = v;
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 0;
  }

  const pos: Record<string, LayoutNode> = {};
  for (const p of people) {
    const px = (x.get(p.id) ?? 0) - minX + LEFT_MARGIN;
    const y = 40 + (p.gen - minGen) * GEN_HEIGHT;
    pos[p.id] = { x: px, y, cy: y + 24 };
  }

  return {
    pos,
    minGen,
    maxGen,
    gens,
    cw: maxX - minX + LEFT_MARGIN + 150,
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
      // The sibling bus must span the children AND the descent point (mx) so the drop line
      // from the parents always lands on it — coordinate assignment centres children under
      // their parents, but cross-union spacing in a shared row can still nudge mx just
      // outside the children's own span, which previously left the drop line disconnected.
      const busMinX = Math.min(...cxs, py != null ? mx : Number.POSITIVE_INFINITY);
      const busMaxX = Math.max(...cxs, py != null ? mx : Number.NEGATIVE_INFINITY);
      if (busMaxX !== busMinX) segs.push({ x1: busMinX, y1: busY, x2: busMaxX, y2: busY });
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
