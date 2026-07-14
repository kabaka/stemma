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

export { buildPhenopacket, AS_OF_YEAR } from './phenopacket';
export type { Phenopacket, PhenopacketOptions } from './phenopacket';

export { buildGedcom } from './gedcom';

export { buildPedigreeSvg } from './pedigree-svg';
export type { PedigreeSvgOptions } from './pedigree-svg';
