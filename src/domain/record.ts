/**
 * Pure record-graph mutations. These build the family graph (link a relative, remove a
 * person + prune unions) without any store or React involvement, so the same construction
 * logic is reused by the store *and* by future import pipelines (GEDCOM-in, FHIR-pull —
 * roadmap §3), and is unit-testable at the domain level.
 *
 * All functions return a NEW record (immutable) and never read a clock or generate ids —
 * callers supply the person (id included), keeping these deterministic.
 */
import type { FamilyRecord, Person, Union } from './types';

const X_STEP = 120;

/** How a new person attaches to an anchor. */
export type Relation = 'partner' | 'child' | 'sibling' | 'parent';

/** A person has at most two genetic parents — the single source of truth for the cap the
 * domain enforces here and the UI mirrors for a fast, explained failure (PersonForm's
 * save-guard, PersonDrawer's quick-add filter). */
export const MAX_PARENTS = 2;

/**
 * Link a fully-formed `person` (id already assigned) into the record by its `relation`
 * to `anchorId`, deriving generation and layout position. Returns a new record; if the
 * anchor cannot be resolved, returns the input record unchanged (referentially equal).
 */
export function linkRelative(
  record: FamilyRecord,
  anchorId: string,
  relation: Relation,
  person: Person,
): FamilyRecord {
  const next = structuredClone(record);
  const anchor = next.people.find((p) => p.id === anchorId) ?? next.people.find((p) => p.isProband);
  if (!anchor) return record;

  const np: Person = { ...person, gen: anchor.gen, x: anchor.x + 84 };

  if (relation === 'partner') {
    next.unions.push({ parents: [anchor.id, np.id], children: [] });
  } else if (relation === 'child') {
    let u = next.unions.find((x) => x.parents.includes(anchor.id));
    if (!u) {
      u = { parents: [anchor.id], children: [] };
      next.unions.push(u);
    }
    u.children.push(np.id);
    np.gen = anchor.gen + 1;
    const px = u.parents.map((pid) => next.people.find((p) => p.id === pid)?.x ?? anchor.x);
    np.x = px.reduce((s, v) => s + v, 0) / px.length;
  } else if (relation === 'sibling') {
    let u = next.unions.find((x) => x.children.includes(anchor.id));
    if (!u) {
      u = { parents: [], children: [anchor.id] };
      next.unions.push(u);
    }
    u.children.push(np.id);
    np.gen = anchor.gen;
  } else {
    // parent
    let u = next.unions.find((x) => x.children.includes(anchor.id));
    if (!u) {
      u = { parents: [], children: [anchor.id] };
      next.unions.push(u);
    }
    // Refuse a third parent rather than silently producing a union the pedigree layout
    // can't draw (segments() only bars a 2-parent union). Return the input unchanged so
    // callers can detect the no-op, mirroring the anchor-not-found guard above. The UI
    // also gates this (same MAX_PARENTS) for a fast, explained failure.
    if (u.parents.length >= MAX_PARENTS) return record;
    u.parents.push(np.id);
    np.gen = anchor.gen - 1;
  }

  next.people.push(np);
  return next;
}

/**
 * Remove a person and prune any union left with fewer than two members, returning a new
 * record. Removing the proband is a no-op (the record must always keep its owner) — the
 * input record is returned unchanged (referentially equal) so callers can detect it.
 */
export function removePerson(record: FamilyRecord, id: string): FamilyRecord {
  if (id === record.probandId) return record;
  const next = structuredClone(record);
  next.people = next.people.filter((p) => p.id !== id);
  next.unions = next.unions
    .map((u): Union => ({
      ...u,
      parents: u.parents.filter((x) => x !== id),
      children: u.children.filter((x) => x !== id),
    }))
    .filter((u) => u.parents.length + u.children.length > 1);
  return next;
}

/**
 * Derive a generation index for every person from the union graph alone, without any
 * pre-existing `gen` hints — the inverse of the hand-tuned generations in a curated
 * record. Used when a record is built from an external source (GEDCOM import, and future
 * FHIR-pull) that carries parent/child structure but no layout.
 *
 * Propagates the constraint "a child is one generation below each parent, partners share
 * a generation" across the graph with a signed breadth-first search, then normalises so
 * the oldest generation present is `0` (lower = older, matching {@link Person.gen}).
 * Disconnected family components are each internally consistent; their relative vertical
 * offset is arbitrary. Pure and deterministic; first assignment wins, so a contradictory
 * cycle from malformed data degrades gracefully rather than looping.
 */
export function deriveGenerations(people: Person[], unions: Union[]): Map<string, number> {
  const ids = new Set(people.map((p) => p.id));
  const adj = new Map<string, Array<{ to: string; delta: number }>>();
  const link = (a: string, b: string, delta: number): void => {
    const edges = adj.get(a);
    if (edges) edges.push({ to: b, delta });
    else adj.set(a, [{ to: b, delta }]);
  };
  const sameGen = (a: string, b: string): void => {
    link(a, b, 0);
    link(b, a, 0);
  };

  for (const u of unions) {
    const parents = u.parents.filter((id) => ids.has(id));
    const children = u.children.filter((id) => ids.has(id));
    for (let i = 0; i < parents.length; i++) {
      for (let j = i + 1; j < parents.length; j++) sameGen(parents[i], parents[j]);
      for (const c of children) {
        link(parents[i], c, 1);
        link(c, parents[i], -1);
      }
    }
    // Siblings share a generation even when the union lists no parents.
    for (let i = 0; i < children.length; i++)
      for (let j = i + 1; j < children.length; j++) sameGen(children[i], children[j]);
  }

  const gen = new Map<string, number>();
  for (const seed of people) {
    if (gen.has(seed.id)) continue;
    gen.set(seed.id, 0);
    const queue = [seed.id];
    while (queue.length) {
      const cur = queue.shift() as string;
      const g = gen.get(cur) as number;
      for (const e of adj.get(cur) ?? []) {
        if (!gen.has(e.to)) {
          gen.set(e.to, g + e.delta);
          queue.push(e.to);
        }
      }
    }
  }

  let min = Number.POSITIVE_INFINITY;
  for (const v of gen.values()) if (v < min) min = v;
  if (Number.isFinite(min) && min !== 0) for (const [k, v] of gen) gen.set(k, v - min);
  return gen;
}

/**
 * Assign `gen` and `x` layout coordinates to every person from the union graph, returning
 * a new record — the structural placement step for a record built from external parentage
 * (GEDCOM import, future FHIR-pull) that has no layout of its own. Distinct from, and a
 * predecessor to, `computeLayout` (`src/domain/graph.ts`): this derives the stored
 * `gen`/`x` from the graph; `computeLayout` later turns those into de-overlapped pixels.
 *
 * Generations come from {@link deriveGenerations}; within each generation people are
 * ordered by the average horizontal position of their parents (a barycentre pass,
 * top-down) so children sit under their parents and edge crossings are reduced, then
 * spaced evenly. People with no placed parents (e.g. a married-in partner) keep the
 * record's own order and trail the positioned family. Pure and deterministic.
 */
export function layoutFromGraph(record: FamilyRecord): FamilyRecord {
  const gen = deriveGenerations(record.people, record.unions);
  const genOf = (id: string): number => gen.get(id) ?? 0;

  const parentsByChild = new Map<string, string[]>();
  for (const u of record.unions)
    for (const c of u.children) {
      const arr = parentsByChild.get(c);
      if (arr) arr.push(...u.parents);
      else parentsByChild.set(c, [...u.parents]);
    }

  const fileIndex = new Map(record.people.map((p, i) => [p.id, i]));
  const byGen = new Map<number, Person[]>();
  for (const p of record.people) {
    const arr = byGen.get(genOf(p.id));
    if (arr) arr.push(p);
    else byGen.set(genOf(p.id), [p]);
  }

  const x = new Map<string, number>();
  const gensAsc = [...byGen.keys()].sort((a, b) => a - b);
  for (const g of gensAsc) {
    // Barycentre of a node's already-placed parents; +Infinity when it has none, so
    // rootless people sort after the positioned family, in the record's own order.
    const key = (p: Person): number => {
      const placed = (parentsByChild.get(p.id) ?? []).filter((pid) => x.has(pid));
      if (!placed.length) return Number.POSITIVE_INFINITY;
      return placed.reduce((s, pid) => s + (x.get(pid) as number), 0) / placed.length;
    };
    const ordered = [...(byGen.get(g) as Person[])].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka !== kb) return ka - kb;
      return (fileIndex.get(a.id) as number) - (fileIndex.get(b.id) as number);
    });
    ordered.forEach((p, i) => x.set(p.id, i * X_STEP));
  }

  return {
    ...record,
    people: record.people.map((p) => ({ ...p, gen: genOf(p.id), x: x.get(p.id) ?? 0 })),
  };
}

/**
 * Minimal structural guard for a {@link FamilyRecord}. Verifies the four collections have
 * the right shape and that the record has a resolvable proband. Used at two boundaries
 * where a record enters state from outside the trusted mutation path: `localStorage`
 * hydration (a corrupt or schema-outdated blob) and `replaceRecord` (an imported or
 * otherwise externally-built record). The durable asset "must outlive the app," so both
 * paths validate rather than trust the incoming shape.
 */
export function isValidRecord(r: unknown): r is FamilyRecord {
  if (!r || typeof r !== 'object') return false;
  const rec = r as Partial<FamilyRecord>;
  return (
    Array.isArray(rec.people) &&
    Array.isArray(rec.unions) &&
    Array.isArray(rec.timeline) &&
    typeof rec.probandId === 'string' &&
    rec.people.some((p) => (p as Person | undefined)?.id === rec.probandId)
  );
}
