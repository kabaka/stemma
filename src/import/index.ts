/**
 * Public surface of the health-data import layer — the inverse of `src/export/`.
 *
 * Seeds a `FamilyRecord` from an existing family tree so users don't retype it
 * (roadmap §3, "Import pipelines — kill the retyping"):
 *
 * - {@link parseGedcom} — GEDCOM 5.5.1 text → structural individuals + families
 * - {@link buildRecordFromGedcom} — those + a chosen proband → a loadable `FamilyRecord`
 * - {@link parseNativeBackup} — a Stemma native backup envelope → record + extensions
 * - {@link parseCcda} / {@link stageCcdaImport} / {@link applyCcdaImport} — a C-CDA (CCD) patient
 *   record → parsed problems + family history → a reviewed, merged `FamilyRecord` + extensions
 */
export { parseGedcom, buildRecordFromGedcom } from './gedcom';
export type { GedcomIndividual, GedcomFamily, ParsedGedcom } from './gedcom';

export { parseNativeBackup } from './native';
export type { NativeRestore } from './native';

export { parseCcda, stageCcdaImport, applyCcdaImport } from './ccda';
export type {
  ParsedCcda,
  CcdaProblemEntry,
  CcdaFamilyMember,
  StagedCcdaImport,
  StagedCondition,
  StagedFamilyMember,
  CcdaSelections,
  CcdaMemberOverride,
} from './ccda';

// The source-agnostic reconciliation & merge engine (hoisted from `ccda.ts`), for the forthcoming
// FHIR importer to reuse without the C-CDA-named surface. `ccda.ts` re-exports the same functions
// and types under their established C-CDA names — these are the source-neutral spellings.
export { stageHealthRecordImport, applyHealthRecordImport } from './health-record';
export type {
  ParsedHealthRecord,
  ProblemEntry,
  RelativeEntry,
  StagedHealthRecordImport,
  HealthRecordSelections,
  MemberOverride,
} from './health-record';
