/**
 * GEDCOM 5.5.1 import — the inverse of {@link buildGedcom} (`src/export/gedcom.ts`).
 *
 * Seeds the family pedigree from an existing family tree (roadmap §3, "Import pipelines"):
 * a GEDCOM file exported from Ancestry, FamilySearch, Gramps, or Stemma itself. Parsing is
 * pure and deterministic — no network, no clock, no ids-from-random — so the whole flow
 * runs client-side and stays unit-testable, matching the local-first, no-lock-in stance.
 *
 * Scope is deliberately **structural**: people (name, sex-assigned-at-birth from `SEX`,
 * birth/death years) and the parent/child graph (`FAM`). Health conditions are **not**
 * imported — a genealogy export carries none, and inferring them from free-text `NOTE`s
 * would misattribute clinical facts. Conditions are entered in Stemma (or, later, pulled
 * from a clinical source). `SEX` maps to `sab`; a display `gender` is defaulted from it and
 * is freely editable afterwards, honouring the 2022 NSGC genetics-vs-identity split.
 */
import type { FamilyRecord, Gender, Person, Sab, Union } from '@/domain/types';
import { layoutFromGraph } from '@/domain/record';

/** One imported individual — the structural fields a genealogy `INDI` record carries. */
export interface GedcomIndividual {
  /** Stable id derived from the GEDCOM cross-reference pointer (e.g. `@I1@` → `I1`). */
  id: string;
  name: string;
  /** Sex assigned at birth, from the `SEX` tag (M/F → m/f, anything else → u). */
  sab: Sab;
  birth: number | null;
  death: number | null;
  dead: boolean;
}

/** One imported family (`FAM`): the parents and children of a union, by individual id. */
export interface GedcomFamily {
  parents: string[];
  children: string[];
}

/** The structural result of parsing GEDCOM text, before mapping to a {@link FamilyRecord}. */
export interface ParsedGedcom {
  individuals: GedcomIndividual[];
  families: GedcomFamily[];
  /** Non-fatal issues worth surfacing to the user (dangling links, empty file, …). */
  warnings: string[];
}

/** A parsed GEDCOM line as a node in the record tree. */
interface GedcomNode {
  level: number;
  tag: string;
  value: string;
  /** Cross-reference id for a record-defining line (`0 @I1@ INDI`), else `null`. */
  xref: string | null;
  children: GedcomNode[];
}

/**
 * GEDCOM nesting never exceeds a handful of levels; the spec caps it well below this. The
 * bound also guards `buildTree`'s `stack.length = level + 1` against a crafted line whose
 * level overflows the max array length (which would throw `RangeError` and break the
 * "never throws" contract) — such a line is simply treated as invalid and skipped.
 */
const MAX_LEVEL = 100;

/** Split one raw line into its GEDCOM parts, or `null` if it isn't a valid line. */
function parseLine(raw: string): Omit<GedcomNode, 'children'> | null {
  const line = raw.trim();
  if (!line) return null;
  const head = /^(\d+)\s+(.*)$/.exec(line);
  if (!head) return null;
  const level = Number.parseInt(head[1], 10);
  if (!Number.isSafeInteger(level) || level > MAX_LEVEL) return null;
  let rest = head[2];
  let xref: string | null = null;
  // A leading @…@ token is the record's own cross-reference id; a pointer that appears as
  // a value (e.g. `1 HUSB @I1@`) does not start `rest`, so it stays in `value`.
  const ptr = /^(@[^@]+@)\s+(.*)$/.exec(rest);
  if (ptr) {
    xref = ptr[1];
    rest = ptr[2];
  }
  const tagged = /^(\S+)(?:\s([\s\S]*))?$/.exec(rest);
  if (!tagged) return null;
  return { level, xref, tag: tagged[1].toUpperCase(), value: (tagged[2] ?? '').trim() };
}

/** Build the level-nested record tree from GEDCOM text. Tolerant of malformed depth. */
function buildTree(text: string): GedcomNode[] {
  const roots: GedcomNode[] = [];
  const stack: GedcomNode[] = [];
  // Normalise a possible BOM and any CRLF / lone-CR line endings (GEDCOM allows all).
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (const raw of normalized.split('\n')) {
    const parsed = parseLine(raw);
    if (!parsed) continue;
    const node: GedcomNode = { ...parsed, children: [] };
    const parent = node.level > 0 ? stack[node.level - 1] : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack[node.level] = node;
    stack.length = node.level + 1;
  }
  return roots;
}

const child = (node: GedcomNode, tag: string): GedcomNode | undefined =>
  node.children.find((c) => c.tag === tag);

const childValue = (node: GedcomNode, tag: string): string => child(node, tag)?.value ?? '';

/**
 * A node's value, folding in the GEDCOM `CONC` (concatenate, no separator) and `CONT`
 * (continue on a new line) subtags that source tools use to wrap a value that exceeds
 * their line-length limit. The model holds single-line display strings, so `CONT` breaks
 * flatten to a space.
 */
function fullValue(node: GedcomNode): string {
  let out = node.value;
  for (const c of node.children) {
    if (c.tag === 'CONC') out += c.value;
    else if (c.tag === 'CONT') out += ` ${c.value}`;
  }
  return out;
}

/** Property names that are unsafe as plain-object keys downstream (e.g. `computeLayout`'s
 * layout map), so a crafted `@__proto__@` cross-reference can't reach one. */
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);

/** Strip the `@…@` delimiters from a cross-reference pointer, e.g. `@I1@` → `I1`. */
function xrefToId(xref: string | null): string {
  const id = (xref ?? '').replace(/@/g, '').trim();
  return RESERVED_IDS.has(id) ? `id-${id}` : id;
}

/**
 * Extract a 4- (or 3-) digit year from a GEDCOM date value. GEDCOM dates come in many
 * shapes — `1950`, `12 NOV 1950`, `ABT 1950`, `BEF 1 JAN 1960`, `BET 1940 AND 1950` — but
 * the model only needs the year, so take the first run of 3–4 digits (day/month numbers
 * are 1–2 digits and never match). Returns `null` when no year is present.
 */
function extractYear(date: string): number | null {
  const m = /\b(\d{3,4})\b/.exec(date);
  return m ? Number.parseInt(m[1], 10) : null;
}

/** Sex assigned at birth from the GEDCOM `SEX` value. */
function sabFromSex(sex: string): Sab {
  const s = sex.trim().toUpperCase();
  return s === 'M' ? 'm' : s === 'F' ? 'f' : 'u';
}

/**
 * Clean a GEDCOM personal name into a plain display name. The `/…/` slashes that delimit
 * the surname (`John /Smith/`) are removed and whitespace collapsed.
 */
function cleanName(raw: string): string {
  return raw.replace(/\//g, ' ').replace(/\s+/g, ' ').trim();
}

/** Display gender defaulted from sex assigned at birth (editable after import). */
function genderFromSab(sab: Sab): Gender {
  return sab === 'm' ? 'man' : sab === 'f' ? 'woman' : 'nb';
}

/** Pedigree-linkage values that mark a child as NOT the genetic offspring of a parent. Kept
 * deliberately narrow: only the unambiguous non-biological types. `natural`, `birth`,
 * `unknown`, `sealed`, `related`, and an absent tag all stay (treated as genetic) —
 * critically, `unknown` is Ancestry's default for an unspecified-but-biological link, so it
 * must not be dropped. Applied per parent (`_FREL`/`_MREL`) or per child (`PEDI`) in the
 * family loop, so a child biological to one parent keeps that edge. */
const NON_BIOLOGICAL_PEDI = new Set(['step', 'adopted', 'adoptive', 'foster', 'guardian']);

/** Parse GEDCOM text into its structural individuals and families. Never throws. */
export function parseGedcom(text: string): ParsedGedcom {
  const roots = buildTree(text);
  const warnings: string[] = [];

  const individuals: GedcomIndividual[] = [];
  const knownIds = new Set<string>();
  // Standard GEDCOM records an adopted/foster child's pedigree on the *individual's* `FAMC`
  // pointer (`INDI.FAMC.PEDI`), not on the family's `CHIL` — keyed here by `child|family` so
  // the family loop below can honour it alongside Ancestry's `_FREL`/`_MREL` convention.
  const famcPedi = new Map<string, string>();
  let duplicateIds = 0;
  roots
    .filter((n) => n.tag === 'INDI')
    .forEach((n, i) => {
      const id = xrefToId(n.xref) || `indi-${i}`;
      if (knownIds.has(id)) {
        duplicateIds++; // duplicate cross-reference — keep the first, count the rest
        return;
      }
      knownIds.add(id);

      for (const fc of n.children) {
        if (fc.tag !== 'FAMC') continue;
        const famId = xrefToId(fc.value);
        const pedi = childValue(fc, 'PEDI').trim().toLowerCase();
        if (famId && pedi) famcPedi.set(`${id}|${famId}`, pedi);
      }

      const nameNode = child(n, 'NAME');
      let name = cleanName(nameNode ? fullValue(nameNode) : '');
      if (!name && nameNode) {
        // Structured name: assemble from GIVN + SURN subtags.
        name = cleanName(`${childValue(nameNode, 'GIVN')} ${childValue(nameNode, 'SURN')}`);
      }
      if (!name) name = '(unknown)';

      const birthNode = child(n, 'BIRT');
      const deathNode = child(n, 'DEAT');
      individuals.push({
        id,
        name,
        sab: sabFromSex(childValue(n, 'SEX')),
        birth: birthNode ? extractYear(childValue(birthNode, 'DATE')) : null,
        death: deathNode ? extractYear(childValue(deathNode, 'DATE')) : null,
        dead: !!deathNode,
      });
    });

  const families: GedcomFamily[] = [];
  let dangling = 0;
  let stepLinks = 0;
  // First known individual referenced by a `FAM` sub-tag; counts an unknown reference as a
  // dangling link (matching the old `resolve` behaviour).
  const resolveOne = (value: string): string | null => {
    const id = xrefToId(value);
    if (!id) return null;
    if (knownIds.has(id)) return id;
    dangling++;
    return null;
  };
  for (const n of roots.filter((n) => n.tag === 'FAM')) {
    const famId = xrefToId(n.xref);
    const husbands: string[] = [];
    const wives: string[] = [];
    for (const c of n.children) {
      if (c.tag === 'HUSB') {
        const id = resolveOne(c.value);
        if (id != null) husbands.push(id);
      } else if (c.tag === 'WIFE') {
        const id = resolveOne(c.value);
        if (id != null) wives.push(id);
      }
    }
    let husb: string | null = husbands[0] ?? null;
    let wife: string | null = wives[0] ?? null;
    // A couple encoded as two HUSB or two WIFE (some tools' same-sex-couple convention): use the
    // second as the other parent slot so it is not silently dropped. The `_FREL`/`_MREL` step
    // tags are an Ancestry convention that assumes one HUSB + one WIFE and won't co-occur here.
    if (wife == null && husbands.length > 1) wife = husbands[1];
    else if (husb == null && wives.length > 1) husb = wives[1];

    // Stemma's graph is *genetic* parentage only. Resolve each child's relationship to each
    // parent separately: a child linked step / adopted / foster to one parent (Ancestry's
    // per-parent `_FREL`/`_MREL`, or the child-level `PEDI` from either the `CHIL` sub-tag or
    // the individual's `FAMC`) is not that parent's genetic offspring and gets no edge to
    // them — but its edge to the *other*, biological parent is kept. `unknown`/`natural`/
    // absent all stay genetic. Children who share a biological-parent set form one union;
    // this is why a `FAM` can yield the couple's union plus a single-parent union for a
    // step-child who is biological to only one of them.
    const both: string[] = [];
    const fatherOnly: string[] = [];
    const motherOnly: string[] = [];
    const allKids: string[] = [];
    for (const c of n.children) {
      if (c.tag !== 'CHIL') continue;
      const cid = resolveOne(c.value);
      if (cid == null) continue;
      allKids.push(cid);
      const nonBio = (v: string): boolean => NON_BIOLOGICAL_PEDI.has(v.trim().toLowerCase());
      const pedi =
        childValue(c, 'PEDI').trim().toLowerCase() || famcPedi.get(`${cid}|${famId}`) || '';
      const pediNonBio = NON_BIOLOGICAL_PEDI.has(pedi);
      const fatherBio = husb != null && !nonBio(childValue(c, '_FREL')) && !pediNonBio;
      const motherBio = wife != null && !nonBio(childValue(c, '_MREL')) && !pediNonBio;
      if (fatherBio && motherBio) both.push(cid);
      else if (fatherBio) fatherOnly.push(cid);
      else if (motherBio) motherOnly.push(cid);
      // A child with at least one *present* parent excluded had a relationship trimmed.
      if ((husb != null && !fatherBio) || (wife != null && !motherBio)) stepLinks++;
    }

    const couple = [husb, wife].filter((x): x is string => x != null);
    if (couple.length === 0) {
      // No resolvable parents — keep the children as a parentless sibling group (their union
      // carries no genetic edge, but it groups the siblings for generation/layout).
      if (allKids.length) families.push({ parents: [], children: allKids });
    } else {
      // The couple's own union (their shared genetic children). Emitted whenever it has a known
      // member or child; a degenerate single-parent/childless entry is harmless —
      // `buildRecordFromGedcom` prunes it (it keeps only a couple or a parent+child).
      if (couple.length + both.length > 0) families.push({ parents: couple, children: both });
      // A step-child biological to only one parent joins that parent alone.
      if (husb != null && fatherOnly.length)
        families.push({ parents: [husb], children: fatherOnly });
      if (wife != null && motherOnly.length)
        families.push({ parents: [wife], children: motherOnly });
    }
  }

  if (!individuals.length) {
    warnings.push('No individuals (INDI records) were found in this file.');
  }
  if (dangling) {
    warnings.push(
      `${dangling} family ${dangling === 1 ? 'link referenced an unknown person and was' : 'links referenced unknown people and were'} skipped.`,
    );
  }
  if (duplicateIds) {
    warnings.push(
      `${duplicateIds} ${duplicateIds === 1 ? 'individual shared an id with an earlier record and was' : 'individuals shared ids with earlier records and were'} skipped.`,
    );
  }
  if (stepLinks) {
    warnings.push(
      `${stepLinks} step, adopted, or foster ${stepLinks === 1 ? 'child link was' : 'child links were'} not imported as a blood relationship (Stemma tracks genetic parentage).`,
    );
  }

  return { individuals, families, warnings };
}

/**
 * Map a {@link ParsedGedcom} to a {@link FamilyRecord}, ready to load into the store.
 * `probandId` designates the record owner ("you"); it defaults to the first individual
 * when omitted or unknown, since GEDCOM has no proband concept. Generations and layout are
 * derived from the union graph via {@link layoutFromGraph}. Returns `null` when there is
 * nothing to import (no individuals).
 */
export function buildRecordFromGedcom(
  parsed: ParsedGedcom,
  probandId?: string,
): FamilyRecord | null {
  if (!parsed.individuals.length) return null;
  const proband =
    parsed.individuals.find((p) => p.id === probandId)?.id ?? parsed.individuals[0].id;

  const people: Person[] = parsed.individuals.map((ind) => ({
    id: ind.id,
    name: ind.name,
    sab: ind.sab,
    gender: genderFromSab(ind.sab),
    gen: 0,
    x: 0,
    dead: ind.dead,
    birth: ind.birth,
    death: ind.death,
    conds: [],
    ...(ind.id === proband ? { isProband: true } : {}),
  }));

  const unions: Union[] = parsed.families
    .map((f) => {
      const parents = [...f.parents];
      const parentSet = new Set(parents);
      // Drop a child also listed as a parent of the same union (self-parentage from a
      // malformed file) — a person cannot be their own parent.
      return { parents, children: f.children.filter((c) => !parentSet.has(c)) };
    })
    // Drop a degenerate family that is neither a couple nor a parent-with-child.
    .filter((u) => u.children.length > 0 || u.parents.length >= 2);

  return layoutFromGraph({ people, unions, timeline: [], probandId: proband });
}
