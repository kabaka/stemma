/**
 * Family-graph queries and kinship math.
 *
 * All functions are pure over a {@link FamilyRecord}. The kinship computation walks
 * genetic parentage edges to a coefficient of relatedness `r`, then bins it into a
 * degree of relationship and derives a human-readable label from any vantage — which
 * is what lets risk and screening be re-rooted on any person in the record.
 */
import type { Gender, Person, Sab, TwinSet, Union } from './types';
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

/**
 * Degree of relationship: 0 = self, 1st/2nd/3rd, or `null`. `null` is NOT the same as
 * "non-blood": it covers BOTH a true non-blood relative (r = 0) AND a distant blood
 * relative below the 3rd-degree cutoff (0 < r < 0.09, e.g. a second cousin or a
 * great-great-grandparent). Use {@link RelationInfo.blood} to tell those two apart.
 */
export type Degree = 0 | 1 | 2 | 3 | null;

export interface RelationInfo {
  /** Human-readable label from the root's vantage, e.g. `'Maternal aunt'`. */
  rel: string;
  degree: Degree;
  /** `'Paternal'` | `'Maternal'` | `'—'`. */
  side: string;
  /** Coefficient of relatedness (probability of sharing a given allele IBD). */
  r: number;
  /** True whenever shared ancestry exists (r > 0) — distinguishes a distant blood relative
   *  (`degree` null, `blood` true) from a true in-law (`degree` null, `blood` false). */
  blood: boolean;
}

const EMDASH = '—';

/**
 * Kinship of `id` as seen from `rootId`. Sums `0.5^(depthRoot + depthId)` over the
 * most-recent common ancestors to a coefficient of relatedness, then bins it.
 */
export function relationInfo(idx: PeopleIndex, id: string, rootId: string): RelationInfo {
  if (id === rootId) {
    const self = personById(idx, rootId);
    return { rel: self?.isProband ? 'You' : 'Self', degree: 0, side: EMDASH, r: 1, blood: true };
  }
  const aRoot = ancestors(idx, rootId);
  const aX = ancestors(idx, id);
  const isCA = (n: string): boolean => aX.has(n) && aRoot.has(n);
  const common = [...aX.keys()].filter((k) => aRoot.has(k));
  // Most-recent common ancestors: common ancestors none of whose children are also common.
  const mrcas = common.filter((a) => !childrenOf(idx, a).some((c) => isCA(c)));

  let r = 0;
  for (const a of mrcas) r += Math.pow(0.5, (aRoot.get(a) ?? 0) + (aX.get(a) ?? 0));
  // Shared ancestry ⟺ r > 0, computed once from the same MRCAs. Kept separate from `degree`,
  // which bins both a distant blood relative and a true in-law to `null`; `blood` is what
  // tells those two apart downstream (and drives the label's "Distant relative" vs "By marriage").
  const blood = mrcas.length > 0;

  let degree: Degree = null;
  if (r >= 0.4) degree = 1;
  else if (r >= 0.2) degree = 2;
  else if (r >= 0.09) degree = 3;

  // Side is relative to the root's own mother/father, resolved per known parent independently:
  // recording only one parent (a normal in-progress state) must not blank the side for the whole
  // tree — the per-lineage clustering the pattern engine relies on depends on it. A parent that
  // isn't recorded simply can't claim the side; it never forces the other side to '—'.
  let side = EMDASH;
  const rootParents = parentsOf(idx, rootId).map((pid) => personById(idx, pid));
  const father = rootParents.find((pp) => pp && sabOf(pp) === 'm');
  const mother = rootParents.find((pp) => pp && sabOf(pp) === 'f');
  const ancOf = (person: Person | undefined): Set<string> | null =>
    person ? new Set<string>([person.id, ...ancestors(idx, person.id).keys()]) : null;
  const ancF = ancOf(father);
  const ancM = ancOf(mother);
  const pat = ancF ? mrcas.some((a) => ancF.has(a)) : false;
  const mat = ancM ? mrcas.some((a) => ancM.has(a)) : false;
  if (pat && !mat) side = 'Paternal';
  else if (mat && !pat) side = 'Maternal';

  const rel = relLabel(idx, id, degree, aRoot, aX, side, rootId, blood);
  return { rel, degree, side, r, blood };
}

function relLabel(
  idx: PeopleIndex,
  id: string,
  degree: Degree,
  aRoot: Map<string, number>,
  aX: Map<string, number>,
  side: string,
  rootId: string,
  blood: boolean,
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
    if (spouseOfRoot) return 'Spouse';
    // A `null` degree is not automatically an in-law: it also covers a blood relative more
    // distant than 3rd-degree (r < 0.09). Only a genuinely unrelated person (r = 0) is
    // "By marriage"; a distant blood tie is surfaced as such rather than mislabeled.
    return blood ? `${sp}Distant relative` : 'By marriage';
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
  if (gd === 0) {
    if (degree === 1) return pick('Brother', 'Sister', 'Sibling');
    // A same-generation relative who shares exactly one direct parent is a half-sibling
    // (degree 2, r=0.25), not a cousin. Full siblings never reach here (they hit degree===1
    // above); a true first cousin shares zero direct parents and stays a Cousin.
    const rootParents = new Set(parentsOf(idx, rootId));
    const shared = parentsOf(idx, id).filter((pid) => rootParents.has(pid)).length;
    if (shared === 1) return `${sp}Half-${pick('brother', 'sister', 'sibling')}`;
    return `${sp}Cousin`;
  }
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
  /** Person → co-parents they have at least one child with (child-bearing marriages). These
   * are the structural couples the ordering makes adjacent first, since their children hang
   * below them; a childless marriage is only a spouse link. */
  coParents: Map<string, string[]>;
}

function buildLayoutAdj(ids: Set<string>, unions: Union[]): LayoutAdj {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const spouses = new Map<string, string[]>();
  const birthUnion = new Map<string, number>();
  const coParents = new Map<string, string[]>();
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
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        push(spouses, ps[i], ps[j]);
        push(spouses, ps[j], ps[i]);
        if (cs.length) {
          push(coParents, ps[i], ps[j]);
          push(coParents, ps[j], ps[i]);
        }
      }
  });
  return { parents, children, spouses, birthUnion, coParents };
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
 * Reorder one generation's row so that **each sibship stays contiguous** and **each couple
 * sits adjacent**. A sibship (a union's children) must never be split by unrelated people, or
 * its sibling bus is drawn across strangers and merges with a neighbour's; and a couple —
 * especially the parents of a nuclear family — must sit side by side, or their partner bar is
 * drawn straight across everyone between them. Both were reported defects.
 *
 * The order is built from chains:
 * - each sibship starts as one chain of full siblings; a sibling who marries into another
 *   family is nudged toward the chain end nearest that family, so the couple can meet at an end;
 * - chains are then merged along marriages — child-bearing ones first (their children hang
 *   below, so they are structural), then childless — joining two chains only when both partners
 *   sit at a free end, which keeps sibships whole while making the couple adjacent;
 * - a pure married-in leaf (no sibship, no children — e.g. a third, childless spouse) is held
 *   out and spliced in beside their mate at the end, so it can never scatter across the row.
 *
 * Chains are ordered left-to-right by their members' anchor (a child under its parents, a
 * founder over its children). `idx` is every person's current index within its own row (all
 * generations), the coordinate the anchors are taken over. Always returns a permutation of
 * `row`. Pure and deterministic — every step breaks ties by prior position, then id.
 */
function orderRow(
  row: string[],
  idx: Map<string, number>,
  adj: LayoutAdj,
  unions: Union[],
): string[] {
  const inRow = new Set(row);
  const childBary = (id: string): number => {
    const m = meanOf(
      (adj.children.get(id) ?? []).filter((c) => idx.has(c)).map((c) => idx.get(c)!),
    );
    return m != null ? m : idx.get(id)!;
  };

  // Where each person would like to sit: a child under its parents, a founder over its own
  // children, a married-in person near a placed spouse; failing all, hold current position.
  const base = new Map<string, number>();
  for (const id of row) {
    const bu = adj.birthUnion.get(id);
    if (bu == null) continue;
    const m = meanOf((unions[bu].parents ?? []).filter((p) => idx.has(p)).map((p) => idx.get(p)!));
    if (m != null) base.set(id, m);
  }
  // A married-in person (no sibship of their own) anchors at the mean of their co-parents'
  // anchors, so a person who bridges two families lands *between* them (and their two mates
  // get pulled to the near edges of their respective sibships).
  for (const id of row)
    if (!base.has(id)) {
      const m = meanOf(
        (adj.coParents.get(id) ?? []).filter((c) => base.has(c)).map((c) => base.get(c)!),
      );
      if (m != null) base.set(id, m);
    }
  for (const id of row)
    if (!base.has(id)) {
      const m = meanOf(
        (adj.children.get(id) ?? []).filter((c) => idx.has(c)).map((c) => idx.get(c)!),
      );
      if (m != null) base.set(id, m);
    }
  for (let r = 0; r < 4; r++)
    for (const id of row)
      if (!base.has(id)) {
        const m = meanOf(
          (adj.spouses.get(id) ?? []).filter((s) => base.has(s)).map((s) => base.get(s)!),
        );
        if (m != null) base.set(id, m);
      }
  for (const id of row) if (!base.has(id)) base.set(id, idx.get(id)!);

  // A married-in person is a *pendant* — held out and spliced beside their mate at the end, so
  // a third (childless) marriage can't scatter across the row or wedge into a nuclear couple —
  // UNLESS they *bridge* two or more distinct sibships (they have children with members of
  // different families). A bridge must sit between those sibships as a real chain node; a
  // pendant ties to only one, so splicing it beside that mate is safe.
  const bridges = (id: string): boolean => {
    const sibs = new Set<number>();
    for (const c of adj.coParents.get(id) ?? []) {
      const bu = adj.birthUnion.get(c);
      if (inRow.has(c) && bu != null) sibs.add(bu);
    }
    return sibs.size >= 2;
  };
  const inChain = (id: string): boolean => adj.birthUnion.get(id) != null || bridges(id);
  const attach = new Set(
    row.filter(
      (id) => !inChain(id) && (adj.spouses.get(id) ?? []).some((s) => inRow.has(s) && inChain(s)),
    ),
  );

  // Sibship chains: full siblings together, a child-bearing-married-out sibling nudged toward
  // the end nearest their partner's family so the couple can join there.
  const sibsBy = new Map<number, string[]>();
  for (const id of row)
    if (!attach.has(id)) {
      const bu = adj.birthUnion.get(id);
      if (bu != null) {
        const a = sibsBy.get(bu);
        if (a) a.push(id);
        else sibsBy.set(bu, [id]);
      }
    }
  const chains: string[][] = [];
  const chainOf = new Map<string, number>();
  const addChain = (ids: string[]): void => {
    const i = chains.length;
    chains.push(ids);
    ids.forEach((id) => chainOf.set(id, i));
  };
  for (const [bu, sibs] of sibsBy) {
    const dir = (s: string): number => {
      const a = meanOf(
        (adj.coParents.get(s) ?? [])
          .filter((c) => inRow.has(c) && adj.birthUnion.get(c) !== bu)
          .map((c) => base.get(c)!),
      );
      return a == null ? 0 : a < base.get(s)! ? -1 : a > base.get(s)! ? 1 : 0;
    };
    addChain(
      sibs
        .slice()
        .sort(
          (a, b) => dir(a) - dir(b) || childBary(a) - childBary(b) || idx.get(a)! - idx.get(b)!,
        ),
    );
  }
  for (const id of row) if (!attach.has(id) && !chainOf.has(id)) addChain([id]);

  // Merge chains so a couple sits adjacent — child-bearing marriages first (structural), then
  // childless. Two chains join only when both partners are at a free end; otherwise the couple
  // stays a short cross-family bar rather than tearing a sibship apart.
  const endSide = (c: string[], id: string): 'L' | 'R' | null =>
    c[0] === id ? 'L' : c[c.length - 1] === id ? 'R' : null;
  const mergeAlong = (pairs: [string, string][]): void => {
    for (const [a, b] of pairs) {
      if (attach.has(a) || attach.has(b)) continue;
      const ia = chainOf.get(a)!;
      const ib = chainOf.get(b)!;
      if (ia === ib) continue;
      const ca = chains[ia];
      const cb = chains[ib];
      const sa = endSide(ca, a);
      const sb = endSide(cb, b);
      if (!sa || !sb) continue;
      const merged = (sa === 'R' ? ca : ca.slice().reverse()).concat(
        sb === 'L' ? cb : cb.slice().reverse(),
      );
      chains[ia] = merged;
      chains[ib] = [];
      merged.forEach((id) => chainOf.set(id, ia));
    }
  };
  const couples = (withKids: boolean): [string, string][] => {
    const seen = new Set<string>();
    const out: [string, string][] = [];
    for (const a of row)
      for (const b of (withKids ? adj.coParents : adj.spouses).get(a) ?? []) {
        if (!inRow.has(b)) continue;
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (withKids || !(adj.coParents.get(a) ?? []).includes(b)) out.push([a, b]);
      }
    // Tie-break on the whole pair, not just its first id — a person with two marriages in the
    // same category appears as `[P,Q]` and `[P,R]`, which share `p[0]`; comparing only `p[0]`
    // is not a total order and would let the merge order vary across JS engines.
    return out.sort((p, q) => {
      const d =
        Math.min(base.get(p[0])!, base.get(p[1])!) - Math.min(base.get(q[0])!, base.get(q[1])!);
      if (d !== 0) return d;
      const kp = `${p[0]}|${p[1]}`;
      const kq = `${q[0]}|${q[1]}`;
      return kp < kq ? -1 : kp > kq ? 1 : 0;
    });
  };
  mergeAlong(couples(true));
  mergeAlong(couples(false));

  const live = chains.filter((c) => c.length);
  const chainAnchor = (c: string[]): number => meanOf(c.map((id) => base.get(id)!))!;
  live.sort((a, b) => chainAnchor(a) - chainAnchor(b) || idx.get(a[0])! - idx.get(b[0])!);
  const flat = live.flat();

  // Splice each held-out married-in spouse in beside their mate, on the side not already taken
  // by the mate's co-parent (so a nuclear couple stays adjacent). Deterministic by base, id.
  const posn = new Map(flat.map((id, i) => [id, i]));
  for (const f of [...attach].sort((a, b) => base.get(a)! - base.get(b)! || (a < b ? -1 : 1))) {
    const mate = (adj.spouses.get(f) ?? []).find((s) => posn.has(s));
    if (mate == null) {
      flat.push(f);
      posn.set(f, flat.length - 1);
      continue;
    }
    const mi = posn.get(mate)!;
    const coLeft = mi > 0 && (adj.coParents.get(mate) ?? []).includes(flat[mi - 1]);
    flat.splice(coLeft ? mi + 1 : mi, 0, f);
    flat.forEach((id, i) => posn.set(id, i));
  }
  return flat;
}

/**
 * Generation-banded pedigree layout. Bands people by their (authoritative) `gen`, orders each
 * row so every sibship stays contiguous and every couple sits adjacent (see {@link orderRow}),
 * then assigns x-coordinates so children sit centred under their parents. Sibship contiguity
 * stops a union's sibling bus from being drawn across unrelated people or merging with a
 * neighbour's; couple adjacency stops a partner bar from being drawn straight across everyone
 * between two spouses. A person with three or more marriages can only have two neighbours, so
 * their least-structural (childless) partner may still sit a short distance away.
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
  /** True only on a consanguineous union's relationship-line segment — the renderer draws
   * it as a doubled (parallel) line. Never set on sibship/descent/jog/twin segments. */
  double?: boolean;
}

/** Fraction of the descent height (bus → child) at which a monozygotic twin bar is drawn
 * across the converging diagonals. 0 = at the bus, 1 = at the child row. */
const TWIN_BAR_FRACTION = 0.4;

/**
 * Split a segment into two parallel tracks offset ±gap/2 perpendicular to its direction
 * — the doubled-line construction for a consanguineous relationship line. On a zero-length
 * segment returns two coincident copies rather than dividing by zero. Pure.
 */
export function offsetParallel(s: Segment, gap: number): [Segment, Segment] {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len = Math.hypot(dx, dy);
  // Unit perpendicular (−dy, dx)/len; zero-length ⇒ no direction, so no offset (coincident
  // copies) rather than a divide-by-zero.
  const ux = len === 0 ? 0 : -dy / len;
  const uy = len === 0 ? 0 : dx / len;
  const ox = (ux * gap) / 2;
  const oy = (uy * gap) / 2;
  return [
    { x1: s.x1 + ox, y1: s.y1 + oy, x2: s.x2 + ox, y2: s.y2 + oy },
    { x1: s.x1 - ox, y1: s.y1 - oy, x2: s.x2 - ox, y2: s.y2 - oy },
  ];
}

/** A jogged (offset) line of descent awaiting a lane, so its horizontal never coincides with
 * another jog's in the same child row. `mx`→`clampX` is the horizontal reach it occupies. */
interface PendingJog {
  mx: number;
  py: number;
  clampX: number;
  busY: number;
}

/** Maximum vertical gap between adjacent jog lanes (compressed to fit when a generation stacks
 * many lanes), and the minimum riser kept below the parent row so a lane never rides up onto
 * the relationship line. */
const JOG_LANE_GAP = 16;
const JOG_MIN_RISER = 12;

/**
 * Emit the twin-notation segments for a union's `twins` and return the set of member ids that
 * were drawn as twin diagonals (so the caller skips their ordinary individual vertical).
 *
 * For each {@link TwinSet} whose members are laid out: the present members converge on a single
 * confluence point `(midX, busY)` on the sibship bus (`midX` = mean of present members' x), and
 * one diagonal is emitted from that point down to each member's node. A monozygotic set adds one
 * horizontal bar at `barY = busY + (childY − busY) * TWIN_BAR_FRACTION`, spanning the leftmost to
 * the rightmost diagonal's x *at that bar height* — each diagonal's x is interpolated at `barY`
 * so the bar's ends land on the diagonals (generalising cleanly to triplets: one bar across the
 * extremes). A set with fewer than two present members degrades to nothing here, leaving those
 * children their ordinary verticals. Pure arithmetic over computed positions — never a clock, a
 * random source, or {@link Person.gender} (guardrail #4).
 */
function drawTwins(
  twins: TwinSet[] | undefined,
  pos: Record<string, LayoutNode>,
  busY: number,
  segs: Segment[],
): Set<string> {
  const handled = new Set<string>();
  for (const ts of twins ?? []) {
    const present = ts.members.filter((id) => pos[id]);
    if (present.length < 2) continue; // degrade gracefully: too few present → ordinary verticals
    for (const id of present) handled.add(id);
    const midX = present.reduce((s, id) => s + pos[id].x, 0) / present.length;
    // One diagonal per present member, from the shared confluence on the bus to the node.
    for (const id of present) segs.push({ x1: midX, y1: busY, x2: pos[id].x, y2: pos[id].y });
    if (ts.zygosity === 'mono') {
      // Interpolate each diagonal's x at barY: t = (barY − busY)/(memberY − busY) along the
      // diagonal, so the bar's ends sit exactly on the leftmost/rightmost diagonals.
      const childY = pos[present[0]].y;
      const barY = busY + (childY - busY) * TWIN_BAR_FRACTION;
      const xsAtBar = present.map((id) => {
        const my = pos[id].y;
        const t = my === busY ? 0 : (barY - busY) / (my - busY);
        return midX + (pos[id].x - midX) * t;
      });
      segs.push({ x1: Math.min(...xsAtBar), y1: barY, x2: Math.max(...xsAtBar), y2: barY });
    }
  }
  return handled;
}

/**
 * Connector line segments (relationship bars, sibship lines, lines of descent) for a layout,
 * following the standardized (2022 NSGC / Bennett) pedigree line conventions:
 *
 * - a **relationship line** joins two partners at their centres;
 * - a **sibship line** spans *only* the children — never stretched sideways to reach a descent
 *   point that sits over no child (stretching it is what let two unions' buses merge into one
 *   line, so a half-sibling read as the visible couple's child);
 * - a **line of descent** drops from the relationship midpoint (or, for a partner not shown,
 *   straight from the single parent) to the sibship. When that midpoint sits above the sibship
 *   it is a plain vertical; when the sibship is pushed off-centre it jogs — a riser, a short
 *   horizontal, then a drop. Jogs in the same child row that would share a horizontal are
 *   pushed to separate lanes, so two lines of descent never merge into one.
 *
 * Pure and deterministic: lanes are assigned by a single greedy interval-colouring pass keyed
 * on the jog's own horizontal reach (ties broken by `mx`), never a clock or randomness.
 */
export function segments(unions: Union[], pos: Record<string, LayoutNode>): Segment[] {
  const segs: Segment[] = [];
  // Jogged descents are collected per child-row bus level and laned after the main pass; a jog
  // can only conflict with another whose children share its generation.
  const jogsByBus = new Map<number, PendingJog[]>();
  // An exact-duplicate union (same parents and children) is the same relationship recorded
  // twice — e.g. a child whose GEDCOM lists its parentage under two families. Draw it once, or
  // its line of descent stacks into two parallel lines for a single child.
  const drawn = new Set<string>();

  for (const u of unions) {
    // JSON-encode the sorted id sets so ids containing a delimiter can't collide two distinct
    // unions onto one key (which would silently drop the second union's connectors).
    const dedupeKey = JSON.stringify([[...u.parents].sort(), [...(u.children ?? [])].sort()]);
    if (drawn.has(dedupeKey)) continue;
    drawn.add(dedupeKey);
    const parts = u.parents.filter((id) => pos[id]);
    if (parts.length === 2) {
      const a = pos[parts[0]];
      const b = pos[parts[1]];
      // The relationship line is the only segment that carries `double`: a consanguineous
      // union is drawn as a doubled (parallel) line by the renderer.
      segs.push({ x1: a.x, y1: a.cy, x2: b.x, y2: b.cy, double: u.consanguineous === true });
    }
    const kids = (u.children ?? []).filter((id) => pos[id]);
    if (!kids.length) continue;
    const cxs = kids.map((id) => pos[id].x);
    const cmin = Math.min(...cxs);
    const cmax = Math.max(...cxs);
    const busY = pos[kids[0]].y - 22;
    // Sibship line: children only. Each child then hangs from it by its own individual line.
    if (cmax !== cmin) segs.push({ x1: cmin, y1: busY, x2: cmax, y2: busY });
    // Twin sets: members sharing one birth converge on a single confluence point on the bus
    // rather than each dropping its own vertical. Any id drawn as a twin diagonal is collected
    // in `twinMembers` so the ordinary per-child vertical below skips it (non-twin children of
    // the same sibship keep their vertical — both shapes coexist in a mixed sibship). Purely
    // geometric over computed positions; never reads Person.gender (guardrail #4).
    const twinMembers = drawTwins(u.twins, pos, busY, segs);
    for (const cid of kids)
      if (!twinMembers.has(cid))
        segs.push({ x1: pos[cid].x, y1: busY, x2: pos[cid].x, y2: pos[cid].y });
    if (!parts.length) continue; // parentless sibling group: siblings only, no line of descent
    const mx = parts.reduce((s, id) => s + pos[id].x, 0) / parts.length;
    const py = pos[parts[0]].cy;
    if (mx >= cmin && mx <= cmax) {
      // Descent point sits above the sibship — a plain vertical line of descent.
      segs.push({ x1: mx, y1: py, x2: mx, y2: busY });
    } else {
      // Off-centre — a jogged line of descent, landing on the nearest edge of the sibship (an
      // actual child's x, so the drop merges into the sibship line rather than floating).
      const jog: PendingJog = { mx, py, clampX: mx < cmin ? cmin : cmax, busY };
      const bucket = jogsByBus.get(busY);
      if (bucket) bucket.push(jog);
      else jogsByBus.set(busY, [jog]);
    }
  }

  // Lane pass: within each child row, jogs whose horizontals overlap take separate lanes.
  for (const [busY, jogs] of jogsByBus) {
    const ordered = jogs
      .map((j) => ({ j, lo: Math.min(j.mx, j.clampX), hi: Math.max(j.mx, j.clampX) }))
      .sort((p, q) => p.lo - q.lo || p.hi - q.hi || p.j.mx - q.j.mx);
    const laneHi: number[] = []; // rightmost reach claimed by each lane so far
    const laned = ordered.map(({ j, lo, hi }) => {
      let lane = laneHi.findIndex((e) => e < lo - 1); // touch-inclusive: leave a 1px margin
      if (lane === -1) {
        lane = laneHi.length;
        laneHi.push(hi);
      } else laneHi[lane] = hi;
      return { j, lane };
    });
    // Distribute the lanes across the vertical room between the parents and the bus. A fixed
    // gap would saturate (~7 lanes at GEN_HEIGHT) and then collapse every further lane onto one
    // line — silently re-merging descents in a dense generation. Shrinking the step to fit keeps
    // every lane at a distinct height however many overlap. Parents share a generation, so one
    // room/step for the whole child-row bucket keeps the lanes evenly, deterministically spaced.
    const bucketPy = Math.max(...jogs.map((j) => j.py));
    const room = Math.max(busY - bucketPy - JOG_MIN_RISER, JOG_LANE_GAP);
    const step = Math.min(JOG_LANE_GAP, room / laneHi.length);
    for (const { j, lane } of laned) {
      const jogY = busY - step * (lane + 1);
      segs.push({ x1: j.mx, y1: j.py, x2: j.mx, y2: jogY }); // riser
      segs.push({ x1: j.mx, y1: jogY, x2: j.clampX, y2: jogY }); // jog
      segs.push({ x1: j.clampX, y1: jogY, x2: j.clampX, y2: j.busY }); // drop
    }
  }
  return segs;
}

/** Sab of a person as used by the pedigree geometry. */
export function pedigreeSab(p: Person): Sab {
  return sabOf(p);
}
