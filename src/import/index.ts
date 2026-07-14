/**
 * Public surface of the health-data import layer — the inverse of `src/export/`.
 *
 * Seeds a `FamilyRecord` from an existing family tree so users don't retype it
 * (roadmap §3, "Import pipelines — kill the retyping"):
 *
 * - {@link parseGedcom} — GEDCOM 5.5.1 text → structural individuals + families
 * - {@link buildRecordFromGedcom} — those + a chosen proband → a loadable `FamilyRecord`
 */
export { parseGedcom, buildRecordFromGedcom } from './gedcom';
export type { GedcomIndividual, GedcomFamily, ParsedGedcom } from './gedcom';
