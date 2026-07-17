/**
 * Public surface of the health-data export layer.
 *
 * Standards-based serialisers that turn a `FamilyRecord` into open interchange formats
 * (roadmap §4–§5) — no lock-in, so the record outlives the app:
 *
 * - {@link buildFhirBundle} — HL7 FHIR R4 (clinician / EHR)
 * - {@link buildPhenopacket} — GA4GH Phenopacket v2 (geneticist / researcher)
 * - {@link buildGedcom} — GEDCOM 5.5.1 (genealogy)
 * - {@link buildPedigreeSvg} — gender-inclusive pedigree drawing
 * - {@link buildNativeBackup} — lossless full-record backup (no-lock-in escape hatch)
 * - {@link buildIcsCalendar} — iCalendar (RFC 5545) screening schedule (root-scoped)
 */
export { buildFhirBundle } from './fhir';
export type {
  FhirExportOptions,
  FhirBundle,
  FhirBundleEntry,
  FhirResource,
  FhirPatient,
  FhirCondition,
  FhirFamilyMemberHistory,
  FhirCodeableConcept,
  FhirCoding,
} from './fhir';

export { buildPhenopacket } from './phenopacket';
export type { Phenopacket, PhenopacketOptions } from './phenopacket';

export { buildGedcom } from './gedcom';

export { buildPedigreeSvg, windowedPeople } from './pedigree-svg';
export type { PedigreeSvgOptions } from './pedigree-svg';

export { buildNativeBackup, NATIVE_BACKUP_KIND, NATIVE_BACKUP_VERSION } from './native';
export type { NativeBackup, NativeBackupOptions } from './native';

export { buildIcsCalendar } from './ics';
export type { IcsExportOptions } from './ics';
