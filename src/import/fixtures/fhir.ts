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
};

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
// Bundle assembly
// ---------------------------------------------------------------------------

export interface FhirBundleResource {
  resourceType: string;
  id?: string;
  [key: string]: unknown;
}

/** Wrap a list of resources into a `searchset` Bundle — the shape `parseFhirImport` consumes. */
export function fhirBundle(resources: FhirBundleResource[]): {
  resourceType: 'Bundle';
  type: string;
  entry: { resource: FhirBundleResource }[];
} {
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    entry: resources.map((r) => ({ resource: r })),
  };
}
