/**
 * Conformance tests for the FHIR R4 export (roadmap §1 — "Test the export layer against
 * validators").
 *
 * Stemma is a backend-free, local-first static app: it cannot call the public HL7 FHIR
 * validator at test time (no network in CI) and deliberately ships no heavy validation
 * dependency. Instead this file encodes the normative R4 structural rules for the
 * resources the exporter actually emits (Bundle / Patient / Condition /
 * FamilyMemberHistory) as a self-contained validator, `validateFhirBundle`, and asserts
 * both that a real export passes it AND that the validator has teeth (it rejects injected
 * violations). The rule set is derived from the HL7 FHIR R4 specification:
 *   - Bundle:               https://hl7.org/fhir/R4/bundle.html
 *   - Patient:              https://hl7.org/fhir/R4/patient.html
 *   - Condition:            https://hl7.org/fhir/R4/condition.html
 *   - FamilyMemberHistory:  https://hl7.org/fhir/R4/familymemberhistory.html
 *   - Age / UCUM:           https://hl7.org/fhir/R4/datatypes.html#Age
 *   - us-core-birthsex:     http://hl7.org/fhir/us/core/StructureDefinition/us-core-birthsex
 */
import { describe, it, expect } from 'vitest';
import { buildFhirBundle } from './fhir';
import type { FhirBundle, FhirCondition, FhirFamilyMemberHistory, FhirPatient } from './fhir';
import { seedRecord } from '@/data/seed';
import { buildCatalog } from '@/domain/catalog';

const NOW = '2026-07-14T12:00:00.000Z';
const catalog = buildCatalog([]);
const build = (): FhirBundle => buildFhirBundle(seedRecord(), catalog, { now: NOW });

// --- Normative value sets / formats (the subset R4 requires of what we emit) ---
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
// FHIR `dateTime`: a partial date (`YYYY` | `YYYY-MM` | `YYYY-MM-DD`) or a full timestamp.
const DATETIME = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?)?)?$/;
const ADMIN_GENDER = new Set(['male', 'female', 'other', 'unknown']);
const BIRTHSEX = new Set(['F', 'M', 'UNK', 'ASKU', 'OTH']);
const FMH_STATUS = new Set(['partial', 'completed', 'entered-in-error', 'health-unknown']);
const UCUM_SYSTEM = 'http://unitsofmeasure.org';
const isUri = (s: unknown): boolean => typeof s === 'string' && /^[a-z][a-z0-9+.-]*:\S/.test(s);
const nonEmpty = (s: unknown): boolean => typeof s === 'string' && s.length > 0;

interface CodeableConcept {
  coding?: { system?: string; code?: string; display?: string }[];
  text?: string;
}

/** Validate a CodeableConcept's codings: each needs an absolute-URI system + a code. */
function checkCoding(cc: CodeableConcept | undefined, path: string, errs: string[]): void {
  if (!cc) return;
  (cc.coding ?? []).forEach((cd, i) => {
    if (!isUri(cd.system)) errs.push(`${path}.coding[${i}].system is not an absolute URI`);
    if (!nonEmpty(cd.code)) errs.push(`${path}.coding[${i}].code is empty`);
  });
}

/** Validate a FHIR Age: value:number + UCUM unit 'a'. */
function checkAge(age: unknown, path: string, errs: string[]): void {
  if (age == null) return;
  const a = age as { value?: unknown; system?: unknown; code?: unknown };
  if (typeof a.value !== 'number' || Number.isNaN(a.value)) errs.push(`${path}.value not a number`);
  if (a.system !== UCUM_SYSTEM) errs.push(`${path}.system is not UCUM`);
  if (a.code !== 'a') errs.push(`${path}.code is not the UCUM annum code 'a'`);
}

/**
 * Return a list of R4 conformance errors for a Stemma FHIR bundle; empty means valid.
 * Checks required elements, bound value sets, datatype formats, and referential
 * integrity across the bundle (every subject/patient reference resolves to the Patient).
 */
export function validateFhirBundle(bundle: FhirBundle): string[] {
  const errs: string[] = [];
  if (bundle.resourceType !== 'Bundle') errs.push('Bundle.resourceType must be "Bundle"');
  if (bundle.type !== 'collection') errs.push('Bundle.type must be "collection"');
  if (!INSTANT.test(bundle.timestamp)) errs.push('Bundle.timestamp is not a valid instant');
  if (!Array.isArray(bundle.entry)) {
    errs.push('Bundle.entry must be an array');
    return errs;
  }

  const patientIds = new Set<string>();
  for (const e of bundle.entry) {
    const r = e.resource;
    if (r?.resourceType === 'Patient') patientIds.add((r as FhirPatient).id);
  }
  const refResolves = (ref: string | undefined): boolean =>
    typeof ref === 'string' && ref.startsWith('Patient/') && patientIds.has(ref.slice(8));

  let patientCount = 0;
  bundle.entry.forEach((entry, i) => {
    const r = entry.resource;
    const at = `entry[${i}]`;
    if (!r || typeof r.resourceType !== 'string') {
      errs.push(`${at}.resource has no resourceType`);
      return;
    }
    // Widened for the defensive `else` below: the typed union covers the three resources
    // we emit, so TS narrows `r` to `never` there — keep the raw string for the message.
    const resourceType: string = r.resourceType;
    if (r.resourceType === 'Patient') {
      patientCount++;
      const p = r as FhirPatient;
      if (!nonEmpty(p.id)) errs.push(`${at} Patient.id is required`);
      if (!ADMIN_GENDER.has(p.gender))
        errs.push(`${at} Patient.gender "${p.gender}" not in value set`);
      if (p.birthDate !== undefined && !DATE.test(p.birthDate))
        errs.push(`${at} Patient.birthDate "${p.birthDate}" is not a FHIR date`);
      for (const ext of p.extension ?? []) {
        if (!isUri(ext.url)) errs.push(`${at} Patient.extension.url is not a URI`);
        if (ext.url.endsWith('us-core-birthsex') && !BIRTHSEX.has(ext.valueCode))
          errs.push(`${at} us-core-birthsex valueCode "${ext.valueCode}" not in value set`);
      }
      if (!Array.isArray(p.name) || p.name.length === 0)
        errs.push(`${at} Patient.name should carry at least one HumanName`);
    } else if (r.resourceType === 'Condition') {
      const c = r as FhirCondition;
      if (!nonEmpty(c.id)) errs.push(`${at} Condition.id is required`);
      checkCoding(c.clinicalStatus, `${at} Condition.clinicalStatus`, errs);
      if (!c.code?.coding?.length) errs.push(`${at} Condition.code needs at least one coding`);
      checkCoding(c.code, `${at} Condition.code`, errs);
      if (!refResolves(c.subject?.reference))
        errs.push(`${at} Condition.subject does not resolve to a Patient in the bundle`);
      checkAge(c.onsetAge, `${at} Condition.onsetAge`, errs);
      if (c.onsetDateTime !== undefined && !DATETIME.test(c.onsetDateTime))
        errs.push(`${at} Condition.onsetDateTime "${c.onsetDateTime}" is not a FHIR dateTime`);
      // FHIR permits exactly one onset[x] — onsetAge and onsetDateTime are mutually exclusive.
      if (c.onsetAge !== undefined && c.onsetDateTime !== undefined)
        errs.push(`${at} Condition has more than one onset[x] (onsetAge and onsetDateTime)`);
    } else if (r.resourceType === 'FamilyMemberHistory') {
      const f = r as FhirFamilyMemberHistory;
      if (!nonEmpty(f.id)) errs.push(`${at} FamilyMemberHistory.id is required`);
      if (!FMH_STATUS.has(f.status))
        errs.push(`${at} FamilyMemberHistory.status "${f.status}" invalid`);
      if (!refResolves(f.patient?.reference))
        errs.push(`${at} FamilyMemberHistory.patient does not resolve to the Patient`);
      // relationship is 1..1 in R4; text or a coding must carry it.
      if (!f.relationship || (!f.relationship.text && !f.relationship.coding?.length))
        errs.push(`${at} FamilyMemberHistory.relationship is required`);
      checkCoding(f.relationship, `${at} FamilyMemberHistory.relationship`, errs);
      checkCoding(f.sex, `${at} FamilyMemberHistory.sex`, errs);
      for (const [j, cond] of (f.condition ?? []).entries()) {
        if (!cond.code?.coding?.length)
          errs.push(`${at} FamilyMemberHistory.condition[${j}].code needs a coding`);
        checkCoding(cond.code, `${at} FamilyMemberHistory.condition[${j}].code`, errs);
        checkAge(cond.onsetAge, `${at} FamilyMemberHistory.condition[${j}].onsetAge`, errs);
      }
    } else {
      errs.push(`${at} unexpected resourceType "${resourceType}"`);
    }
  });
  if (patientCount !== 1) errs.push(`bundle must carry exactly one Patient, found ${patientCount}`);
  return errs;
}

describe('FHIR R4 conformance', () => {
  it('the seed export is conformant (no validation errors)', () => {
    expect(validateFhirBundle(build())).toEqual([]);
  });

  it('every coding carries an absolute-URI system and a non-empty code', () => {
    // A structural guarantee downstream terminology servers rely on.
    expect(validateFhirBundle(build())).toEqual([]);
  });

  // --- The validator must actually reject violations (otherwise "no errors" is vacuous) ---

  it('rejects a bundle whose type is not "collection"', () => {
    const bad = build();
    bad.type = 'document' as FhirBundle['type'];
    expect(validateFhirBundle(bad)).toContain('Bundle.type must be "collection"');
  });

  it('rejects a non-instant timestamp', () => {
    const bad = build();
    bad.timestamp = '2026-07-14';
    expect(validateFhirBundle(bad).some((e) => /timestamp/.test(e))).toBe(true);
  });

  it('rejects an administrative-gender outside the value set', () => {
    const bad = build();
    const patient = bad.entry.find((e) => e.resource.resourceType === 'Patient')!
      .resource as FhirPatient;
    patient.gender = 'M';
    expect(validateFhirBundle(bad).some((e) => /Patient.gender/.test(e))).toBe(true);
  });

  it('rejects a dangling Condition.subject reference', () => {
    const bad = build();
    const cond = bad.entry.find((e) => e.resource.resourceType === 'Condition')!
      .resource as FhirCondition;
    cond.subject.reference = 'Patient/ghost';
    expect(validateFhirBundle(bad).some((e) => /does not resolve/.test(e))).toBe(true);
  });

  it('rejects a coding with a non-URI system', () => {
    const bad = build();
    const cond = bad.entry.find((e) => e.resource.resourceType === 'Condition')!
      .resource as FhirCondition;
    cond.code.coding[0].system = 'snomed';
    expect(validateFhirBundle(bad).some((e) => /absolute URI/.test(e))).toBe(true);
  });

  it('rejects an onsetAge that is not in UCUM years', () => {
    const bad = build();
    const cond = bad.entry.find(
      (e) => e.resource.resourceType === 'Condition' && (e.resource as FhirCondition).onsetAge,
    )!.resource as FhirCondition;
    cond.onsetAge!.code = 'mo';
    expect(validateFhirBundle(bad).some((e) => /annum code/.test(e))).toBe(true);
  });

  // --- Precise onset dates (W7) stay schema-valid, at every partial precision ---

  it('accepts a Condition.onsetDateTime at full, year-month and year precision', () => {
    for (const precise of ['2019-03-15', '2019-03', '2019']) {
      const b = build();
      const cond = b.entry.find(
        (e) => e.resource.resourceType === 'Condition' && (e.resource as FhirCondition).onsetAge,
      )!.resource as FhirCondition;
      // A real record never carries both onset[x]; mirror the exporter (dateTime replaces age).
      delete cond.onsetAge;
      cond.onsetDateTime = precise;
      expect(validateFhirBundle(b)).toEqual([]);
    }
  });

  it('rejects a Condition.onsetDateTime that is not a FHIR dateTime', () => {
    const bad = build();
    const cond = bad.entry.find(
      (e) => e.resource.resourceType === 'Condition' && (e.resource as FhirCondition).onsetAge,
    )!.resource as FhirCondition;
    delete cond.onsetAge;
    cond.onsetDateTime = '2019-3-5'; // unpadded month/day — not a FHIR dateTime.
    expect(validateFhirBundle(bad).some((e) => /onsetDateTime/.test(e))).toBe(true);
  });

  it('rejects a Condition carrying more than one onset[x] (onsetAge AND onsetDateTime)', () => {
    const bad = build();
    const cond = bad.entry.find(
      (e) => e.resource.resourceType === 'Condition' && (e.resource as FhirCondition).onsetAge,
    )!.resource as FhirCondition;
    cond.onsetDateTime = '2019-03-15'; // leave onsetAge in place → two onset[x].
    expect(validateFhirBundle(bad).some((e) => /more than one onset/.test(e))).toBe(true);
  });

  it('accepts a Patient.birthDate at year-month-day precision', () => {
    const b = build();
    const patient = b.entry.find((e) => e.resource.resourceType === 'Patient')!
      .resource as FhirPatient;
    patient.birthDate = '1988-04-02';
    expect(validateFhirBundle(b)).toEqual([]);
  });
});
