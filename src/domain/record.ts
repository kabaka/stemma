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

/** How a new person attaches to an anchor. */
export type Relation = 'partner' | 'child' | 'sibling' | 'parent';

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
