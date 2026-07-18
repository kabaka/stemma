/**
 * Oracle for `src/import/fhir.ts` (`parseFhirImport`) — the pure FHIR R4 → `ParsedHealthRecord`
 * mapper that feeds the source-agnostic reconciliation engine ({@link stageHealthRecordImport} /
 * {@link applyHealthRecordImport}, hoisted from `ccda.ts`). Every assertion is made against the
 * STAGED (and, where placement matters, APPLIED) output, per the contract — never against
 * parser-internal shape alone — because the staged/applied output is what the review UI and the
 * final `FamilyRecord` actually show a user.
 *
 * This file intentionally does NOT re-litigate every edge of the shared staging/placement engine
 * (name-collision candidates, sided-grandparent-missing-parent, etc.) — that's already covered,
 * unchanged, by `ccda.test.ts` (DR-0020: the engine is hoisted verbatim and stays that oracle's
 * responsibility). This file covers what is genuinely FHIR-specific: `parseFhirImport`'s reading
 * of `Condition`/`FamilyMemberHistory`/`Patient` into the shared parsed shape, and the clinical
 * disposition table unique to FHIR (`verificationStatus`, `clinicalStatus`, `dataAbsentReason`,
 * `status=health-unknown`, `contributedToDeath`) that has no C-CDA analog.
 *
 * KNOWN CONTRACT GAP (flagged, not silently worked around): the contract's Sex section says the
 * proband's sab should come from the `us-core-birthsex` extension, never `Patient.gender`. But
 * `ParsedHealthRecord.proband` is pinned to `{ problems: ProblemEntry[] }` (no demographic field),
 * and `applyHealthRecordImport` never writes to the proband Person's `sab`/`gender` at all — so
 * there is currently NO channel through which a wrong reading of proband birthsex could produce
 * an observably different result from a correct one. No test below claims to grade that specific
 * clause; see the test-engineer's handoff notes for the escalation.
 */
import { describe, expect, it } from 'vitest';
import { parseFhirImport } from './fhir';
import type { FhirImportBundle } from './fhir';
import { applyHealthRecordImport, stageHealthRecordImport } from './health-record';
import {
  ABSENCE_SNOMED_CODE,
  GENETIC_LOINC_CODES,
  SYS,
  allergyIntoleranceResource,
  conditionResource,
  encounterResource,
  familyMemberHistoryResource,
  fhirBundle,
  immunizationResource,
  medicationRequestResource,
  medicationResource,
  medicationStatementResource,
  observationResource,
  patientResource,
  procedureResource,
} from './fixtures/fhir';
import type {
  FixtureCoding,
  FixtureFmhConditionOpts,
  FixtureFmhOpts,
  FixtureMedicationRequestOpts,
  FixtureMedicationStatementOpts,
} from './fixtures/fhir';
import { buildCatalog } from '@/domain/catalog';
import { emptyRecord, seedRecord } from '@/data/seed';
import { indexPeople, personById } from '@/domain/graph';
import { isValidRecord } from '@/domain/record';
import type { FamilyRecord } from '@/domain/types';

/** The proband's parsed+staged health events (Wave 2/3) for a bundle. */
function parsedEvents(bundle: FhirImportBundle) {
  return parseFhirImport(bundle).proband.events;
}
function stagedEvents(bundle: FhirImportBundle, record: FamilyRecord = emptyRecord()) {
  return stage(bundle, record).events;
}

const catalog = buildCatalog([]);

function stage(bundle: FhirImportBundle, record: FamilyRecord = emptyRecord()) {
  return stageHealthRecordImport(parseFhirImport(bundle), record, catalog);
}

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe('parseFhirImport — purity', () => {
  it('is deterministic: parsing the same bundle twice yields deep-equal results (no clock/random)', () => {
    const bundle = fhirBundle([
      patientResource({ birthDate: '1988-01-01' }),
      conditionResource({
        id: 'c1',
        verificationStatus: 'confirmed',
        codings: [{ system: SYS.icd10cm, code: 'E11.9', display: 'Type 2 diabetes' }],
        onsetAgeYears: 30,
      }),
      familyMemberHistoryResource({
        id: 'fmh-1',
        status: 'completed',
        relationshipCode: 'MTH',
        name: 'Mom',
      }),
    ]);
    expect(parseFhirImport(bundle)).toEqual(parseFhirImport(bundle));
  });
});

// ---------------------------------------------------------------------------
// Proband identity (Patient resolution) — the "proband guard"
// ---------------------------------------------------------------------------

describe('parseFhirImport — proband identity (Patient resolution)', () => {
  it('infers the sole Patient entry as the proband when opts.patientId is omitted', () => {
    const bundle = fhirBundle([
      patientResource({ id: 'only-patient', birthDate: '1988-01-01' }),
      conditionResource({
        id: 'c1',
        subjectRef: 'Patient/only-patient',
        verificationStatus: 'confirmed',
        codings: [{ system: SYS.icd10cm, code: 'E11.9', display: 'Type 2 diabetes' }],
        onsetDateTime: '2020-01-01',
      }),
    ]);
    const parsed = parseFhirImport(bundle);
    expect(parsed.proband.problems).toHaveLength(1);
    expect(parsed.proband.problems[0].onsetYear).toBe(32); // 2020 - 1988
  });

  it('uses opts.patientId to select the correct Patient among several in the bundle', () => {
    const bundle = fhirBundle([
      patientResource({ id: 'other-patient', birthDate: '1950-01-01' }),
      patientResource({ id: 'pat-1', birthDate: '1988-01-01' }),
      conditionResource({
        id: 'c1',
        subjectRef: 'Patient/pat-1',
        verificationStatus: 'confirmed',
        codings: [{ system: SYS.icd10cm, code: 'E11.9', display: 'Type 2 diabetes' }],
        onsetDateTime: '2020-01-01',
      }),
    ]);
    const parsed = parseFhirImport(bundle, { patientId: 'pat-1' });
    // Must use pat-1's 1988 birth year, not other-patient's 1950 — proves the option actually
    // selects among candidates rather than grabbing "the first Patient in the bundle".
    expect(parsed.proband.problems[0].onsetYear).toBe(32);
  });

  it('never throws and never fabricates an onset when no Patient resource is present in the bundle at all', () => {
    const bundle = fhirBundle([
      conditionResource({
        id: 'c1',
        verificationStatus: 'confirmed',
        codings: [{ system: SYS.icd10cm, code: 'E11.9', display: 'Type 2 diabetes' }],
        onsetDateTime: '2020-01-01',
      }),
    ]);
    expect(() => parseFhirImport(bundle)).not.toThrow();
    expect(parseFhirImport(bundle).proband.problems[0].onsetYear).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Condition.verificationStatus
// ---------------------------------------------------------------------------

describe('parseFhirImport — Condition.verificationStatus disposition (proband)', () => {
  it('confirmed + coded ICD-10-CM (curated) is staged positive, defaulted ON', () => {
    const bundle = fhirBundle([
      patientResource({ birthDate: '1988-01-01' }),
      conditionResource({
        id: 'c1',
        verificationStatus: 'confirmed',
        codings: [
          { system: SYS.icd10cm, code: 'C50.919', display: 'Malignant neoplasm of breast' },
        ],
        onsetAgeYears: 35,
      }),
    ]);
    const staged = stage(bundle).probandConditions;
    expect(staged).toHaveLength(1);
    expect(staged[0]).toMatchObject({
      suggestedConditionId: 'brca',
      status: 'new',
      defaultSelected: true,
      onsetYear: 35,
    });
  });

  it.each(['unconfirmed', 'provisional', 'differential'] as const)(
    'verificationStatus=%s is surfaced needs-review, defaulted OFF — never pre-selected despite a resolvable code',
    (vs) => {
      const bundle = fhirBundle([
        patientResource({ birthDate: '1988-01-01' }),
        conditionResource({
          id: 'c1',
          verificationStatus: vs,
          codings: [{ system: SYS.icd10cm, code: 'E11.9', display: 'Type 2 diabetes mellitus' }],
        }),
      ]);
      const staged = stage(bundle).probandConditions[0];
      expect(staged.status).toBe('needs-review');
      expect(staged.defaultSelected).toBe(false);
      expect(staged.displayName).toBe('Type 2 diabetes mellitus');
    },
  );

  it('a missing verificationStatus is surfaced needs-review, defaulted OFF (never assumed confirmed)', () => {
    const bundle = fhirBundle([
      patientResource({ birthDate: '1988-01-01' }),
      conditionResource({
        id: 'c1',
        omitVerificationStatus: true,
        codings: [{ system: SYS.icd10cm, code: 'E11.9', display: 'Type 2 diabetes mellitus' }],
      }),
    ]);
    const staged = stage(bundle).probandConditions[0];
    expect(staged.status).toBe('needs-review');
    expect(staged.defaultSelected).toBe(false);
    expect(staged.displayName).toBe('Type 2 diabetes mellitus');
  });

  it('refuted is EXCLUDED entirely (never staged) and increments a "not imported / ruled out" warning', () => {
    const bundle = fhirBundle([
      patientResource({ birthDate: '1988-01-01' }),
      conditionResource({
        id: 'c-real',
        verificationStatus: 'confirmed',
        codings: [
          { system: SYS.icd10cm, code: 'C50.919', display: 'Malignant neoplasm of breast' },
        ],
      }),
      conditionResource({
        id: 'c-refuted',
        verificationStatus: 'refuted',
        codings: [{ system: SYS.icd10cm, code: 'E11.9', display: 'Type 2 diabetes mellitus' }],
      }),
    ]);
    const parsed = parseFhirImport(bundle);
    // The refuted diabetes entry never makes it into the parsed problems at all.
    expect(parsed.proband.problems).toHaveLength(1);
    expect(parsed.proband.problems[0].coded.displayName).toBe('Malignant neoplasm of breast');

    const staged = stage(bundle);
    expect(staged.probandConditions).toHaveLength(1);
    expect(staged.probandConditions.some((c) => /diabetes/i.test(c.displayName))).toBe(false);
    expect(
      staged.warnings.some((w) => /not imported/i.test(w) && /ruled out|refuted/i.test(w)),
    ).toBe(true);
  });

  it('entered-in-error is EXCLUDED entirely and never surfaced anywhere (not staged, not counted)', () => {
    const bundle = fhirBundle([
      patientResource({ birthDate: '1988-01-01' }),
      conditionResource({
        id: 'c-real',
        verificationStatus: 'confirmed',
        codings: [
          { system: SYS.icd10cm, code: 'C50.919', display: 'Malignant neoplasm of breast' },
        ],
      }),
      conditionResource({
        id: 'c-eie',
        verificationStatus: 'entered-in-error',
        codings: [{ system: SYS.icd10cm, code: 'E11.9', display: 'Type 2 diabetes mellitus' }],
      }),
    ]);
    const parsed = parseFhirImport(bundle);
    expect(parsed.proband.problems).toHaveLength(1);
    expect(stage(bundle).probandConditions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Condition.clinicalStatus — never gates inclusion
// ---------------------------------------------------------------------------

describe('parseFhirImport — Condition.clinicalStatus never excludes a condition', () => {
  it.each(['active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved'] as const)(
    'a confirmed condition with clinicalStatus=%s stays included and defaulted ON',
    (cs) => {
      const bundle = fhirBundle([
        patientResource({ birthDate: '1988-01-01' }),
        conditionResource({
          id: 'c1',
          verificationStatus: 'confirmed',
          clinicalStatus: cs,
          codings: [
            { system: SYS.icd10cm, code: 'C50.919', display: 'Malignant neoplasm of breast' },
          ],
        }),
      ]);
      const staged = stage(bundle).probandConditions[0];
      expect(staged.status).toBe('new');
      expect(staged.defaultSelected).toBe(true);
    },
  );

  it('a confirmed condition with no clinicalStatus at all still stays included', () => {
    const bundle = fhirBundle([
      patientResource({ birthDate: '1988-01-01' }),
      conditionResource({
        id: 'c1',
        verificationStatus: 'confirmed',
        omitClinicalStatus: true,
        codings: [
          { system: SYS.icd10cm, code: 'C50.919', display: 'Malignant neoplasm of breast' },
        ],
      }),
    ]);
    const staged = stage(bundle).probandConditions[0];
    expect(staged.status).toBe('new');
    expect(staged.defaultSelected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Coded-absence ("no known history of X")
// ---------------------------------------------------------------------------

describe('parseFhirImport — coded-absence is excluded, never a positive condition', () => {
  it('excludes a Condition coded with the absence SNOMED concept even when verificationStatus is confirmed', () => {
    const bundle = fhirBundle([
      patientResource({ birthDate: '1988-01-01' }),
      conditionResource({
        id: 'c-real',
        verificationStatus: 'confirmed',
        codings: [
          { system: SYS.icd10cm, code: 'C50.919', display: 'Malignant neoplasm of breast' },
        ],
      }),
      conditionResource({
        id: 'c-absent',
        verificationStatus: 'confirmed',
        codings: [
          {
            system: SYS.snomed,
            code: ABSENCE_SNOMED_CODE,
            display: 'No known history of breast cancer',
          },
        ],
      }),
    ]);
    const parsed = parseFhirImport(bundle);
    expect(parsed.proband.problems).toHaveLength(1);
    expect(stage(bundle).probandConditions).toHaveLength(1);
    expect(parsed.warnings.some((w) => /not imported/i.test(w))).toBe(true);
  });

  it("excludes a coded-absence entry from a relative's FamilyMemberHistory.condition the same way", () => {
    const bundle = fhirBundle([
      patientResource(),
      familyMemberHistoryResource({
        id: 'fmh-1',
        status: 'completed',
        relationshipCode: 'MTH',
        sexCode: 'female',
        name: 'Mother',
        conditions: [
          {
            codings: [{ system: SYS.icd10cm, code: 'C50.919', display: 'Breast cancer' }],
            onsetAgeYears: 55,
          },
          {
            codings: [
              {
                system: SYS.snomed,
                code: ABSENCE_SNOMED_CODE,
                display: 'No known family history of breast cancer',
              },
            ],
          },
        ],
      }),
    ]);
    const parsed = parseFhirImport(bundle);
    expect(parsed.familyMembers[0].problems).toHaveLength(1);
    expect(parsed.familyMembers[0].problems[0].onsetYear).toBe(55);
  });
});

// ---------------------------------------------------------------------------
// Code extraction priority
// ---------------------------------------------------------------------------

describe('parseFhirImport — code extraction priority (curated ICD-10 > curated SNOMED > long-tail ICD-10 > generic SNOMED > narrative-only)', () => {
  function codedFor(codings: FixtureCoding[], text?: string) {
    const bundle = fhirBundle([
      patientResource({ birthDate: '1988-01-01' }),
      conditionResource({ id: 'c1', verificationStatus: 'confirmed', codings, text }),
    ]);
    return {
      parsed: parseFhirImport(bundle).proband.problems[0],
      staged: stage(bundle).probandConditions[0],
    };
  }

  it('prefers a curated ICD-10-CM coding over curated SNOMED, ICD-9, and a proprietary system all present together', () => {
    const { staged } = codedFor([
      { system: SYS.proprietary, code: 'LOCAL-99', display: 'Local vendor code' },
      { system: SYS.icd9cm, code: '401.9', display: 'Essential hypertension (legacy)' },
      { system: SYS.snomed, code: '38341003', display: 'Hypertension' }, // curated (htn)
      { system: SYS.icd10cm, code: 'I10', display: 'Essential hypertension' }, // curated (htn)
    ]);
    expect(staged.suggestedConditionId).toBe('htn');
    expect(staged.status).toBe('new');
  });

  it('falls back to curated SNOMED when no ICD-10-CM coding is present', () => {
    const { staged } = codedFor([
      { system: SYS.snomed, code: '44054006', display: 'Type 2 diabetes' },
    ]); // curated (t2d)
    expect(staged.suggestedConditionId).toBe('t2d');
    expect(staged.status).toBe('new');
  });

  it('treats a real ICD-10-CM code with no curated match as its own long-tail suggestion (verbatim, never fabricated)', () => {
    const { staged } = codedFor([
      { system: SYS.icd10cm, code: 'S72.001A', display: 'Fracture of neck of right femur' },
    ]);
    expect(staged).toMatchObject({
      suggestedConditionId: 'S72.001A',
      status: 'new',
      defaultSelected: true,
    });
  });

  it('prefers the long-tail ICD-10-CM code over a generic no-curated-match SNOMED code when both are present', () => {
    const { staged } = codedFor([
      { system: SYS.snomed, code: '444814009', display: 'Rare inherited metabolic disorder' },
      { system: SYS.icd10cm, code: 'S72.001A', display: 'Fracture of neck of right femur' },
    ]);
    expect(staged.suggestedConditionId).toBe('S72.001A');
  });

  it('surfaces a SNOMED-only code with no curated match as needs-review, code+name preserved verbatim, defaulted OFF', () => {
    const { staged } = codedFor([
      { system: SYS.snomed, code: '444814009', display: 'Rare inherited metabolic disorder' },
    ]);
    expect(staged).toMatchObject({
      suggestedConditionId: '444814009',
      displayName: 'Rare inherited metabolic disorder',
      status: 'needs-review',
      defaultSelected: false,
    });
  });

  it('treats an ICD-9-CM-only coding as unrecognized — surfaced narrative-only, never crosswalked', () => {
    const { parsed, staged } = codedFor([
      { system: SYS.icd9cm, code: '250.00', display: 'Diabetes mellitus' },
    ]);
    expect(parsed.coded).toEqual({ system: null, code: null, displayName: 'Diabetes mellitus' });
    expect(staged.suggestedConditionId).toBeNull();
    expect(staged.status).toBe('needs-review');
  });

  it('treats a proprietary/other-system-only code as unrecognized — surfaced narrative-only', () => {
    const { parsed } = codedFor([
      { system: SYS.proprietary, code: 'LOCAL-99', display: 'Local vendor diagnosis' },
    ]);
    expect(parsed.coded).toEqual({
      system: null,
      code: null,
      displayName: 'Local vendor diagnosis',
    });
  });

  it('surfaces a code.text-only entry (no coding[] at all) verbatim as narrative-only', () => {
    const { parsed } = codedFor([], 'Reports intermittent low back pain');
    expect(parsed.coded).toEqual({
      system: null,
      code: null,
      displayName: 'Reports intermittent low back pain',
    });
  });
});

// ---------------------------------------------------------------------------
// Onset (proband Condition) — explicit-presence-only
// ---------------------------------------------------------------------------

describe('parseFhirImport — onset (proband Condition), explicit-presence-only, never defaulted to 0', () => {
  const birthDate = '1988-06-15'; // birth year 1988

  function onsetOf(overrides: {
    onsetAgeYears?: number;
    onsetDateTime?: string;
    onsetPeriodStart?: string;
    onsetString?: string;
    onsetRangeLowYears?: number;
    onsetRangeHighYears?: number;
    omitBirthDate?: boolean;
  }): number | null {
    const bundle = fhirBundle([
      overrides.omitBirthDate ? patientResource() : patientResource({ birthDate }),
      conditionResource({
        id: 'c1',
        verificationStatus: 'confirmed',
        codings: [{ system: SYS.icd10cm, code: 'I10', display: 'Hypertension' }],
        ...overrides,
      }),
    ]);
    return parseFhirImport(bundle).proband.problems[0].onsetYear;
  }

  it('uses onsetAge directly (never re-derived from Patient.birthDate)', () => {
    expect(onsetOf({ onsetAgeYears: 35 })).toBe(35);
  });

  it('computes onset age from onsetDateTime year minus Patient.birthDate year', () => {
    expect(onsetOf({ onsetDateTime: '2015-03-01' })).toBe(27); // 2015 - 1988
  });

  it('computes an onset age of exactly 0 when the diagnosis year equals the birth year (not treated as unknown)', () => {
    expect(onsetOf({ onsetDateTime: '1988-11-01' })).toBe(0);
  });

  it('returns null rather than a negative age when onsetDateTime predates the recorded birth year', () => {
    expect(onsetOf({ onsetDateTime: '1980-01-01' })).toBeNull();
  });

  it('returns null when Patient.birthDate is absent, never defaulting to 0', () => {
    expect(onsetOf({ onsetDateTime: '2015-03-01', omitBirthDate: true })).toBeNull();
  });

  it('computes onset from onsetPeriod.start exactly like onsetDateTime', () => {
    expect(onsetOf({ onsetPeriodStart: '2015-03-01' })).toBe(27);
  });

  it('never fabricates a point onset from onsetString (returns null)', () => {
    expect(onsetOf({ onsetString: 'childhood' })).toBeNull();
  });

  it('never fabricates a point onset from onsetRange beyond the documented conservative choice (null or the low bound — never the midpoint or high bound)', () => {
    const value = onsetOf({ onsetRangeLowYears: 30, onsetRangeHighYears: 40 });
    expect([null, 30]).toContain(value);
    expect(value).not.toBe(35);
    expect(value).not.toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Onset (FamilyMemberHistory.condition)
// ---------------------------------------------------------------------------

describe('parseFhirImport — onset (FamilyMemberHistory.condition)', () => {
  function onsetOf(overrides: Partial<FixtureFmhConditionOpts>): number | null {
    const bundle = fhirBundle([
      patientResource(),
      familyMemberHistoryResource({
        id: 'fmh-1',
        status: 'completed',
        relationshipCode: 'MTH',
        sexCode: 'female',
        name: 'Mother',
        conditions: [
          {
            codings: [{ system: SYS.icd10cm, code: 'C50.919', display: 'Breast cancer' }],
            ...overrides,
          },
        ],
      }),
    ]);
    return parseFhirImport(bundle).familyMembers[0].problems[0].onsetYear;
  }

  it('uses onsetAge directly as the age at onset', () => {
    expect(onsetOf({ onsetAgeYears: 45 })).toBe(45);
  });

  it('never fabricates a point onset from onsetPeriod or onsetString on a relative (no reliable birth year to compute from)', () => {
    expect(onsetOf({ onsetPeriodStart: '2000-01-01' })).toBeNull();
    expect(onsetOf({ onsetString: 'as a young adult' })).toBeNull();
  });

  it('never fabricates a point onset from onsetRange beyond the documented conservative choice (null or the low bound)', () => {
    const value = onsetOf({ onsetRangeLowYears: 50 });
    expect([null, 50]).toContain(value);
  });
});

// ---------------------------------------------------------------------------
// FamilyMemberHistory.status disposition
// ---------------------------------------------------------------------------

describe('parseFhirImport — FamilyMemberHistory.status disposition', () => {
  it('status=completed processes the relative and its conditions normally', () => {
    const bundle = fhirBundle([
      patientResource(),
      familyMemberHistoryResource({
        id: 'fmh-1',
        status: 'completed',
        relationshipCode: 'MTH',
        sexCode: 'female',
        name: 'Mother',
        conditions: [
          {
            codings: [{ system: SYS.icd10cm, code: 'C50.919', display: 'Breast cancer' }],
            onsetAgeYears: 45,
          },
        ],
      }),
    ]);
    const parsed = parseFhirImport(bundle);
    expect(parsed.familyMembers).toHaveLength(1);
    expect(parsed.familyMembers[0].problems).toEqual([expect.objectContaining({ onsetYear: 45 })]);
  });

  it('status=partial processes the relative and its conditions normally but adds a "history may be incomplete" warning', () => {
    const bundle = fhirBundle([
      patientResource(),
      familyMemberHistoryResource({
        id: 'fmh-1',
        status: 'partial',
        relationshipCode: 'BRO',
        name: 'Partial Brother',
        conditions: [
          { codings: [{ system: SYS.icd10cm, code: 'F41.9', display: 'Anxiety disorder' }] },
        ],
      }),
    ]);
    const parsed = parseFhirImport(bundle);
    expect(parsed.familyMembers).toHaveLength(1);
    expect(parsed.familyMembers[0].problems).toHaveLength(1);
    expect(parsed.warnings.some((w) => /history may be incomplete/i.test(w))).toBe(true);
  });

  it('status=health-unknown creates the relative (geometry) but attaches NO conditions even when the resource carries some — never asserted healthy', () => {
    const bundle = fhirBundle([
      patientResource(),
      familyMemberHistoryResource({
        id: 'fmh-1',
        status: 'health-unknown',
        relationshipCode: 'MTH',
        sexCode: 'female',
        name: 'Unknown History Mother',
        conditions: [
          { codings: [{ system: SYS.icd10cm, code: 'C50.919', display: 'Breast cancer' }] },
        ],
      }),
    ]);
    const parsed = parseFhirImport(bundle);
    expect(parsed.familyMembers).toHaveLength(1);
    expect(parsed.familyMembers[0].problems).toEqual([]);

    const staged = stage(bundle, emptyRecord());
    expect(staged.familyMembers[0].placement).toEqual({ anchorId: 'you', relation: 'parent' });
    expect(staged.familyMembers[0].conditions).toEqual([]);
  });

  it('status=entered-in-error EXCLUDES the whole relative instance — no relative, no conditions', () => {
    const bundle = fhirBundle([
      patientResource(),
      familyMemberHistoryResource({
        id: 'fmh-good',
        status: 'completed',
        relationshipCode: 'MTH',
        name: 'Jane',
      }),
      familyMemberHistoryResource({
        id: 'fmh-bad',
        status: 'entered-in-error',
        relationshipCode: 'FTH',
        name: 'Should Not Appear',
        conditions: [
          { codings: [{ system: SYS.icd10cm, code: 'E11.9', display: 'Type 2 diabetes' }] },
        ],
      }),
    ]);
    const parsed = parseFhirImport(bundle);
    expect(parsed.familyMembers).toHaveLength(1);
    expect(parsed.familyMembers[0].name).toBe('Jane');
  });
});

// ---------------------------------------------------------------------------
// FamilyMemberHistory.dataAbsentReason
// ---------------------------------------------------------------------------

describe('parseFhirImport — FamilyMemberHistory.dataAbsentReason', () => {
  it('a general dataAbsentReason is treated like health-unknown (no fabricated conditions) but still allows normal auto-placement', () => {
    const bundle = fhirBundle([
      patientResource(),
      familyMemberHistoryResource({
        id: 'fmh-1',
        status: 'completed',
        relationshipCode: 'MTH',
        sexCode: 'female',
        name: 'Mother With Absent Data',
        dataAbsentReason: 'unable-to-obtain',
      }),
    ]);
    const staged = stage(bundle, emptyRecord());
    const member = staged.familyMembers[0];
    expect(member.conditions).toEqual([]);
    expect(member.placement).toEqual({ anchorId: 'you', relation: 'parent' });
    expect(member.matchStatus).toBe('new-person');
  });

  it('dataAbsentReason=subject-unknown forces ambiguous placement regardless of the relationship code', () => {
    const bundle = fhirBundle([
      patientResource(),
      familyMemberHistoryResource({
        id: 'fmh-1',
        status: 'completed',
        relationshipCode: 'MTH', // would otherwise auto-place as a parent
        sexCode: 'female',
        name: 'Mystery Mother',
        dataAbsentReason: 'subject-unknown',
      }),
    ]);
    const staged = stage(bundle, emptyRecord());
    const member = staged.familyMembers[0];
    expect(member.placement).toBeNull();
    expect(member.matchStatus).toBe('ambiguous');
    expect(member.defaultSelected).toBe(false);
  });

  it('dataAbsentReason=subject-unknown still retains sab from a sex-specific relationship code (MTH→f) even though placement is forced ambiguous', () => {
    // The relationship code itself (MTH) is a genuine, known fact even when the FHIR server can't
    // identify WHICH person this is (subject-unknown) — sab must not be downgraded to 'u' just
    // because placement had to be blanked for safety (guardrail #4: sab is never conflated with
    // "we don't know who to attach this to").
    const bundle = fhirBundle([
      patientResource(),
      familyMemberHistoryResource({
        id: 'fmh-1',
        status: 'completed',
        relationshipCode: 'MTH',
        // deliberately NO sexCode — sab must fall back to the relationship-implied value, not 'u'.
        name: 'Mystery Mother',
        dataAbsentReason: 'subject-unknown',
      }),
    ]);
    const parsed = parseFhirImport(bundle);
    expect(parsed.familyMembers[0].sab).toBe('f');

    const staged = stage(bundle, emptyRecord()).familyMembers[0];
    expect(staged.placement).toBeNull();
    expect(staged.matchStatus).toBe('ambiguous');
  });
});

// ---------------------------------------------------------------------------
// Relationship auto-place vs ambiguous
// ---------------------------------------------------------------------------

describe('parseFhirImport — relationship auto-placement vs ambiguous (safety-critical)', () => {
  const record = seedRecord(); // proband "you"; parents robert(m)/susan(f); siblings jack, emma; children zoe, leo

  function stageRel(fmh: FixtureFmhOpts) {
    const bundle = fhirBundle([patientResource(), familyMemberHistoryResource(fmh)]);
    return stage(bundle, record).familyMembers[0];
  }

  it('auto-places MTH as a parent, matching susan by name', () => {
    const staged = stageRel({
      id: 'fmh-1',
      status: 'completed',
      relationshipCode: 'MTH',
      name: 'Susan',
    });
    expect(staged.placement).toEqual({ anchorId: 'you', relation: 'parent' });
    expect(staged.matchStatus).toBe('matched-existing');
    expect(staged.matchedPersonId).toBe('susan');
  });

  it('auto-places BRO as a sibling, matching jack by name', () => {
    const staged = stageRel({
      id: 'fmh-2',
      status: 'completed',
      relationshipCode: 'BRO',
      name: 'Jack',
    });
    expect(staged.placement).toEqual({ anchorId: 'you', relation: 'sibling' });
    expect(staged.matchedPersonId).toBe('jack');
  });

  it.each(['FTWINBRO', 'FTWINSIS', 'ITWINBRO', 'ITWINSIS'])(
    'treats twin RoleCode %s as a full sibling, auto-placed',
    (code) => {
      const staged = stageRel({
        id: `fmh-twin-${code}`,
        status: 'completed',
        relationshipCode: code,
        name: 'New Twin',
      });
      expect(staged.placement).toEqual({ anchorId: 'you', relation: 'sibling' });
    },
  );

  it('auto-places DAU as a child, matching zoe by name', () => {
    const staged = stageRel({
      id: 'fmh-3',
      status: 'completed',
      relationshipCode: 'DAU',
      name: 'Zoe',
    });
    expect(staged.placement).toEqual({ anchorId: 'you', relation: 'child' });
    expect(staged.matchedPersonId).toBe('zoe');
  });

  it('auto-places a side-specified grandparent (MGRMTH) only via the already-existing linking parent (susan)', () => {
    const staged = stageRel({
      id: 'fmh-4',
      status: 'completed',
      relationshipCode: 'MGRMTH',
      name: 'Helen',
    });
    expect(staged.placement).toEqual({ anchorId: 'susan', relation: 'parent' });
    expect(staged.matchedPersonId).toBe('helen');
  });

  it('never auto-places a foster relationship (MTHFOST — the correct v3-RoleCode; NOT the invalid FSTRMTH)', () => {
    const staged = stageRel({
      id: 'fmh-5',
      status: 'completed',
      relationshipCode: 'MTHFOST',
      name: 'Foster Mom',
    });
    expect(staged.placement).toBeNull();
    expect(staged.matchStatus).toBe('ambiguous');
    expect(staged.defaultSelected).toBe(false);
  });

  it('never auto-places the generic (non-biological) child RoleCode CHILD', () => {
    const staged = stageRel({
      id: 'fmh-6',
      status: 'completed',
      relationshipCode: 'CHILD',
      name: 'Someone',
    });
    expect(staged.placement).toBeNull();
    expect(staged.matchStatus).toBe('ambiguous');
  });

  it('never auto-places an aunt (side-unknown / extended relative)', () => {
    const staged = stageRel({
      id: 'fmh-7',
      status: 'completed',
      relationshipCode: 'AUNT',
      name: 'Someone',
    });
    expect(staged.placement).toBeNull();
    expect(staged.matchStatus).toBe('ambiguous');
  });

  it('never auto-places a relationship code from a non-v3-RoleCode system, even when the code itself reads "MTH"', () => {
    const staged = stageRel({
      id: 'fmh-8',
      status: 'completed',
      relationshipCode: 'MTH',
      relationshipSystem: 'http://example-vendor.test/local-relationship-codes',
      name: 'Someone',
    });
    expect(staged.placement).toBeNull();
    expect(staged.matchStatus).toBe('ambiguous');
  });

  it('surfaces a .text-only relationship (no coding at all) as ambiguous, using the text as the display label', () => {
    const bundle = fhirBundle([
      patientResource(),
      familyMemberHistoryResource({
        id: 'fmh-9',
        status: 'completed',
        relationshipTextOnly: 'Second cousin',
        name: 'Someone',
      }),
    ]);
    const parsed = parseFhirImport(bundle);
    expect(parsed.familyMembers[0].relationshipDisplay).toBe('Second cousin');
    const staged = stageHealthRecordImport(parsed, record, catalog).familyMembers[0];
    expect(staged.placement).toBeNull();
    expect(staged.matchStatus).toBe('ambiguous');
  });
});

// ---------------------------------------------------------------------------
// Sex assigned at birth (relatives)
// ---------------------------------------------------------------------------

describe('parseFhirImport — sex assigned at birth (relatives, from FamilyMemberHistory.sex)', () => {
  it.each([
    ['male', 'm'],
    ['female', 'f'],
    ['other', 'x'],
    ['unknown', 'u'],
  ] as const)('maps administrative-gender code %s to sab %s', (code, sab) => {
    const bundle = fhirBundle([
      patientResource(),
      familyMemberHistoryResource({
        id: 'fmh-sex',
        status: 'completed',
        relationshipCode: 'SIB',
        sexCode: code,
        name: 'Someone',
      }),
    ]);
    expect(parseFhirImport(bundle).familyMembers[0].sab).toBe(sab);
  });

  it('falls back to a sex-SPECIFIC relationship code only when sex.coding is absent', () => {
    const bundle = fhirBundle([
      patientResource(),
      familyMemberHistoryResource({
        id: 'fmh-fth',
        status: 'completed',
        relationshipCode: 'FTH',
        name: 'Dad',
      }),
    ]);
    expect(parseFhirImport(bundle).familyMembers[0].sab).toBe('m');
  });

  it('never infers sab from a sex-neutral relationship code absent sex.coding', () => {
    const bundle = fhirBundle([
      patientResource(),
      familyMemberHistoryResource({
        id: 'fmh-sib',
        status: 'completed',
        relationshipCode: 'SIB',
        name: 'Sibling',
      }),
    ]);
    expect(parseFhirImport(bundle).familyMembers[0].sab).toBe('u');
  });
});

// ---------------------------------------------------------------------------
// Deceased (FamilyMemberHistory.deceased[x]) — explicit-presence-only
// ---------------------------------------------------------------------------

describe('parseFhirImport — FamilyMemberHistory.deceased[x], explicit-presence-only, never inferred', () => {
  function deathOf(overrides: Partial<FixtureFmhOpts>) {
    const bundle = fhirBundle([
      patientResource(),
      familyMemberHistoryResource({
        id: 'fmh-1',
        status: 'completed',
        relationshipCode: 'MTH',
        name: 'Mother',
        ...overrides,
      }),
    ]);
    return parseFhirImport(bundle).familyMembers[0].death;
  }

  it('deceasedBoolean=true marks dead with no known year', () => {
    expect(deathOf({ deceasedBoolean: true })).toEqual({ year: null, dead: true });
  });

  it('deceasedBoolean=false marks alive', () => {
    expect(deathOf({ deceasedBoolean: false })).toEqual({ year: null, dead: false });
  });

  it('an absent deceased[x] leaves death status unknown, never inferred', () => {
    expect(deathOf({})).toEqual({ year: null, dead: null });
  });

  it('deceasedDate implies dead and supplies the death year', () => {
    expect(deathOf({ deceasedDate: '2015-06-01' })).toEqual({ year: 2015, dead: true });
  });

  it('deceasedAge alone marks dead with no year known (an age at death, not a calendar year, was recorded)', () => {
    expect(deathOf({ deceasedAgeYears: 80 })).toEqual({ year: null, dead: true });
  });

  it('deceasedRange alone marks dead with no year known (a range asserts death without a calendar year)', () => {
    expect(deathOf({ deceasedRangeLowYears: 70 })).toEqual({ year: null, dead: true });
  });

  it('deceasedString alone marks dead with no year known (free text asserts death, never a fabricated year)', () => {
    expect(deathOf({ deceasedString: 'sometime in her later years' })).toEqual({
      year: null,
      dead: true,
    });
  });
});

// ---------------------------------------------------------------------------
// contributedToDeath — annotation only
// ---------------------------------------------------------------------------

describe('parseFhirImport — FamilyMemberHistory.condition.contributedToDeath is an annotation only', () => {
  it('never changes the staged disposition of an already-gated condition — true vs false vs absent all produce identical staged output', () => {
    function stagedFor(contributedToDeath: boolean | undefined) {
      const bundle = fhirBundle([
        patientResource(),
        familyMemberHistoryResource({
          id: 'fmh-1',
          status: 'completed',
          relationshipCode: 'MTH',
          sexCode: 'female',
          name: 'Mother',
          conditions: [
            {
              codings: [{ system: SYS.icd10cm, code: 'C50.919', display: 'Breast cancer' }],
              onsetAgeYears: 55,
              ...(contributedToDeath !== undefined ? { contributedToDeath } : {}),
            },
          ],
        }),
      ]);
      return stage(bundle, emptyRecord());
    }

    const withTrue = stagedFor(true);
    const withFalse = stagedFor(false);
    const withAbsent = stagedFor(undefined);
    expect(withTrue).toEqual(withFalse);
    expect(withTrue).toEqual(withAbsent);
  });
});

// ---------------------------------------------------------------------------
// Combined pipeline (parse → stage → apply)
// ---------------------------------------------------------------------------

describe('parseFhirImport → stageHealthRecordImport → applyHealthRecordImport — combined pipeline', () => {
  it('produces a fully valid record after a combined proband + family-history import, honoring dispositions end to end', () => {
    const bundle = fhirBundle([
      patientResource({ birthDate: '1988-01-01', birthsex: 'F' }),
      conditionResource({
        id: 'c1',
        verificationStatus: 'confirmed',
        codings: [{ system: SYS.icd10cm, code: 'E11.9', display: 'Type 2 diabetes' }],
        onsetDateTime: '2020-01-01',
      }),
      conditionResource({
        id: 'c-refuted',
        verificationStatus: 'refuted',
        codings: [{ system: SYS.icd10cm, code: 'F41.9', display: 'Anxiety disorder' }],
      }),
      familyMemberHistoryResource({
        id: 'fmh-1',
        status: 'completed',
        relationshipCode: 'MGRMTH',
        sexCode: 'female',
        name: 'Helen',
        conditions: [
          {
            codings: [{ system: SYS.icd10cm, code: 'C50.919', display: 'Breast cancer' }],
            onsetAgeYears: 60,
          },
        ],
      }),
    ]);
    const record = seedRecord();
    const parsed = parseFhirImport(bundle);
    const staged = stageHealthRecordImport(parsed, record, catalog);

    // The refuted condition was never a candidate — proves it can't leak in even via "select everything".
    expect(staged.probandConditions.map((c) => c.suggestedConditionId)).not.toContain('anx');

    const allParseIds = [
      ...staged.probandConditions.map((c) => c.parseId),
      ...staged.familyMembers.map((m) => m.parseId),
      ...staged.familyMembers.flatMap((m) => m.conditions.map((c) => c.parseId)),
    ];
    const { record: applied } = applyHealthRecordImport(
      record,
      staged,
      { selectedParseIds: new Set(allParseIds) },
      catalog,
    );
    expect(isValidRecord(applied)).toBe(true);
  });

  it('lands an auto-placed sibling as an actual genetic relative of the proband (graph-verified)', () => {
    const record = emptyRecord();
    const bundle = fhirBundle([
      patientResource(),
      familyMemberHistoryResource({
        id: 'fmh-1',
        status: 'completed',
        relationshipCode: 'BRO',
        sexCode: 'male',
        name: 'New Brother',
        bornDate: '1990-01-01',
        conditions: [
          {
            codings: [{ system: SYS.icd10cm, code: 'E11.9', display: 'Type 2 diabetes' }],
            onsetAgeYears: 40,
          },
        ],
      }),
    ]);
    const parsed = parseFhirImport(bundle);
    const staged = stageHealthRecordImport(parsed, record, catalog);
    const member = staged.familyMembers[0];
    expect(member.matchStatus).toBe('new-person');

    const selections = {
      selectedParseIds: new Set([member.parseId, ...member.conditions.map((c) => c.parseId)]),
    };
    const { record: applied } = applyHealthRecordImport(record, staged, selections, catalog);

    const idx = indexPeople(applied.people, applied.unions);
    const siblingUnion = applied.unions.find((u) => u.children.includes(applied.probandId));
    const brotherId = siblingUnion?.children.find((id) => id !== applied.probandId);
    expect(brotherId).toBeDefined();
    const brother = personById(idx, brotherId!)!;
    expect(brother.name).toBe('New Brother');
    expect(brother.sab).toBe('m');
    expect(brother.birth).toBe(1990);
    expect(brother.conds).toEqual([{ id: 't2d', onset: 40, prov: 'record' }]);
  });
});

// ===========================================================================
// Wave 2/3 — full-timeline events (medications, labs, vitals, genomic,
// immunizations, allergies, procedures, encounters). See timeline-import-contract.md
// §W2/§W3 and the medical-verified status-bucket table. Every assertion targets the
// STAGED (and, where dedup/apply matters, APPLIED) shape — the review UI and final
// FamilyRecord are what a user actually sees.
// ===========================================================================

const RXNORM_METFORMIN: FixtureCoding = {
  system: SYS.rxnorm,
  code: '860975',
  display: 'Metformin 500 MG Oral Tablet',
};
const CVX_FLU: FixtureCoding = { system: SYS.cvx, code: '158', display: 'Influenza vaccine' };
const LOINC_A1C: FixtureCoding = { system: SYS.loinc, code: '4548-4', display: 'Hemoglobin A1c' };
const LOINC_BP: FixtureCoding = {
  system: SYS.loinc,
  code: '8480-6',
  display: 'Systolic blood pressure',
};
const SNOMED_APPENDECTOMY: FixtureCoding = {
  system: SYS.snomed,
  code: '80146002',
  display: 'Appendectomy',
};
const SNOMED_PEANUT: FixtureCoding = { system: SYS.snomed, code: '256349002', display: 'Peanut' };

// ---------------------------------------------------------------------------
// MedicationStatement — status disposition
// ---------------------------------------------------------------------------

describe('parseFhirImport — MedicationStatement.status disposition', () => {
  function bundleFor(opts: Partial<FixtureMedicationStatementOpts>) {
    return fhirBundle([
      patientResource(),
      medicationStatementResource({
        id: 'ms1',
        status: 'active',
        medicationCodings: [RXNORM_METFORMIN],
        effectiveDateTime: '2020-05-01',
        ...opts,
      }),
    ]);
  }

  it.each(['active', 'completed', 'stopped'] as const)(
    'status=%s (settled) is staged as a new, defaulted-ON medication event',
    (status) => {
      const staged = stagedEvents(bundleFor({ status }))[0];
      expect(staged).toMatchObject({ type: 'medication', status: 'new', defaultSelected: true });
    },
  );

  it.each(['intended', 'on-hold', 'unknown'] as const)(
    'status=%s (interim) is staged needs-review, defaulted OFF',
    (status) => {
      const staged = stagedEvents(bundleFor({ status }))[0];
      expect(staged.status).toBe('needs-review');
      expect(staged.defaultSelected).toBe(false);
    },
  );

  it('status=not-taken (absence) is excluded and counted in a warning, never staged as a positive event', () => {
    const bundle = bundleFor({ status: 'not-taken' });
    expect(parsedEvents(bundle)).toHaveLength(0);
    expect(parseFhirImport(bundle).warnings.length).toBeGreaterThan(0);
  });

  it('status=entered-in-error is excluded silently — never staged, never counted in any warning', () => {
    const bundle = bundleFor({ status: 'entered-in-error' });
    expect(parsedEvents(bundle)).toHaveLength(0);
    expect(parseFhirImport(bundle).warnings).toHaveLength(0);
  });

  it.each([
    ['active', true],
    ['completed', false],
    ['stopped', false],
  ] as const)('med.ongoing = (status===active): status=%s -> ongoing=%s', (status, ongoing) => {
    const staged = stagedEvents(bundleFor({ status }))[0];
    expect(staged.med?.ongoing).toBe(ongoing);
  });
});

// ---------------------------------------------------------------------------
// MedicationRequest — status disposition
// ---------------------------------------------------------------------------

describe('parseFhirImport — MedicationRequest.status disposition', () => {
  function bundleFor(opts: Partial<FixtureMedicationRequestOpts>) {
    return fhirBundle([
      patientResource(),
      medicationRequestResource({
        id: 'mr1',
        status: 'active',
        medicationCodings: [RXNORM_METFORMIN],
        authoredOn: '2020-05-01',
        ...opts,
      }),
    ]);
  }

  it.each(['active', 'completed', 'stopped'] as const)(
    'status=%s (settled) is staged as a new, defaulted-ON medication event',
    (status) => {
      const staged = stagedEvents(bundleFor({ status }))[0];
      expect(staged).toMatchObject({ type: 'medication', status: 'new', defaultSelected: true });
    },
  );

  it.each(['on-hold', 'draft', 'unknown'] as const)(
    'status=%s (interim) is staged needs-review, defaulted OFF',
    (status) => {
      const staged = stagedEvents(bundleFor({ status }))[0];
      expect(staged.status).toBe('needs-review');
      expect(staged.defaultSelected).toBe(false);
    },
  );

  it('status=cancelled (absence) is excluded and counted in a warning, never a positive event', () => {
    const bundle = bundleFor({ status: 'cancelled' });
    expect(parsedEvents(bundle)).toHaveLength(0);
    expect(parseFhirImport(bundle).warnings.length).toBeGreaterThan(0);
  });

  it('status=entered-in-error is excluded silently', () => {
    const bundle = bundleFor({ status: 'entered-in-error' });
    expect(parsedEvents(bundle)).toHaveLength(0);
    expect(parseFhirImport(bundle).warnings).toHaveLength(0);
  });

  it('date comes from authoredOn (not effectiveDateTime, which MedicationRequest has no such field for)', () => {
    const staged = stagedEvents(bundleFor({ authoredOn: '2021-07-04' }))[0];
    expect(staged.year).toBe(2021);
    expect(staged.date).toBe('2021-07-04');
  });

  it('a MedicationRequest with no authoredOn is dropped and counted, never defaulted to any date', () => {
    const bundle = fhirBundle([
      patientResource(),
      medicationRequestResource({
        id: 'mr-nodate',
        status: 'active',
        medicationCodings: [RXNORM_METFORMIN],
      }),
    ]);
    expect(parsedEvents(bundle)).toHaveLength(0);
    expect(parseFhirImport(bundle).warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Medication payload — CodeableConcept vs Reference vs contained, dose
// ---------------------------------------------------------------------------

describe('parseFhirImport — medication payload resolution', () => {
  it('medicationCodeableConcept resolves to coding + a display name', () => {
    const bundle = fhirBundle([
      patientResource(),
      medicationStatementResource({
        id: 'ms1',
        status: 'active',
        medicationCodings: [RXNORM_METFORMIN],
        effectiveDateTime: '2020-01-01',
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged.coding).toEqual([
      { system: SYS.rxnorm, code: '860975', display: 'Metformin 500 MG Oral Tablet' },
    ]);
    expect(staged.title).toMatch(/metformin/i);
  });

  it('medicationReference resolves against a separate, `_include`d Medication bundle entry', () => {
    const bundle = fhirBundle([
      patientResource(),
      medicationResource({ id: 'med-included', codings: [RXNORM_METFORMIN] }),
      medicationStatementResource({
        id: 'ms1',
        status: 'active',
        medicationReferenceId: 'med-included',
        effectiveDateTime: '2020-01-01',
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged.coding).toEqual([
      { system: SYS.rxnorm, code: '860975', display: 'Metformin 500 MG Oral Tablet' },
    ]);
    // Resolved to a real medication — never surfaced as needs-review for THIS reason.
    expect(staged.status).toBe('new');
  });

  it('medicationReference resolves against a `contained` Medication resource', () => {
    const bundle = fhirBundle([
      patientResource(),
      medicationRequestResource({
        id: 'mr1',
        status: 'active',
        containedMedication: { id: 'med-c1', codings: [RXNORM_METFORMIN] },
        authoredOn: '2020-01-01',
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged.coding).toEqual([
      { system: SYS.rxnorm, code: '860975', display: 'Metformin 500 MG Oral Tablet' },
    ]);
  });

  it('an unresolvable medicationReference is surfaced narrative/needs-review, never silently dropped', () => {
    const bundle = fhirBundle([
      patientResource(),
      medicationStatementResource({
        id: 'ms1',
        status: 'active',
        medicationReferenceId: 'does-not-exist-anywhere',
        effectiveDateTime: '2020-01-01',
      }),
    ]);
    const staged = stagedEvents(bundle);
    expect(staged).toHaveLength(1); // never dropped
    expect(staged[0].status).toBe('needs-review');
  });

  it('dose comes from MedicationStatement.dosage[0].text', () => {
    const bundle = fhirBundle([
      patientResource(),
      medicationStatementResource({
        id: 'ms1',
        status: 'active',
        medicationCodings: [RXNORM_METFORMIN],
        effectiveDateTime: '2020-01-01',
        dosageText: '500mg twice daily',
      }),
    ]);
    expect(stagedEvents(bundle)[0].med?.dose).toBe('500mg twice daily');
  });

  it('dose comes from MedicationRequest.dosageInstruction[0].text', () => {
    const bundle = fhirBundle([
      patientResource(),
      medicationRequestResource({
        id: 'mr1',
        status: 'active',
        medicationCodings: [RXNORM_METFORMIN],
        authoredOn: '2020-01-01',
        dosageText: '10mg once daily',
      }),
    ]);
    expect(stagedEvents(bundle)[0].med?.dose).toBe('10mg once daily');
  });
});

// ---------------------------------------------------------------------------
// Observation/laboratory — status disposition
// ---------------------------------------------------------------------------

describe('parseFhirImport — Observation(laboratory).status disposition', () => {
  function bundleFor(status: string) {
    return fhirBundle([
      patientResource(),
      observationResource({
        id: 'obs1',
        category: 'laboratory',
        status,
        codings: [LOINC_A1C],
        effectiveDateTime: '2021-03-01',
        valueQuantity: { value: 5.4, unit: '%' },
      }),
    ]);
  }

  it.each(['final', 'amended', 'corrected'] as const)(
    'status=%s (settled) is staged as a new, defaulted-ON lab event',
    (status) => {
      const staged = stagedEvents(bundleFor(status))[0];
      expect(staged).toMatchObject({ type: 'lab', status: 'new', defaultSelected: true });
    },
  );

  it.each(['registered', 'preliminary', 'unknown'] as const)(
    'status=%s (interim) is staged needs-review, defaulted OFF',
    (status) => {
      const staged = stagedEvents(bundleFor(status))[0];
      expect(staged.status).toBe('needs-review');
      expect(staged.defaultSelected).toBe(false);
    },
  );

  it('status=cancelled (absence) is excluded and counted in a warning', () => {
    const bundle = bundleFor('cancelled');
    expect(parsedEvents(bundle)).toHaveLength(0);
    expect(parseFhirImport(bundle).warnings.length).toBeGreaterThan(0);
  });

  it('status=entered-in-error is excluded silently', () => {
    const bundle = bundleFor('entered-in-error');
    expect(parsedEvents(bundle)).toHaveLength(0);
    expect(parseFhirImport(bundle).warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Observation — value & referenceRange handling
// ---------------------------------------------------------------------------

describe('parseFhirImport — Observation value & referenceRange', () => {
  it('valueQuantity produces a Measurement {value, unit}', () => {
    const bundle = fhirBundle([
      patientResource(),
      observationResource({
        id: 'obs1',
        category: 'laboratory',
        status: 'final',
        codings: [LOINC_A1C],
        effectiveDateTime: '2021-03-01',
        valueQuantity: { value: 5.4, unit: '%' },
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged.lab).toMatchObject({ value: 5.4, unit: '%' });
    expect(staged.lab?.refLow).toBeUndefined();
    expect(staged.lab?.refHigh).toBeUndefined();
  });

  it('valueString produces narrative detail, never a numeric Measurement', () => {
    const bundle = fhirBundle([
      patientResource(),
      observationResource({
        id: 'obs1',
        category: 'laboratory',
        status: 'final',
        codings: [{ system: SYS.loinc, code: '33747-0', display: 'General appearance' }],
        effectiveDateTime: '2021-03-01',
        valueString: 'Well-appearing, no acute distress',
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged.lab).toBeUndefined();
    expect(staged.detail).toMatch(/well-appearing/i);
  });

  it('exactly one referenceRange with a matching unit is imported as refLow/refHigh, verbatim', () => {
    const bundle = fhirBundle([
      patientResource(),
      observationResource({
        id: 'obs1',
        category: 'laboratory',
        status: 'final',
        codings: [LOINC_A1C],
        effectiveDateTime: '2021-03-01',
        valueQuantity: { value: 5.4, unit: '%' },
        referenceRanges: [{ low: { value: 4, unit: '%' }, high: { value: 5.6, unit: '%' } }],
      }),
    ]);
    const lab = stagedEvents(bundle)[0].lab;
    expect(lab).toEqual({ value: 5.4, unit: '%', refLow: 4, refHigh: 5.6 });
  });

  it('never emits an in/out-of-range interpretation flag alongside a value+range', () => {
    const bundle = fhirBundle([
      patientResource(),
      observationResource({
        id: 'obs1',
        category: 'laboratory',
        status: 'final',
        codings: [LOINC_A1C],
        effectiveDateTime: '2021-03-01',
        valueQuantity: { value: 9.9, unit: '%' }, // clinically "abnormal" — must not be flagged
        referenceRanges: [{ low: { value: 4, unit: '%' }, high: { value: 5.6, unit: '%' } }],
      }),
    ]);
    const lab = stagedEvents(bundle)[0].lab;
    expect(Object.keys(lab ?? {}).sort()).toEqual(['refHigh', 'refLow', 'unit', 'value']);
  });

  it('multiple referenceRange entries are skipped entirely — no range imported, value still imported', () => {
    const bundle = fhirBundle([
      patientResource(),
      observationResource({
        id: 'obs1',
        category: 'laboratory',
        status: 'final',
        codings: [LOINC_A1C],
        effectiveDateTime: '2021-03-01',
        valueQuantity: { value: 5.4, unit: '%' },
        referenceRanges: [
          { low: { value: 4, unit: '%' }, high: { value: 5.6, unit: '%' } },
          { low: { value: 4.5, unit: '%' }, high: { value: 6, unit: '%' } },
        ],
      }),
    ]);
    const lab = stagedEvents(bundle)[0].lab;
    expect(lab).toEqual({ value: 5.4, unit: '%' });
  });

  it('a unit-mismatched referenceRange is skipped — no range imported, value still imported', () => {
    const bundle = fhirBundle([
      patientResource(),
      observationResource({
        id: 'obs1',
        category: 'laboratory',
        status: 'final',
        codings: [{ system: SYS.loinc, code: '2345-7', display: 'Glucose' }],
        effectiveDateTime: '2021-03-01',
        valueQuantity: { value: 95, unit: 'mg/dL' },
        referenceRanges: [
          { low: { value: 3.9, unit: 'mmol/L' }, high: { value: 5.6, unit: 'mmol/L' } },
        ],
      }),
    ]);
    const lab = stagedEvents(bundle)[0].lab;
    expect(lab).toEqual({ value: 95, unit: 'mg/dL' });
  });
});

// ---------------------------------------------------------------------------
// Observation/vital-signs
// ---------------------------------------------------------------------------

describe('parseFhirImport — Observation(vital-signs)', () => {
  it('classifies as a vital event with a Measurement, same status rules as laboratory', () => {
    const bundle = fhirBundle([
      patientResource(),
      observationResource({
        id: 'obs1',
        category: 'vital-signs',
        status: 'final',
        codings: [LOINC_BP],
        effectiveDateTime: '2021-03-01',
        valueQuantity: { value: 120, unit: 'mmHg' },
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged.type).toBe('vital');
    expect(staged.vital).toMatchObject({ value: 120, unit: 'mmHg' });
    expect(staged.lab).toBeUndefined();
  });

  it('an interim vital-signs status is staged needs-review, defaulted OFF', () => {
    const bundle = fhirBundle([
      patientResource(),
      observationResource({
        id: 'obs1',
        category: 'vital-signs',
        status: 'preliminary',
        codings: [LOINC_BP],
        effectiveDateTime: '2021-03-01',
        valueQuantity: { value: 120, unit: 'mmHg' },
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged.status).toBe('needs-review');
    expect(staged.defaultSelected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Observation/genomic — fact-of-test only, always needs-review
// ---------------------------------------------------------------------------

describe('parseFhirImport — Observation genomic classification & fact-of-test-only', () => {
  it('a laboratory-category Observation additionally tagged v2-0074|GE classifies as genetic', () => {
    const bundle = fhirBundle([
      patientResource(),
      observationResource({
        id: 'obs-gen',
        category: 'laboratory',
        genomicCategoryCode: 'GE',
        status: 'final',
        codings: [{ system: SYS.loinc, code: '21636-6', display: 'BRCA1 gene mutation analysis' }],
        effectiveDateTime: '2021-03-01',
        valueQuantity: { value: 1, unit: 'positive' }, // must NEVER leak through
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged.type).toBe('genetic');
  });

  it.each(GENETIC_LOINC_CODES)(
    'a plain-lab Observation tagged only by genetic LOINC %s (no v2-0074 category) still classifies as genetic',
    (loincCode) => {
      const bundle = fhirBundle([
        patientResource(),
        observationResource({
          id: 'obs-gen2',
          category: 'laboratory', // no genomicCategoryCode
          status: 'final',
          codings: [{ system: SYS.loinc, code: loincCode, display: 'Genetic test' }],
          effectiveDateTime: '2021-03-01',
        }),
      ]);
      expect(stagedEvents(bundle)[0].type).toBe('genetic');
    },
  );

  it('an ordinary laboratory Observation (non-genetic LOINC, no v2-0074 tag) classifies as lab, not genetic', () => {
    const bundle = fhirBundle([
      patientResource(),
      observationResource({
        id: 'obs-plain',
        category: 'laboratory',
        status: 'final',
        codings: [LOINC_A1C],
        effectiveDateTime: '2021-03-01',
        valueQuantity: { value: 5.4, unit: '%' },
      }),
    ]);
    expect(stagedEvents(bundle)[0].type).toBe('lab');
  });

  it('a genetic event is ALWAYS needs-review, even when Observation.status is settled (final)', () => {
    const bundle = fhirBundle([
      patientResource(),
      observationResource({
        id: 'obs-gen',
        category: 'laboratory',
        genomicCategoryCode: 'GE',
        status: 'final',
        codings: [{ system: SYS.loinc, code: '21636-6', display: 'BRCA1 gene mutation analysis' }],
        effectiveDateTime: '2021-03-01',
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged.status).toBe('needs-review');
    expect(staged.defaultSelected).toBe(false);
  });

  it('NEVER reads value[x] into the event — a genetic Observation with a definitive valueQuantity carries no Measurement anywhere', () => {
    const bundle = fhirBundle([
      patientResource(),
      observationResource({
        id: 'obs-gen',
        category: 'laboratory',
        genomicCategoryCode: 'GE',
        status: 'final',
        codings: [{ system: SYS.loinc, code: '21636-6', display: 'BRCA1 gene mutation analysis' }],
        effectiveDateTime: '2021-03-01',
        valueQuantity: { value: 1, unit: 'positive' },
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged.lab).toBeUndefined();
    expect(staged.vital).toBeUndefined();
    // The title/detail come from Observation.code, not the value.
    expect(staged.title).toMatch(/brca1/i);
    expect(JSON.stringify(staged)).not.toMatch(/positive/);
  });

  it('a genomic Observation with no effectiveDateTime (period/issued only) is dropped and counted — genomic date source is effectiveDateTime only', () => {
    const bundle = fhirBundle([
      patientResource(),
      observationResource({
        id: 'obs-gen',
        category: 'laboratory',
        genomicCategoryCode: 'GE',
        status: 'final',
        codings: [{ system: SYS.loinc, code: '21636-6', display: 'BRCA1 gene mutation analysis' }],
        effectivePeriodStart: '2021-03-01',
      }),
    ]);
    expect(parsedEvents(bundle)).toHaveLength(0);
    expect(parseFhirImport(bundle).warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Immunization
// ---------------------------------------------------------------------------

describe('parseFhirImport — Immunization', () => {
  it('status=completed (settled) is staged new, defaulted ON', () => {
    const bundle = fhirBundle([
      patientResource(),
      immunizationResource({
        id: 'imm1',
        status: 'completed',
        occurrenceDateTime: '2022-10-15',
        vaccineCodings: [CVX_FLU],
        doseNumber: 1,
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged).toMatchObject({ type: 'immunization', status: 'new', defaultSelected: true });
    expect(staged.immunization).toMatchObject({ vaccine: expect.stringMatching(/influenza/i) });
  });

  it('status=not-done (absence) is excluded and counted in a warning, never staged', () => {
    const bundle = fhirBundle([
      patientResource(),
      immunizationResource({ id: 'imm1', status: 'not-done', vaccineCodings: [CVX_FLU] }),
    ]);
    expect(parsedEvents(bundle)).toHaveLength(0);
    expect(parseFhirImport(bundle).warnings.length).toBeGreaterThan(0);
  });

  it('status=entered-in-error is excluded silently', () => {
    const bundle = fhirBundle([
      patientResource(),
      immunizationResource({
        id: 'imm1',
        status: 'entered-in-error',
        occurrenceDateTime: '2022-10-15',
        vaccineCodings: [CVX_FLU],
      }),
    ]);
    expect(parsedEvents(bundle)).toHaveLength(0);
    expect(parseFhirImport(bundle).warnings).toHaveLength(0);
  });

  it('doseLabel comes from protocolApplied[].doseNumber', () => {
    const bundle = fhirBundle([
      patientResource(),
      immunizationResource({
        id: 'imm1',
        status: 'completed',
        occurrenceDateTime: '2022-10-15',
        vaccineCodings: [CVX_FLU],
        doseNumber: 2,
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged.immunization?.doseLabel).toMatch(/2/);
  });
});

// ---------------------------------------------------------------------------
// AllergyIntolerance — verificationStatus disposition (two-axis: clinicalStatus never excludes)
// ---------------------------------------------------------------------------

describe('parseFhirImport — AllergyIntolerance.verificationStatus disposition', () => {
  function bundleFor(opts: {
    verificationStatus?: 'confirmed' | 'unconfirmed' | 'refuted' | 'entered-in-error';
    omitVerificationStatus?: boolean;
    clinicalStatus?: 'active' | 'inactive' | 'resolved';
  }) {
    return fhirBundle([
      patientResource(),
      allergyIntoleranceResource({
        id: 'al1',
        codings: [SNOMED_PEANUT],
        onsetDateTime: '2010-06-01',
        reactions: [{ manifestationText: 'Hives', severity: 'moderate' }],
        ...opts,
      }),
    ]);
  }

  it('verificationStatus=confirmed is staged as a new, defaulted-ON allergy event', () => {
    const staged = stagedEvents(bundleFor({ verificationStatus: 'confirmed' }))[0];
    expect(staged).toMatchObject({ type: 'allergy', status: 'new', defaultSelected: true });
  });

  it('verificationStatus=unconfirmed is staged needs-review, defaulted OFF', () => {
    const staged = stagedEvents(bundleFor({ verificationStatus: 'unconfirmed' }))[0];
    expect(staged.status).toBe('needs-review');
    expect(staged.defaultSelected).toBe(false);
  });

  it('a missing verificationStatus is treated as interim (needs-review), never assumed confirmed', () => {
    const staged = stagedEvents(bundleFor({ omitVerificationStatus: true }))[0];
    expect(staged.status).toBe('needs-review');
    expect(staged.defaultSelected).toBe(false);
  });

  it('verificationStatus=refuted is excluded and counted in a warning, never a positive event', () => {
    const bundle = bundleFor({ verificationStatus: 'refuted' });
    expect(parsedEvents(bundle)).toHaveLength(0);
    expect(parseFhirImport(bundle).warnings.length).toBeGreaterThan(0);
  });

  it('verificationStatus=entered-in-error is excluded silently', () => {
    const bundle = bundleFor({ verificationStatus: 'entered-in-error' });
    expect(parsedEvents(bundle)).toHaveLength(0);
    expect(parseFhirImport(bundle).warnings).toHaveLength(0);
  });

  it.each(['active', 'inactive', 'resolved'] as const)(
    'clinicalStatus=%s NEVER excludes a confirmed allergy (parity with Condition.clinicalStatus)',
    (clinicalStatus) => {
      const staged = stagedEvents(
        bundleFor({ verificationStatus: 'confirmed', clinicalStatus }),
      )[0];
      expect(staged.status).toBe('new');
      expect(staged.defaultSelected).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// AllergyIntolerance — payload (substance/reaction/severity) + onset order
// ---------------------------------------------------------------------------

describe('parseFhirImport — AllergyIntolerance payload', () => {
  it('substance comes from code, reaction from reaction[].manifestation', () => {
    const bundle = fhirBundle([
      patientResource(),
      allergyIntoleranceResource({
        id: 'al1',
        codings: [SNOMED_PEANUT],
        onsetDateTime: '2010-06-01',
        reactions: [{ manifestationText: 'Anaphylaxis', severity: 'severe' }],
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged.allergy?.substance).toMatch(/peanut/i);
    expect(staged.allergy?.reaction).toMatch(/anaphylaxis/i);
  });

  it('severity comes from reaction[].severity, NEVER from AllergyIntolerance.criticality', () => {
    const bundle = fhirBundle([
      patientResource(),
      allergyIntoleranceResource({
        id: 'al1',
        codings: [SNOMED_PEANUT],
        onsetDateTime: '2010-06-01',
        criticality: 'low', // deliberately a DIFFERENT bucket than reaction severity
        reactions: [{ manifestationText: 'Hives', severity: 'severe' }],
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged.allergy?.severity).toBe('severe');
  });

  it('onset order: onsetDateTime is used when present', () => {
    const bundle = fhirBundle([
      patientResource({ birthDate: '1988-01-01' }),
      allergyIntoleranceResource({
        id: 'al1',
        codings: [SNOMED_PEANUT],
        onsetDateTime: '2010-06-01',
        onsetPeriodStart: '2005-01-01', // must be ignored — onsetDateTime wins
        recordedDate: '2020-01-01',
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged.year).toBe(2010);
    expect(staged.date).toBe('2010-06-01');
  });

  it('onset order: falls back to onsetPeriod.start when onsetDateTime is absent', () => {
    const bundle = fhirBundle([
      patientResource({ birthDate: '1988-01-01' }),
      allergyIntoleranceResource({
        id: 'al1',
        codings: [SNOMED_PEANUT],
        onsetPeriodStart: '2005-01-01',
        recordedDate: '2020-01-01',
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged.year).toBe(2005);
  });

  it('onset order: falls back to onsetAge (resolved via Patient.birthDate) when neither date is present', () => {
    const bundle = fhirBundle([
      patientResource({ birthDate: '1988-01-01' }),
      allergyIntoleranceResource({
        id: 'al1',
        codings: [SNOMED_PEANUT],
        onsetAgeYears: 22,
        recordedDate: '2020-01-01',
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged.year).toBe(2010); // 1988 + 22
  });

  it('recordedDate is NEVER used as onset — a resource with only recordedDate is dropped and counted', () => {
    const bundle = fhirBundle([
      patientResource({ birthDate: '1988-01-01' }),
      allergyIntoleranceResource({
        id: 'al1',
        codings: [SNOMED_PEANUT],
        recordedDate: '2020-01-01', // the ONLY date-shaped field present
      }),
    ]);
    expect(parsedEvents(bundle)).toHaveLength(0);
    expect(parseFhirImport(bundle).warnings.length).toBeGreaterThan(0);
  });

  it('onsetString is not parsed into a date — resource is dropped (no other onset field present)', () => {
    const bundle = fhirBundle([
      patientResource({ birthDate: '1988-01-01' }),
      allergyIntoleranceResource({
        id: 'al1',
        codings: [SNOMED_PEANUT],
        onsetString: 'childhood',
      }),
    ]);
    expect(parsedEvents(bundle)).toHaveLength(0);
  });

  it('onsetAge with no resolvable Patient.birthDate is dropped and counted (never a fabricated year)', () => {
    const bundle = fhirBundle([
      patientResource(), // no birthDate
      allergyIntoleranceResource({
        id: 'al1',
        codings: [SNOMED_PEANUT],
        onsetAgeYears: 22,
      }),
    ]);
    expect(parsedEvents(bundle)).toHaveLength(0);
    expect(parseFhirImport(bundle).warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Procedure
// ---------------------------------------------------------------------------

describe('parseFhirImport — Procedure.status disposition + codings', () => {
  function bundleFor(status: string) {
    return fhirBundle([
      patientResource(),
      procedureResource({
        id: 'proc1',
        status,
        performedDateTime: '2018-09-01',
        codings: [SNOMED_APPENDECTOMY],
      }),
    ]);
  }

  it.each(['completed', 'stopped'] as const)(
    'status=%s (settled) is staged new, defaulted ON',
    (status) => {
      const staged = stagedEvents(bundleFor(status))[0];
      expect(staged).toMatchObject({ type: 'procedure', status: 'new', defaultSelected: true });
    },
  );

  it.each(['preparation', 'in-progress', 'on-hold', 'unknown'] as const)(
    'status=%s (interim) is staged needs-review, defaulted OFF',
    (status) => {
      const staged = stagedEvents(bundleFor(status))[0];
      expect(staged.status).toBe('needs-review');
      expect(staged.defaultSelected).toBe(false);
    },
  );

  it('status=not-done (absence) is excluded and counted in a warning', () => {
    const bundle = bundleFor('not-done');
    expect(parsedEvents(bundle)).toHaveLength(0);
    expect(parseFhirImport(bundle).warnings.length).toBeGreaterThan(0);
  });

  it('status=entered-in-error is excluded silently', () => {
    const bundle = bundleFor('entered-in-error');
    expect(parsedEvents(bundle)).toHaveLength(0);
    expect(parseFhirImport(bundle).warnings).toHaveLength(0);
  });

  it('a SNOMED-coded procedure lands its code in coding[]', () => {
    const staged = stagedEvents(bundleFor('completed'))[0];
    expect(staged.coding).toEqual([SNOMED_APPENDECTOMY]);
  });

  it('a CPT-only procedure excludes the code from coding[]; display routes to narrative', () => {
    const bundle = fhirBundle([
      patientResource(),
      procedureResource({
        id: 'proc1',
        status: 'completed',
        performedDateTime: '2018-09-01',
        codings: [{ system: SYS.cpt, code: '44950', display: 'Appendectomy (CPT)' }],
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged.coding).toEqual([]);
    expect(`${staged.title} ${staged.detail}`).toMatch(/appendectomy \(cpt\)/i);
  });
});

// ---------------------------------------------------------------------------
// Encounter — always needs-review
// ---------------------------------------------------------------------------

describe('parseFhirImport — Encounter, always needs-review regardless of status', () => {
  it.each(['finished', 'in-progress', 'planned', 'unknown'] as const)(
    'status=%s is staged as a visit, ALWAYS needs-review (default-OFF), never defaulted ON',
    (status) => {
      const bundle = fhirBundle([
        patientResource(),
        encounterResource({
          id: 'enc1',
          status,
          periodStart: '2019-11-01',
          classCode: 'AMB',
          classDisplay: 'ambulatory',
        }),
      ]);
      const staged = stagedEvents(bundle)[0];
      expect(staged.type).toBe('visit');
      expect(staged.status).toBe('needs-review');
      expect(staged.defaultSelected).toBe(false);
    },
  );

  it('status=cancelled (absence) is excluded and counted in a warning', () => {
    const bundle = fhirBundle([
      patientResource(),
      encounterResource({ id: 'enc1', status: 'cancelled', periodStart: '2019-11-01' }),
    ]);
    expect(parsedEvents(bundle)).toHaveLength(0);
    expect(parseFhirImport(bundle).warnings.length).toBeGreaterThan(0);
  });

  it('status=entered-in-error is excluded silently', () => {
    const bundle = fhirBundle([
      patientResource(),
      encounterResource({ id: 'enc1', status: 'entered-in-error', periodStart: '2019-11-01' }),
    ]);
    expect(parsedEvents(bundle)).toHaveLength(0);
    expect(parseFhirImport(bundle).warnings).toHaveLength(0);
  });

  it('title comes from type/class when present', () => {
    const bundle = fhirBundle([
      patientResource(),
      encounterResource({
        id: 'enc1',
        status: 'finished',
        periodStart: '2019-11-01',
        typeText: 'Annual physical',
      }),
    ]);
    expect(stagedEvents(bundle)[0].title).toMatch(/annual physical/i);
  });
});

// ---------------------------------------------------------------------------
// No-date resources are dropped + counted, across resource types
// ---------------------------------------------------------------------------

describe('parseFhirImport — explicit-date-only: a resource with no usable date is dropped + counted', () => {
  it('an Observation/laboratory with no effectiveDateTime/effectivePeriod/issued is dropped', () => {
    const bundle = fhirBundle([
      patientResource(),
      observationResource({
        id: 'obs1',
        category: 'laboratory',
        status: 'final',
        codings: [LOINC_A1C],
        valueQuantity: { value: 5.4, unit: '%' },
      }),
    ]);
    expect(parsedEvents(bundle)).toHaveLength(0);
    expect(parseFhirImport(bundle).warnings.length).toBeGreaterThan(0);
  });

  it('a Procedure with no performedDateTime/performedPeriod is dropped', () => {
    const bundle = fhirBundle([
      patientResource(),
      procedureResource({ id: 'proc1', status: 'completed', codings: [SNOMED_APPENDECTOMY] }),
    ]);
    expect(parsedEvents(bundle)).toHaveLength(0);
  });

  it('an Encounter with no period.start is dropped', () => {
    const bundle = fhirBundle([
      patientResource(),
      encounterResource({ id: 'enc1', status: 'finished' }),
    ]);
    expect(parsedEvents(bundle)).toHaveLength(0);
  });

  it('an Immunization with no occurrenceDateTime is dropped', () => {
    const bundle = fhirBundle([
      patientResource(),
      immunizationResource({ id: 'imm1', status: 'completed', vaccineCodings: [CVX_FLU] }),
    ]);
    expect(parsedEvents(bundle)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Date precision preservation
// ---------------------------------------------------------------------------

describe('parseFhirImport — event date precision is preserved exactly (year always matches date)', () => {
  it.each([
    ['2020', 2020, '2020'],
    ['2020-06', 2020, '2020-06'],
    ['2020-06-15T10:30:00Z', 2020, '2020-06-15'],
  ] as const)('effectiveDateTime=%s -> year=%d, date=%s', (raw, year, date) => {
    const bundle = fhirBundle([
      patientResource(),
      observationResource({
        id: 'obs1',
        category: 'laboratory',
        status: 'final',
        codings: [LOINC_A1C],
        effectiveDateTime: raw,
        valueQuantity: { value: 5.4, unit: '%' },
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged.year).toBe(year);
    expect(staged.date).toBe(date);
  });

  it("every staged event's date, when present, has a year component equal to its year field", () => {
    const bundle = fhirBundle([
      patientResource({ birthDate: '1988-01-01' }),
      medicationStatementResource({
        id: 'ms1',
        status: 'active',
        medicationCodings: [RXNORM_METFORMIN],
        effectiveDateTime: '2020-06-15',
      }),
      immunizationResource({
        id: 'imm1',
        status: 'completed',
        occurrenceDateTime: '2019',
        vaccineCodings: [CVX_FLU],
      }),
    ]);
    for (const ev of stagedEvents(bundle)) {
      if (ev.date) expect(ev.date.slice(0, 4)).toBe(String(ev.year));
    }
  });
});

// ---------------------------------------------------------------------------
// Codings — verified-only systems land in coding[]
// ---------------------------------------------------------------------------

describe('parseFhirImport — event codings: only verified systems land in coding[]', () => {
  it.each([
    ['RxNorm', RXNORM_METFORMIN],
    ['LOINC', LOINC_A1C],
    ['SNOMED', SNOMED_APPENDECTOMY],
  ] as const)('%s codings are preserved verbatim in coding[]', (_label, coding) => {
    const bundle = fhirBundle([
      patientResource(),
      medicationStatementResource({
        id: 'ms1',
        status: 'active',
        medicationCodings: [coding],
        effectiveDateTime: '2020-01-01',
      }),
    ]);
    expect(stagedEvents(bundle)[0].coding).toEqual([coding]);
  });

  it('a CVX-coded Immunization preserves its coding verbatim', () => {
    const bundle = fhirBundle([
      patientResource(),
      immunizationResource({
        id: 'imm1',
        status: 'completed',
        occurrenceDateTime: '2022-10-15',
        vaccineCodings: [CVX_FLU],
      }),
    ]);
    expect(stagedEvents(bundle)[0].coding).toEqual([CVX_FLU]);
  });

  it.each([
    ['HCPCS', { system: SYS.hcpcs, code: 'J1100', display: 'Injection, dexamethasone' }],
    ['NDC', { system: SYS.ndc, code: '0069-3150-83', display: 'Some drug product' }],
  ] as const)(
    '%s codings are excluded from coding[]; display routes to narrative',
    (_label, coding) => {
      const bundle = fhirBundle([
        patientResource(),
        medicationStatementResource({
          id: 'ms1',
          status: 'active',
          medicationCodings: [coding],
          effectiveDateTime: '2020-01-01',
        }),
      ]);
      const staged = stagedEvents(bundle)[0];
      expect(staged.coding).toEqual([]);
      expect(`${staged.title} ${staged.detail}`).toMatch(new RegExp(coding.display!, 'i'));
    },
  );

  it('an unrecognized/proprietary system is excluded from coding[]; display routes to narrative', () => {
    const bundle = fhirBundle([
      patientResource(),
      procedureResource({
        id: 'proc1',
        status: 'completed',
        performedDateTime: '2018-09-01',
        codings: [{ system: SYS.proprietary, code: 'LOCAL-1', display: 'Local vendor procedure' }],
      }),
    ]);
    const staged = stagedEvents(bundle)[0];
    expect(staged.coding).toEqual([]);
    expect(`${staged.title} ${staged.detail}`).toMatch(/local vendor procedure/i);
  });
});

// ---------------------------------------------------------------------------
// Combined pipeline — events flow into staged + applied timeline
// ---------------------------------------------------------------------------

describe('parseFhirImport → stageHealthRecordImport → applyHealthRecordImport — events', () => {
  it('a mixed bundle (settled + interim + absence + eie across several resource types) applies exactly the expected events', () => {
    const bundle = fhirBundle([
      patientResource({ birthDate: '1988-01-01' }),
      medicationStatementResource({
        id: 'ms1',
        status: 'active',
        medicationCodings: [RXNORM_METFORMIN],
        effectiveDateTime: '2020-01-01',
      }),
      medicationStatementResource({
        id: 'ms-absent',
        status: 'not-taken',
        medicationCodings: [RXNORM_METFORMIN],
        effectiveDateTime: '2020-01-01',
      }),
      observationResource({
        id: 'obs1',
        category: 'laboratory',
        status: 'preliminary', // interim -> needs-review, defaulted off
        codings: [LOINC_A1C],
        effectiveDateTime: '2021-03-01',
        valueQuantity: { value: 5.4, unit: '%' },
      }),
      immunizationResource({
        id: 'imm-eie',
        status: 'entered-in-error',
        occurrenceDateTime: '2022-01-01',
        vaccineCodings: [CVX_FLU],
      }),
      encounterResource({ id: 'enc1', status: 'finished', periodStart: '2019-11-01' }),
    ]);
    const record = emptyRecord();
    const parsed = parseFhirImport(bundle);
    // absence + eie never reach the parsed events list at all.
    expect(parsed.proband.events).toHaveLength(3); // ms1, obs1, enc1

    const staged = stageHealthRecordImport(parsed, record, catalog);
    const selectedIds = staged.events.map((e) => e.parseId); // select everything staged
    const { record: applied } = applyHealthRecordImport(
      record,
      staged,
      { selectedParseIds: new Set(selectedIds) },
      catalog,
    );
    expect(isValidRecord(applied)).toBe(true);
    // Every applied event belongs to the proband and is attributed to the record.
    const applied3 = applied.timeline.filter((e) => e.person === record.probandId);
    expect(applied3).toHaveLength(3);
    expect(applied3.every((e) => e.prov === 'record')).toBe(true);
    expect(applied3.some((e) => e.type === 'medication')).toBe(true);
    expect(applied3.some((e) => e.type === 'lab')).toBe(true);
    expect(applied3.some((e) => e.type === 'visit')).toBe(true);
  });
});
