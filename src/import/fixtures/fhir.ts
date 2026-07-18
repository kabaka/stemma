/**
 * Realistic FHIR R4 resource/bundle fixture builders for `fhir.test.ts`, mirroring
 * `fixtures/ccda.ts`'s builder-function style: each helper renders a minimal-but-structurally-real
 * resource from a small options object, so each test in the oracle can assemble exactly the bundle
 * its scenario needs rather than reaching into one giant shared fixture.
 *
 * System URIs are the real ones a conformant SMART server uses (verified against the FHIR R4 spec
 * and the US Core IG) — never invented:
 * - SNOMED CT: `http://snomed.info/sct`
 * - ICD-10-CM: `http://hl7.org/fhir/sid/icd-10-cm`
 * - ICD-9-CM (legacy, unrecognized): `http://hl7.org/fhir/sid/icd-9-cm`
 * - `Condition.verificationStatus`: `http://terminology.hl7.org/CodeSystem/condition-ver-status`
 * - `Condition.clinicalStatus`: `http://terminology.hl7.org/CodeSystem/condition-clinical`
 * - `FamilyMemberHistory.relationship`: `http://terminology.hl7.org/CodeSystem/v3-RoleCode`
 * - `FamilyMemberHistory.sex` / `Patient.gender`: `http://hl7.org/fhir/administrative-gender`
 * - `FamilyMemberHistory.dataAbsentReason`: `http://terminology.hl7.org/CodeSystem/history-absent-reason`
 * - US Core birthsex extension: `http://hl7.org/fhir/us/core/StructureDefinition/us-core-birthsex`
 */

export const SYS = {
  snomed: 'http://snomed.info/sct',
  icd10cm: 'http://hl7.org/fhir/sid/icd-10-cm',
  icd9cm: 'http://hl7.org/fhir/sid/icd-9-cm',
  proprietary: 'http://example-vendor.test/local-codes',
  verStatus: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
  clinStatus: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
  roleCode: 'http://terminology.hl7.org/CodeSystem/v3-RoleCode',
  adminGender: 'http://hl7.org/fhir/administrative-gender',
  absentReason: 'http://terminology.hl7.org/CodeSystem/history-absent-reason',
  usCoreBirthsex: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-birthsex',
  // --- Wave 2/3: full-timeline event resources (verified real system URIs — never invented) ---
  rxnorm: 'http://www.nlm.nih.gov/research/umls/rxnorm',
  cvx: 'http://hl7.org/fhir/sid/cvx',
  loinc: 'http://loinc.org',
  ucum: 'http://unitsofmeasure.org',
  ndc: 'http://hl7.org/fhir/sid/ndc',
  cpt: 'http://www.ama-assn.org/go/cpt',
  hcpcs: 'https://www.cms.gov/Medicare/Coding/HCPCSReleaseCodeSets',
  allergyVerification: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
  allergyClinical: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
  obsCategory: 'http://terminology.hl7.org/CodeSystem/observation-category',
  v2_0074: 'http://terminology.hl7.org/CodeSystem/v2-0074',
  actCode: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
};

/** Genetic LOINC codes the contract's medical-verified section names — classify an Observation as
 * `genetic` when `Observation.code`/`component[].code` carries one of these, even absent a v2-0074
 * genomics category tag. No universal `category=genomics` code exists; do not invent one. */
export const GENETIC_LOINC_CODES = ['69548-6', '48004-6', '81290-9', '81291-7', '48013-7'] as const;

/** The "no known family history of X" / coded-absence SNOMED concept ccda.ts's `ABSENCE_SNOMED`
 * already recognizes — the FHIR analog re-uses the same code. */
export const ABSENCE_SNOMED_CODE = '160266009';

export interface FixtureCoding {
  system?: string;
  code?: string;
  display?: string;
}

function codeableConcept(codings?: FixtureCoding[], text?: string): Record<string, unknown> {
  const cc: Record<string, unknown> = {};
  if (codings?.length) {
    cc.coding = codings.map((c) => ({ system: c.system, code: c.code, display: c.display }));
  }
  if (text) cc.text = text;
  return cc;
}

// ---------------------------------------------------------------------------
// Patient
// ---------------------------------------------------------------------------

export interface FixturePatientOpts {
  id?: string;
  birthDate?: string;
  /** `Patient.gender` — deliberately settable to a DIFFERENT value than `birthsex` in fixtures
   * that must prove the parser never reads it for sab (guardrail #4). */
  gender?: 'male' | 'female' | 'other' | 'unknown';
  /** US Core birthsex extension value (`F`/`M`/`OTH`/`UNK`) — the ONLY source of the proband's sab. */
  birthsex?: 'F' | 'M' | 'OTH' | 'UNK';
}

export function patientResource(opts: FixturePatientOpts = {}): FhirBundleResource {
  const resource: FhirBundleResource = { resourceType: 'Patient', id: opts.id ?? 'pat-1' };
  if (opts.birthDate) resource.birthDate = opts.birthDate;
  if (opts.gender) resource.gender = opts.gender;
  if (opts.birthsex) {
    resource.extension = [{ url: SYS.usCoreBirthsex, valueCode: opts.birthsex }];
  }
  return resource;
}

// ---------------------------------------------------------------------------
// Condition (proband problems)
// ---------------------------------------------------------------------------

export interface FixtureConditionOpts {
  id: string;
  subjectRef?: string;
  codings?: FixtureCoding[];
  text?: string;
  verificationStatus?:
    'confirmed' | 'unconfirmed' | 'provisional' | 'differential' | 'refuted' | 'entered-in-error';
  /** Omit entirely to simulate a server that never populated verificationStatus. */
  omitVerificationStatus?: boolean;
  clinicalStatus?: 'active' | 'recurrence' | 'relapse' | 'inactive' | 'remission' | 'resolved';
  omitClinicalStatus?: boolean;
  onsetAgeYears?: number;
  onsetDateTime?: string;
  onsetPeriodStart?: string;
  onsetString?: string;
  onsetRangeLowYears?: number;
  onsetRangeHighYears?: number;
}

export function conditionResource(opts: FixtureConditionOpts): FhirBundleResource {
  const resource: FhirBundleResource = {
    resourceType: 'Condition',
    id: opts.id,
    subject: { reference: opts.subjectRef ?? 'Patient/pat-1' },
  };
  if (!opts.omitVerificationStatus) {
    resource.verificationStatus = {
      coding: [{ system: SYS.verStatus, code: opts.verificationStatus ?? 'confirmed' }],
    };
  }
  if (!opts.omitClinicalStatus) {
    resource.clinicalStatus = {
      coding: [{ system: SYS.clinStatus, code: opts.clinicalStatus ?? 'active' }],
    };
  }
  resource.code = codeableConcept(opts.codings, opts.text);

  if (opts.onsetAgeYears != null) {
    resource.onsetAge = {
      value: opts.onsetAgeYears,
      unit: 'years',
      system: 'http://unitsofmeasure.org',
      code: 'a',
    };
  } else if (opts.onsetDateTime) {
    resource.onsetDateTime = opts.onsetDateTime;
  } else if (opts.onsetPeriodStart) {
    resource.onsetPeriod = { start: opts.onsetPeriodStart };
  } else if (opts.onsetString) {
    resource.onsetString = opts.onsetString;
  } else if (opts.onsetRangeLowYears != null || opts.onsetRangeHighYears != null) {
    resource.onsetRange = {
      ...(opts.onsetRangeLowYears != null
        ? { low: { value: opts.onsetRangeLowYears, unit: 'years' } }
        : {}),
      ...(opts.onsetRangeHighYears != null
        ? { high: { value: opts.onsetRangeHighYears, unit: 'years' } }
        : {}),
    };
  }
  return resource;
}

// ---------------------------------------------------------------------------
// FamilyMemberHistory
// ---------------------------------------------------------------------------

export interface FixtureFmhConditionOpts {
  codings?: FixtureCoding[];
  text?: string;
  onsetAgeYears?: number;
  onsetPeriodStart?: string;
  onsetString?: string;
  onsetRangeLowYears?: number;
  contributedToDeath?: boolean;
}

export interface FixtureFmhOpts {
  id: string;
  status: 'completed' | 'partial' | 'health-unknown' | 'entered-in-error';
  patientRef?: string;
  relationshipCode?: string;
  relationshipSystem?: string;
  relationshipDisplay?: string;
  /** Renders `relationship: { text }` with NO `coding` at all — the ".text-only" case. */
  relationshipTextOnly?: string;
  name?: string;
  sexCode?: 'male' | 'female' | 'other' | 'unknown';
  bornDate?: string;
  deceasedBoolean?: boolean;
  deceasedAgeYears?: number;
  deceasedDate?: string;
  /** Renders `deceasedRange: { low: { value, unit: 'years' } }` — asserts death without a
   * calendar year, like `deceasedAge`. */
  deceasedRangeLowYears?: number;
  /** Renders `deceasedString` verbatim — a free-text death description, no calendar year. */
  deceasedString?: string;
  dataAbsentReason?: 'subject-unknown' | 'withheld' | 'unable-to-obtain' | 'deferred';
  conditions?: FixtureFmhConditionOpts[];
}

export function familyMemberHistoryResource(opts: FixtureFmhOpts): FhirBundleResource {
  const resource: FhirBundleResource = {
    resourceType: 'FamilyMemberHistory',
    id: opts.id,
    status: opts.status,
    patient: { reference: opts.patientRef ?? 'Patient/pat-1' },
  };

  if (opts.relationshipTextOnly) {
    resource.relationship = { text: opts.relationshipTextOnly };
  } else if (opts.relationshipCode) {
    resource.relationship = {
      coding: [
        {
          system: opts.relationshipSystem ?? SYS.roleCode,
          code: opts.relationshipCode,
          display: opts.relationshipDisplay,
        },
      ],
    };
  }

  if (opts.sexCode) {
    resource.sex = { coding: [{ system: SYS.adminGender, code: opts.sexCode }] };
  }
  if (opts.name) resource.name = opts.name;
  if (opts.bornDate) resource.bornDate = opts.bornDate;

  if (opts.deceasedBoolean != null) resource.deceasedBoolean = opts.deceasedBoolean;
  else if (opts.deceasedAgeYears != null) {
    resource.deceasedAge = { value: opts.deceasedAgeYears, unit: 'years' };
  } else if (opts.deceasedDate) resource.deceasedDate = opts.deceasedDate;
  else if (opts.deceasedRangeLowYears != null) {
    resource.deceasedRange = { low: { value: opts.deceasedRangeLowYears, unit: 'years' } };
  } else if (opts.deceasedString) resource.deceasedString = opts.deceasedString;

  if (opts.dataAbsentReason) {
    resource.dataAbsentReason = {
      coding: [{ system: SYS.absentReason, code: opts.dataAbsentReason }],
    };
  }

  if (opts.conditions?.length) {
    resource.condition = opts.conditions.map((c) => {
      const cond: Record<string, unknown> = { code: codeableConcept(c.codings, c.text) };
      if (c.onsetAgeYears != null) cond.onsetAge = { value: c.onsetAgeYears, unit: 'years' };
      else if (c.onsetPeriodStart) cond.onsetPeriod = { start: c.onsetPeriodStart };
      else if (c.onsetString) cond.onsetString = c.onsetString;
      else if (c.onsetRangeLowYears != null) {
        cond.onsetRange = { low: { value: c.onsetRangeLowYears, unit: 'years' } };
      }
      if (c.contributedToDeath != null) cond.contributedToDeath = c.contributedToDeath;
      return cond;
    });
  }

  return resource;
}

// ---------------------------------------------------------------------------
// Medication / MedicationStatement / MedicationRequest
// ---------------------------------------------------------------------------

export interface FixtureMedicationOpts {
  id: string;
  codings?: FixtureCoding[];
  text?: string;
}

/** A standalone `Medication` resource — for a `_include`d bundle entry the parser resolves a
 * `medicationReference` against (by `fullUrl` / `resource.id`). */
export function medicationResource(opts: FixtureMedicationOpts): FhirBundleResource {
  return {
    resourceType: 'Medication',
    id: opts.id,
    code: codeableConcept(opts.codings, opts.text),
  };
}

type SettledOrInterimStatus = string;

export interface FixtureMedicationStatementOpts {
  id: string;
  subjectRef?: string;
  status: SettledOrInterimStatus;
  medicationCodings?: FixtureCoding[];
  medicationText?: string;
  /** Renders `medicationReference: { reference: 'Medication/<id>' }` — resolved against a
   * separate, `_include`d `Medication` bundle entry with that id. */
  medicationReferenceId?: string;
  /** Renders a `contained` Medication + a `medicationReference` pointing at `#<id>`. */
  containedMedication?: FixtureMedicationOpts;
  effectiveDateTime?: string;
  effectivePeriodStart?: string;
  dosageText?: string;
}

export function medicationStatementResource(
  opts: FixtureMedicationStatementOpts,
): FhirBundleResource {
  const resource: FhirBundleResource = {
    resourceType: 'MedicationStatement',
    id: opts.id,
    status: opts.status,
    subject: { reference: opts.subjectRef ?? 'Patient/pat-1' },
  };
  if (opts.containedMedication) {
    resource.contained = [
      { ...medicationResource(opts.containedMedication), id: opts.containedMedication.id },
    ];
    resource.medicationReference = { reference: `#${opts.containedMedication.id}` };
  } else if (opts.medicationReferenceId) {
    resource.medicationReference = { reference: `Medication/${opts.medicationReferenceId}` };
  } else {
    resource.medicationCodeableConcept = codeableConcept(
      opts.medicationCodings,
      opts.medicationText,
    );
  }
  if (opts.effectiveDateTime) resource.effectiveDateTime = opts.effectiveDateTime;
  else if (opts.effectivePeriodStart)
    resource.effectivePeriod = { start: opts.effectivePeriodStart };
  if (opts.dosageText) resource.dosage = [{ text: opts.dosageText }];
  return resource;
}

export interface FixtureMedicationRequestOpts {
  id: string;
  subjectRef?: string;
  status: SettledOrInterimStatus;
  medicationCodings?: FixtureCoding[];
  medicationText?: string;
  medicationReferenceId?: string;
  containedMedication?: FixtureMedicationOpts;
  authoredOn?: string;
  dosageText?: string;
}

export function medicationRequestResource(opts: FixtureMedicationRequestOpts): FhirBundleResource {
  const resource: FhirBundleResource = {
    resourceType: 'MedicationRequest',
    id: opts.id,
    status: opts.status,
    subject: { reference: opts.subjectRef ?? 'Patient/pat-1' },
  };
  if (opts.containedMedication) {
    resource.contained = [
      { ...medicationResource(opts.containedMedication), id: opts.containedMedication.id },
    ];
    resource.medicationReference = { reference: `#${opts.containedMedication.id}` };
  } else if (opts.medicationReferenceId) {
    resource.medicationReference = { reference: `Medication/${opts.medicationReferenceId}` };
  } else {
    resource.medicationCodeableConcept = codeableConcept(
      opts.medicationCodings,
      opts.medicationText,
    );
  }
  if (opts.authoredOn) resource.authoredOn = opts.authoredOn;
  if (opts.dosageText) resource.dosageInstruction = [{ text: opts.dosageText }];
  return resource;
}

// ---------------------------------------------------------------------------
// Observation (laboratory / vital-signs / genomic)
// ---------------------------------------------------------------------------

export interface FixtureValueQuantity {
  value: number;
  unit: string;
  code?: string;
}

export interface FixtureReferenceRange {
  low?: { value: number; unit: string };
  high?: { value: number; unit: string };
}

export interface FixtureObservationOpts {
  id: string;
  subjectRef?: string;
  category: 'laboratory' | 'vital-signs' | 'social-history';
  status: SettledOrInterimStatus;
  codings?: FixtureCoding[];
  text?: string;
  effectiveDateTime?: string;
  effectivePeriodStart?: string;
  issued?: string;
  valueQuantity?: FixtureValueQuantity;
  valueString?: string;
  referenceRanges?: FixtureReferenceRange[];
  /** Adds a second `category` coding `{system: v2-0074, code}` — the genomics tag. */
  genomicCategoryCode?: 'GE' | 'CG';
}

export function observationResource(opts: FixtureObservationOpts): FhirBundleResource {
  const categoryCodings: FixtureCoding[] = [{ system: SYS.obsCategory, code: opts.category }];
  if (opts.genomicCategoryCode) {
    categoryCodings.push({ system: SYS.v2_0074, code: opts.genomicCategoryCode });
  }
  const resource: FhirBundleResource = {
    resourceType: 'Observation',
    id: opts.id,
    status: opts.status,
    category: [{ coding: categoryCodings }],
    code: codeableConcept(opts.codings, opts.text),
    subject: { reference: opts.subjectRef ?? 'Patient/pat-1' },
  };
  if (opts.effectiveDateTime) resource.effectiveDateTime = opts.effectiveDateTime;
  else if (opts.effectivePeriodStart)
    resource.effectivePeriod = { start: opts.effectivePeriodStart };
  else if (opts.issued) resource.issued = opts.issued;
  if (opts.valueQuantity) {
    resource.valueQuantity = {
      value: opts.valueQuantity.value,
      unit: opts.valueQuantity.unit,
      system: SYS.ucum,
      code: opts.valueQuantity.code ?? opts.valueQuantity.unit,
    };
  } else if (opts.valueString) {
    resource.valueString = opts.valueString;
  }
  if (opts.referenceRanges?.length) {
    resource.referenceRange = opts.referenceRanges.map((r) => ({
      ...(r.low ? { low: { value: r.low.value, unit: r.low.unit } } : {}),
      ...(r.high ? { high: { value: r.high.value, unit: r.high.unit } } : {}),
    }));
  }
  return resource;
}

// ---------------------------------------------------------------------------
// Immunization
// ---------------------------------------------------------------------------

export interface FixtureImmunizationOpts {
  id: string;
  subjectRef?: string;
  status: 'completed' | 'not-done' | 'entered-in-error';
  occurrenceDateTime?: string;
  vaccineCodings?: FixtureCoding[];
  vaccineText?: string;
  doseNumber?: number;
}

export function immunizationResource(opts: FixtureImmunizationOpts): FhirBundleResource {
  const resource: FhirBundleResource = {
    resourceType: 'Immunization',
    id: opts.id,
    status: opts.status,
    patient: { reference: opts.subjectRef ?? 'Patient/pat-1' },
    vaccineCode: codeableConcept(opts.vaccineCodings, opts.vaccineText),
  };
  if (opts.occurrenceDateTime) resource.occurrenceDateTime = opts.occurrenceDateTime;
  if (opts.doseNumber != null)
    resource.protocolApplied = [{ doseNumberPositiveInt: opts.doseNumber }];
  return resource;
}

// ---------------------------------------------------------------------------
// AllergyIntolerance
// ---------------------------------------------------------------------------

export interface FixtureReactionOpts {
  manifestationCodings?: FixtureCoding[];
  manifestationText?: string;
  description?: string;
  severity?: 'mild' | 'moderate' | 'severe';
}

export interface FixtureAllergyOpts {
  id: string;
  patientRef?: string;
  verificationStatus?: 'confirmed' | 'unconfirmed' | 'refuted' | 'entered-in-error';
  /** Omit entirely to simulate a server that never populated verificationStatus (→ interim). */
  omitVerificationStatus?: boolean;
  clinicalStatus?: 'active' | 'inactive' | 'resolved';
  codings?: FixtureCoding[];
  text?: string;
  reactions?: FixtureReactionOpts[];
  /** Deliberately settable to a DIFFERENT bucket than `reactions[].severity`, so a fixture can
   * prove the parser reads reaction severity, never criticality. */
  criticality?: 'low' | 'high' | 'unable-to-assess';
  onsetDateTime?: string;
  onsetPeriodStart?: string;
  onsetAgeYears?: number;
  onsetString?: string;
  /** Administrative timestamp — must NEVER be read as clinical onset. */
  recordedDate?: string;
}

export function allergyIntoleranceResource(opts: FixtureAllergyOpts): FhirBundleResource {
  const resource: FhirBundleResource = {
    resourceType: 'AllergyIntolerance',
    id: opts.id,
    patient: { reference: opts.patientRef ?? 'Patient/pat-1' },
    code: codeableConcept(opts.codings, opts.text),
  };
  if (!opts.omitVerificationStatus) {
    resource.verificationStatus = {
      coding: [{ system: SYS.allergyVerification, code: opts.verificationStatus ?? 'confirmed' }],
    };
  }
  if (opts.clinicalStatus) {
    resource.clinicalStatus = {
      coding: [{ system: SYS.allergyClinical, code: opts.clinicalStatus }],
    };
  }
  if (opts.criticality) resource.criticality = opts.criticality;
  if (opts.reactions?.length) {
    resource.reaction = opts.reactions.map((r) => ({
      ...(r.manifestationCodings?.length || r.manifestationText
        ? { manifestation: [codeableConcept(r.manifestationCodings, r.manifestationText)] }
        : {}),
      ...(r.description ? { description: r.description } : {}),
      ...(r.severity ? { severity: r.severity } : {}),
    }));
  }
  if (opts.onsetDateTime) resource.onsetDateTime = opts.onsetDateTime;
  else if (opts.onsetPeriodStart) resource.onsetPeriod = { start: opts.onsetPeriodStart };
  else if (opts.onsetAgeYears != null) {
    resource.onsetAge = { value: opts.onsetAgeYears, unit: 'years', system: SYS.ucum, code: 'a' };
  } else if (opts.onsetString) resource.onsetString = opts.onsetString;
  if (opts.recordedDate) resource.recordedDate = opts.recordedDate;
  return resource;
}

// ---------------------------------------------------------------------------
// Procedure
// ---------------------------------------------------------------------------

export interface FixtureProcedureOpts {
  id: string;
  subjectRef?: string;
  status: SettledOrInterimStatus;
  performedDateTime?: string;
  performedPeriodStart?: string;
  codings?: FixtureCoding[];
  text?: string;
}

export function procedureResource(opts: FixtureProcedureOpts): FhirBundleResource {
  const resource: FhirBundleResource = {
    resourceType: 'Procedure',
    id: opts.id,
    status: opts.status,
    subject: { reference: opts.subjectRef ?? 'Patient/pat-1' },
    code: codeableConcept(opts.codings, opts.text),
  };
  if (opts.performedDateTime) resource.performedDateTime = opts.performedDateTime;
  else if (opts.performedPeriodStart)
    resource.performedPeriod = { start: opts.performedPeriodStart };
  return resource;
}

// ---------------------------------------------------------------------------
// Encounter
// ---------------------------------------------------------------------------

export interface FixtureEncounterOpts {
  id: string;
  subjectRef?: string;
  status: SettledOrInterimStatus;
  periodStart?: string;
  typeCodings?: FixtureCoding[];
  typeText?: string;
  classCode?: string;
  classDisplay?: string;
}

export function encounterResource(opts: FixtureEncounterOpts): FhirBundleResource {
  const resource: FhirBundleResource = {
    resourceType: 'Encounter',
    id: opts.id,
    status: opts.status,
    subject: { reference: opts.subjectRef ?? 'Patient/pat-1' },
  };
  if (opts.periodStart) resource.period = { start: opts.periodStart };
  if (opts.typeCodings?.length || opts.typeText) {
    resource.type = [codeableConcept(opts.typeCodings, opts.typeText)];
  }
  if (opts.classCode) {
    resource.class = { system: SYS.actCode, code: opts.classCode, display: opts.classDisplay };
  }
  return resource;
}

// ---------------------------------------------------------------------------
// Bundle assembly
// ---------------------------------------------------------------------------

export interface FhirBundleResource {
  resourceType: string;
  id?: string;
  [key: string]: unknown;
}

/**
 * Wrap a list of resources into a `searchset` Bundle — the shape `parseFhirImport` consumes.
 * Each entry with an `id` gets a `fullUrl` of `<ResourceType>/<id>` (mirroring what a real FHIR
 * server emits), so `_include`d resources — e.g. a `Medication` a `medicationReference` points
 * at — can be resolved by reference the same way a live bundle would resolve them.
 */
export function fhirBundle(resources: FhirBundleResource[]): {
  resourceType: 'Bundle';
  type: string;
  entry: { fullUrl?: string; resource: FhirBundleResource }[];
} {
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    entry: resources.map((r) => ({
      ...(r.id ? { fullUrl: `${r.resourceType}/${r.id}` } : {}),
      resource: r,
    })),
  };
}
