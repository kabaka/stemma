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

/** Split one raw line into its GEDCOM parts, or `null` if it isn't a valid line. */
function parseLine(raw: string): Omit<GedcomNode, 'children'> | null {
  const line = raw.trim();
  if (!line) return null;
  const head = /^(\d+)\s+(.*)$/.exec(line);
  if (!head) return null;
  const level = Number.parseInt(head[1], 10);
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

/** Strip the `@…@` delimiters from a cross-reference pointer, e.g. `@I1@` → `I1`. */
function xrefToId(xref: string | null): string {
  return (xref ?? '').replace(/@/g, '').trim();
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

/** Parse GEDCOM text into its structural individuals and families. Never throws. */
export function parseGedcom(text: string): ParsedGedcom {
  const roots = buildTree(text);
  const warnings: string[] = [];

  const individuals: GedcomIndividual[] = [];
  const knownIds = new Set<string>();
  roots
    .filter((n) => n.tag === 'INDI')
    .forEach((n, i) => {
      const id = xrefToId(n.xref) || `indi-${i}`;
      if (knownIds.has(id)) return; // duplicate cross-reference — keep the first
      knownIds.add(id);

      const nameNode = child(n, 'NAME');
      let name = cleanName(nameNode?.value ?? '');
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
  const resolve = (value: string, into: string[]): void => {
    const id = xrefToId(value);
    if (!id) return;
    if (knownIds.has(id)) into.push(id);
    else dangling++;
  };
  for (const n of roots.filter((n) => n.tag === 'FAM')) {
    const parents: string[] = [];
    const children: string[] = [];
    for (const c of n.children) {
      if (c.tag === 'HUSB' || c.tag === 'WIFE') resolve(c.value, parents);
      else if (c.tag === 'CHIL') resolve(c.value, children);
    }
    if (parents.length + children.length > 0) families.push({ parents, children });
  }

  if (!individuals.length) {
    warnings.push('No individuals (INDI records) were found in this file.');
  }
  if (dangling) {
    warnings.push(
      `${dangling} family ${dangling === 1 ? 'link referenced an unknown person and was' : 'links referenced unknown people and were'} skipped.`,
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
    .map((f) => ({ parents: [...f.parents], children: [...f.children] }))
    // Drop a degenerate family that is neither a couple nor a parent-with-child.
    .filter((u) => u.children.length > 0 || u.parents.length >= 2);

  return layoutFromGraph({ people, unions, timeline: [], probandId: proband });
}
