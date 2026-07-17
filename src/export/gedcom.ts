/**
 * GEDCOM 5.5.1 export.
 *
 * Serialises a {@link FamilyRecord} into GEDCOM — the genealogy interchange format
 * from roadmap §4 (`prototype/uploads/Lineage-expansion-ideation.md`) that lets a family
 * tree round-trip with Ancestry / FamilySearch and the like. New in the production app
 * (the prototype had no GEDCOM exporter).
 *
 * Emits `HEAD` (SOUR / GEDC 5.5.1 / CHAR UTF-8 / SUBM), one `INDI` per person and one
 * `FAM` per union, cross-referenced by `@I{n}@` / `@F{n}@` pointers, terminated by
 * `TRLR`. Each person's conditions ride along as a `NOTE`. Pure and deterministic.
 */
import type { FamilyRecord, Person, Sab } from '@/domain/types';
import { sabOf } from '@/domain/person';

const APP = 'Stemma';

/**
 * GEDCOM SEX tag from sex assigned at birth (M / F / U).
 *
 * UAAB (`'x'`) and unknown (`'u'`) both export as GEDCOM 5.5.1 `U` — the standard has no
 * code to distinguish them (lossy); FHIR (`OTH`) and native JSON carry it faithfully.
 */
function sexTag(sab: Sab): string {
  return sab === 'm' ? 'M' : sab === 'f' ? 'F' : 'U';
}

/** Sanitise a value for a GEDCOM line: neutralise `@` and flatten line breaks. */
function gedValue(s: string): string {
  return s
    .replace(/@/g, '@@')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

/**
 * Assign union partners to the GEDCOM HUSB / WIFE slots. Prefers the AMAB partner as
 * HUSB and the AFAB partner as WIFE; any remaining partner (unknown sab, or a
 * same-sab couple) fills whichever slot is still open.
 */
function assignSpouses(
  parents: string[],
  personOf: (id: string) => Person | undefined,
): { husb?: string; wife?: string } {
  const assigned = new Set<string>();
  const sabIs = (id: string, sab: Sab): boolean => {
    const p = personOf(id);
    return !!p && sabOf(p) === sab;
  };
  let husb = parents.find((id) => sabIs(id, 'm'));
  if (husb) assigned.add(husb);
  let wife = parents.find((id) => !assigned.has(id) && sabIs(id, 'f'));
  if (wife) assigned.add(wife);
  const leftover = parents.filter((id) => !assigned.has(id) && personOf(id));
  if (!husb && leftover.length) husb = leftover.shift();
  if (!wife && leftover.length) wife = leftover.shift();
  return { husb, wife };
}

/** Serialise a family record into GEDCOM 5.5.1 text. */
export function buildGedcom(record: FamilyRecord): string {
  const byId = new Map<string, Person>(record.people.map((p) => [p.id, p]));
  const personOf = (id: string): Person | undefined => byId.get(id);
  const indiXref = new Map<string, string>();
  record.people.forEach((p, i) => indiXref.set(p.id, `@I${i + 1}@`));

  const lines: string[] = [];

  // Header.
  lines.push('0 HEAD');
  lines.push(`1 SOUR ${APP}`);
  lines.push(`2 NAME ${APP}`);
  lines.push('1 GEDC');
  lines.push('2 VERS 5.5.1');
  lines.push('2 FORM LINEAGE-LINKED');
  lines.push('1 CHAR UTF-8');
  lines.push('1 SUBM @SUBM1@');
  lines.push('0 @SUBM1@ SUBM');
  lines.push(`1 NAME ${APP}`);

  // Individuals.
  for (const p of record.people) {
    lines.push(`0 ${indiXref.get(p.id)} INDI`);
    lines.push(`1 NAME ${gedValue(p.name)}`);
    lines.push(`1 SEX ${sexTag(sabOf(p))}`);
    if (p.birth != null) {
      lines.push('1 BIRT');
      lines.push(`2 DATE ${p.birth}`);
    }
    if (p.dead) {
      if (p.death != null) {
        lines.push('1 DEAT');
        lines.push(`2 DATE ${p.death}`);
      } else {
        lines.push('1 DEAT Y');
      }
    }
    if (p.conds.length) {
      const note = p.conds
        .map((c) => (c.onset != null ? `${c.id} (onset ${c.onset})` : c.id))
        .join('; ');
      lines.push(`1 NOTE ${gedValue(`Conditions: ${note}`)}`);
    }
  }

  // Families.
  record.unions.forEach((u, i) => {
    lines.push(`0 @F${i + 1}@ FAM`);
    const { husb, wife } = assignSpouses(u.parents, personOf);
    if (husb && indiXref.has(husb)) lines.push(`1 HUSB ${indiXref.get(husb)}`);
    if (wife && indiXref.has(wife)) lines.push(`1 WIFE ${indiXref.get(wife)}`);
    for (const cid of u.children) {
      if (indiXref.has(cid)) lines.push(`1 CHIL ${indiXref.get(cid)}`);
    }
  });

  lines.push('0 TRLR');
  return `${lines.join('\n')}\n`;
}
