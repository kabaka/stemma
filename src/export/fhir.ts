/**
 * HL7 FHIR R4 export.
 *
 * Serialises a {@link FamilyRecord} into a FHIR R4 `Bundle` (type `collection`) — the
 * clinician / EHR interchange target from roadmap §4 (`prototype/uploads/Lineage-expansion-ideation.md`).
 * The bundle carries one `Patient` for the proband, a `Condition` per proband
 * diagnosis, and one `FamilyMemberHistory` per blood relative (relationship, sex,
 * deceased flag, and coded conditions).
 *
 * Ported faithfully from the prototype's `buildFHIR`, with one improvement: condition
 * codes now carry an ICD-10-CM coding alongside SNOMED CT and the internal Stemma code
 * system (see {@link fhirCode}). Pure and deterministic given `opts.now`.
 */
import type { Catalog } from '@/domain/catalog';
import type { FamilyRecord, Gender, Sab } from '@/domain/types';
import { condEntry, condIds, genderOf, sabOf } from '@/domain/person';
import { indexPeople, personById, relationInfo } from '@/domain/graph';

// --- FHIR resource shapes (only the subset this exporter emits) ---

export interface FhirCoding {
  system: string;
  code: string;
  display?: string;
}
export interface FhirCodeableConcept {
  coding: FhirCoding[];
  text?: string;
}
export interface FhirAge {
  value: number;
  unit: string;
  system: string;
  code: string;
}
export interface FhirReference {
  reference: string;
}
export interface FhirExtension {
  url: string;
  valueCode: string;
}
export interface FhirHumanName {
  text: string;
  given: string[];
}
export interface FhirPatient {
  resourceType: 'Patient';
  id: string;
  extension: FhirExtension[];
  name: FhirHumanName[];
  gender: string;
  birthDate?: string;
}
export interface FhirCondition {
  resourceType: 'Condition';
  id: string;
  clinicalStatus: FhirCodeableConcept;
  code: FhirCodeableConcept;
  subject: FhirReference;
  onsetAge?: FhirAge;
  /**
   * Precise onset as a FHIR `dateTime` — a {@link import('@/domain/types').PartialDate}
   * (`"YYYY"` | `"YYYY-MM"` | `"YYYY-MM-DD"`) is a valid FHIR dateTime. Emitted in place of
   * {@link onsetAge} when the source gave a precise onset date; FHIR permits exactly one
   * `onset[x]`, so the two are mutually exclusive.
   */
  onsetDateTime?: string;
}
export interface FhirFamilyMemberCondition {
  code: FhirCodeableConcept;
  onsetAge?: FhirAge;
}
export interface FhirFamilyMemberHistory {
  resourceType: 'FamilyMemberHistory';
  id: string;
  status: string;
  patient: FhirReference;
  name: string;
  relationship: FhirCodeableConcept;
  sex: FhirCodeableConcept;
  deceasedBoolean?: boolean;
  condition?: FhirFamilyMemberCondition[];
}
export type FhirResource = FhirPatient | FhirCondition | FhirFamilyMemberHistory;
export interface FhirBundleEntry {
  resource: FhirResource;
}
export interface FhirBundle {
  resourceType: 'Bundle';
  type: 'collection';
  /** ISO generation timestamp, injected by the caller (the sanctioned wall-clock boundary). */
  timestamp: string;
  entry: FhirBundleEntry[];
}

export interface FhirExportOptions {
  /** ISO timestamp for `Bundle.timestamp`, injected by the caller (no clock read here — stays pure). */
  now: string;
}

const SNOMED_SYSTEM = 'http://snomed.info/sct';
const ICD10_SYSTEM = 'http://hl7.org/fhir/sid/icd-10-cm';
const INTERNAL_SYSTEM = 'https://kabaka.github.io/stemma/fhir/CodeSystem/conditions';
const BIRTHSEX_URL = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-birthsex';
const CLINICAL_STATUS_SYSTEM = 'http://terminology.hl7.org/CodeSystem/condition-clinical';
const ROLE_CODE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v3-RoleCode';
const ADMIN_GENDER_SYSTEM = 'http://hl7.org/fhir/administrative-gender';
const UCUM_SYSTEM = 'http://unitsofmeasure.org';

/**
 * CodeableConcept for a condition id. Emits SNOMED CT and — new versus the prototype —
 * ICD-10-CM codings when the catalog carries them, always followed by the internal
 * Stemma code so long-tail ids stay resolvable.
 */
function fhirCode(id: string, catalog: Catalog): FhirCodeableConcept {
  const meta = catalog.get(id);
  const coding: FhirCoding[] = [];
  if (meta.snomed) coding.push({ system: SNOMED_SYSTEM, code: meta.snomed, display: meta.name });
  if (meta.icd10) coding.push({ system: ICD10_SYSTEM, code: meta.icd10, display: meta.name });
  coding.push({ system: INTERNAL_SYSTEM, code: id, display: meta.name });
  return { coding, text: meta.name };
}

/** v3-RoleCode for a relationship label, or `null` when none maps. */
function relRoleCode(rel: string): string | null {
  const r = rel.replace(/^(Paternal|Maternal)\s+/i, '').toLowerCase();
  const map: Record<string, string> = {
    father: 'FTH',
    mother: 'MTH',
    parent: 'PRN',
    brother: 'BRO',
    sister: 'SIS',
    sibling: 'SIB',
    son: 'SONC',
    daughter: 'DAUC',
    child: 'CHILD',
    grandfather: 'GRFTH',
    grandmother: 'GRMTH',
    grandparent: 'GRPRN',
    grandson: 'GRNDSON',
    granddaughter: 'GRNDDAU',
    grandchild: 'GRNDCHILD',
    uncle: 'UNCLE',
    aunt: 'AUNT',
    'aunt/uncle': 'PIBLING',
    nephew: 'NEPHEW',
    niece: 'NIECE',
    nibling: 'NIENEPH',
    cousin: 'COUSN',
    spouse: 'SPS',
  };
  if (map[r]) return map[r];
  if (/great-grand(father|mother|parent)/.test(r)) return 'GGRPRN';
  if (/great-(uncle|aunt)/.test(r)) return 'EXT';
  return null;
}

function fhirGender(g: Gender): string {
  return g === 'man' ? 'male' : g === 'woman' ? 'female' : 'other';
}

/** us-core-birthsex value code from sex assigned at birth. */
function birthSex(sab: Sab): string {
  // UAAB ('x') → 'OTH' (v3-NullFlavor: "actual value not in the permitted M/F set") — a
  // real, distinct code carrying UAAB faithfully, NOT the same as unknown ('u') → 'UNK'.
  return sab === 'f' ? 'F' : sab === 'm' ? 'M' : sab === 'x' ? 'OTH' : 'UNK';
}

/** administrative-gender code from sex assigned at birth. */
function adminGender(sab: Sab): string {
  // UAAB ('x') intentionally falls through to 'unknown' here: gender is not birth sex, so we
  // never derive administrative-gender 'other' from SAB.
  return sab === 'f' ? 'female' : sab === 'm' ? 'male' : 'unknown';
}

function onsetAge(onset: number | null | undefined): FhirAge | undefined {
  if (onset == null) return undefined;
  return { value: onset, unit: 'years', system: UCUM_SYSTEM, code: 'a' };
}

/** Serialise a family record into a FHIR R4 collection Bundle. */
export function buildFhirBundle(
  record: FamilyRecord,
  catalog: Catalog,
  opts: FhirExportOptions,
): FhirBundle {
  const idx = indexPeople(record.people, record.unions);
  const probandId = record.probandId;
  const proband = personById(idx, probandId);
  if (!proband) throw new Error(`proband ${probandId} not found in record`);

  const patientRef: FhirReference = { reference: `Patient/${probandId}` };
  const entry: FhirBundleEntry[] = [];

  const patient: FhirPatient = {
    resourceType: 'Patient',
    id: probandId,
    extension: [{ url: BIRTHSEX_URL, valueCode: birthSex(sabOf(proband)) }],
    name: [{ text: proband.name, given: [proband.name] }],
    gender: fhirGender(genderOf(proband)),
  };
  // Prefer the precise birth date when the source gave one (a PartialDate is a valid FHIR
  // date, at whatever precision it carries); otherwise fall back to the coarse year exactly
  // as before. Additive: records without `birthDate` are byte-identical to today's output.
  if (proband.birthDate) patient.birthDate = proband.birthDate;
  else if (proband.birth != null) patient.birthDate = String(proband.birth);
  entry.push({ resource: patient });

  condIds(proband).forEach((cid, i) => {
    const e = condEntry(proband, cid);
    const condition: FhirCondition = {
      resourceType: 'Condition',
      id: `cond-${probandId}-${i}`,
      clinicalStatus: { coding: [{ system: CLINICAL_STATUS_SYSTEM, code: 'active' }] },
      code: fhirCode(cid, catalog),
      subject: patientRef,
    };
    // Prefer a precise onset date (emitted as `onsetDateTime`, a valid FHIR dateTime at
    // whatever precision the PartialDate carries) when the source gave one; otherwise fall
    // back to the coarse onset age. FHIR permits exactly one `onset[x]`, so these are
    // mutually exclusive — never both. Additive: entries without `onsetDate` are unchanged.
    if (e?.onsetDate) {
      condition.onsetDateTime = e.onsetDate;
    } else {
      const age = onsetAge(e?.onset);
      if (age) condition.onsetAge = age;
    }
    entry.push({ resource: condition });
  });

  for (const p of record.people) {
    if (p.id === probandId) continue;
    const info = relationInfo(idx, p.id, probandId);
    if (info.degree == null) continue; // non-blood relatives carry no family-history signal
    const rc = relRoleCode(info.rel);
    const fmh: FhirFamilyMemberHistory = {
      resourceType: 'FamilyMemberHistory',
      id: `fmh-${p.id}`,
      status: 'completed',
      patient: patientRef,
      name: p.name,
      relationship: {
        coding: rc ? [{ system: ROLE_CODE_SYSTEM, code: rc, display: info.rel }] : [],
        text: info.rel,
      },
      sex: { coding: [{ system: ADMIN_GENDER_SYSTEM, code: adminGender(sabOf(p)) }] },
    };
    if (p.dead) fmh.deceasedBoolean = true;
    const cids = condIds(p);
    if (cids.length) {
      fmh.condition = cids.map((cid) => {
        const e = condEntry(p, cid);
        const cc: FhirFamilyMemberCondition = { code: fhirCode(cid, catalog) };
        const age = onsetAge(e?.onset);
        if (age) cc.onsetAge = age;
        return cc;
      });
    }
    entry.push({ resource: fmh });
  }

  return {
    resourceType: 'Bundle',
    type: 'collection',
    // The generation timestamp is injected by the caller (the sanctioned wall-clock boundary),
    // never read from the clock here, keeping this serialiser pure/deterministic.
    timestamp: opts.now,
    entry,
  };
}
