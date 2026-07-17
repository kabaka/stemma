/**
 * Person-level helpers: gender-inclusive identity, organ inventory, and condition
 * access. These centralise the 2022 NSGC split between sex-assigned-at-birth (drives
 * genetics + screening) and gender identity (drives display).
 */
import type { ConditionEntry, Gender, Organ, Person, Sab } from './types';

/** All screening-relevant organs, in display order. */
export const ORGANS: readonly Organ[] = ['breasts', 'ovaries', 'uterus', 'cervix', 'prostate'];

export const ORGAN_LABELS: Record<Organ, string> = {
  breasts: 'Breasts',
  ovaries: 'Ovaries',
  uterus: 'Uterus',
  cervix: 'Cervix',
  prostate: 'Prostate',
};

/** Sex assigned at birth. */
export function sabOf(p: Person): Sab {
  return p.sab ?? 'u';
}

/** Gender identity. */
export function genderOf(p: Person): Gender {
  return p.gender;
}

/** The organ inventory implied by a sab when none is recorded explicitly. */
export function defaultOrgans(sab: Sab): Organ[] {
  if (sab === 'f') return ['breasts', 'ovaries', 'uterus', 'cervix'];
  if (sab === 'm') return ['prostate'];
  return [];
}

/** A person's organ inventory — explicit if recorded, else derived from sab. */
export function organsOf(p: Person): Organ[] {
  return p.organs ?? defaultOrgans(sabOf(p));
}

export function sabLabel(sab: Sab): string {
  return sab === 'f' ? 'AFAB' : sab === 'm' ? 'AMAB' : sab === 'x' ? 'UAAB' : 'unknown';
}

export function genderLabel(g: Gender): string {
  return g === 'man' ? 'Man' : g === 'woman' ? 'Woman' : 'Nonbinary';
}

export function genderSymbol(g: Gender): string {
  return g === 'man' ? '♂' : g === 'woman' ? '♀' : '⚥';
}

/** Condition ids recorded on a person. */
export function condIds(p: Person): string[] {
  return (p.conds ?? []).map((c) => c.id);
}

/** Whether a person carries a condition. */
export function hasCond(p: Person, id: string): boolean {
  return condIds(p).includes(id);
}

/** The recorded entry for a condition on a person, if present. */
export function condEntry(p: Person, id: string): ConditionEntry | undefined {
  return (p.conds ?? []).find((c) => c.id === id);
}

/**
 * Age of a person as of `asOfYear`. For the deceased, the age at death; for the
 * living, current age. `null` when birth year is unknown.
 */
export function ageOf(p: Person, asOfYear: number): number | null {
  if (p.birth == null) return null;
  if (p.dead && p.death != null) return p.death - p.birth;
  return asOfYear - p.birth;
}
