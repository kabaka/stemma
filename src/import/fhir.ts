/**
 * FHIR R4 → {@link ParsedHealthRecord} mapper — the **pure** parse stage of the SMART-on-FHIR
 * import, the transport-free counterpart to {@link parseCcda}. It reads a `Bundle` (the Patient
 * read + the `Condition` / `FamilyMemberHistory` searchsets the gateway assembled) into the same
 * source-agnostic parsed shape the reconciliation engine ({@link stageHealthRecordImport} /
 * {@link applyHealthRecordImport}) consumes, so the pipeline is
 * `parseFhirImport → stageHealthRecordImport → (review) → applyHealthRecordImport → replaceRecord`.
 *
 * Clinical-safety commitments (guardrail #1, carried from DR-0016 and honoured identically to the
 * C-CDA importer):
 * - Never manufacture a code, an onset, or a risk number. `onsetYear` is an age at onset in whole
 *   years or `null` — never defaulted to 0, never fabricated from a range/string.
 * - `Condition.verificationStatus` gates disposition: `confirmed` coded facts are staged positive;
 *   `unconfirmed`/`provisional`/`differential`/(missing) are surfaced needs-review and defaulted
 *   OFF (never pre-selected, even with a resolvable code); `refuted` and `entered-in-error` are
 *   excluded — refuted is counted as "ruled out", entered-in-error is dropped silently.
 * - `Condition.clinicalStatus` NEVER excludes or hides a condition (active…resolved all include).
 * - A coded "no known history" absence assertion is never turned into a positive condition.
 * - `FamilyMemberHistory.status`/`dataAbsentReason` are honoured: an unknown/absent history yields
 *   a relative with NO conditions and is never asserted healthy; `entered-in-error` drops the whole
 *   relative; `subject-unknown` forces manual placement.
 * - Sex assigned at birth (guardrail #4) comes from `FamilyMemberHistory.sex` (falling back to a
 *   sex-SPECIFIC relationship code only), never from a gender/identity field, and drives geometry —
 *   never screening. Non-genetic / ambiguous relationships are never auto-attached to parentage.
 * - The proband `Patient` resource is read ONLY for identity + `birthDate` (for onset age math);
 *   this parser never writes the proband's own demographics (parity with the C-CDA importer, which
 *   imports the proband's problems onto their existing record node — see DR-0020 handoff).
 *
 * Purity & layering: no network, no clock, no randomness — onset age math uses the bundle's own
 * `Patient.birthDate`, not the wall clock. This module lives in `src/import/` and imports ONLY from
 * `@/domain`, `@/data`, and the sibling `health-record` engine — never `store`, `ui`,
 * `integrations`, or `export`.
 */
import type { Sab } from '@/domain/types';
import type { ProblemEntry, RelativeEntry, ParsedHealthRecord } from './health-record';
import {
  ABSENCE_SNOMED,
  CODE_SAB,
  RELATIONSHIP_LABELS,
  ageToYears,
  yearFromTs,
} from './health-record';

/** The minimal Bundle shape this parser consumes — mirrors the gateway's `FhirImportBundle`. */
export interface FhirImportBundle {
  resourceType: 'Bundle';
  entry?: { resource?: unknown }[];
}

/** Options for {@link parseFhirImport}: the proband's `Patient.id`, else the sole Patient is used. */
export interface ParseFhirOptions {
  patientId?: string;
}

// ---------------------------------------------------------------------------
// System URIs (the real ones a conformant SMART server emits — never invented).
// ---------------------------------------------------------------------------

const SYS_SNOMED = 'http://snomed.info/sct';
const SYS_ICD10CM = 'http://hl7.org/fhir/sid/icd-10-cm';
const SYS_V3_ROLECODE = 'http://terminology.hl7.org/CodeSystem/v3-RoleCode';

/** FHIR twin RoleCodes → the generic full-sibling code the placement engine recognizes (a twin is
 * a full sibling for pedigree geometry). Fraternal (`F…`) and identical (`I…`) both map through. */
const TWIN_TO_SIBLING: Record<string, string> = {
  FTWINBRO: 'TWINBRO',
  FTWINSIS: 'TWINSIS',
  ITWINBRO: 'TWINBRO',
  ITWINSIS: 'TWINSIS',
};

// ---------------------------------------------------------------------------
// Tiny structural accessors over untrusted JSON.
// ---------------------------------------------------------------------------

function asObj(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

interface FhirCoding {
  system?: string;
  code?: string;
  display?: string;
}

/** The `coding[]` of a CodeableConcept, as plain `{system, code, display}` entries. */
function codingsOf(cc: Record<string, unknown> | undefined): FhirCoding[] {
  if (!cc || !Array.isArray(cc.coding)) return [];
  return cc.coding
    .filter((c): c is Record<string, unknown> => asObj(c) != null)
    .map((c) => ({
      system: str(c.system),
      code: str(c.code),
      display: str(c.display),
    }));
}

type SystemLabel = 'ICD-10-CM' | 'SNOMED-CT' | null;

/** Map a coding system URI to the canonical catalog label; anything else (ICD-9-CM, proprietary)
 * is unrecognized → `null` (surfaced narrative-only, never crosswalked). */
function systemLabel(system: string | undefined): SystemLabel {
  if (system === SYS_ICD10CM) return 'ICD-10-CM';
  if (system === SYS_SNOMED) return 'SNOMED-CT';
  return null;
}

/**
 * Resolve a CodeableConcept's coded diagnosis, mirroring `ccda.ts`'s `extractCoded` priority:
 * collect every coding, prefer an ICD-10-CM coding, then SNOMED-CT; ICD-9-CM / proprietary / uncoded
 * yield `system: null` (surfaced verbatim, not crosswalked). `displayName` comes from the chosen
 * coding's `display`, then `code.text`, then the code itself; for the narrative fallback, `code.text`
 * then any coding's `display`/`code`.
 */
function extractCoded(cc: Record<string, unknown> | undefined): ProblemEntry['coded'] {
  const codings = codingsOf(cc);
  const text = str(cc?.text);
  const pairs = codings.map((c) => ({
    label: systemLabel(c.system),
    code: c.code,
    display: c.display,
  }));

  const chosen =
    pairs.find((p) => p.label === 'ICD-10-CM' && p.code) ??
    pairs.find((p) => p.label === 'SNOMED-CT' && p.code);
  if (chosen && chosen.code) {
    const displayName = chosen.display?.trim() || text?.trim() || chosen.code;
    return { system: chosen.label, code: chosen.code, displayName };
  }

  const firstDisplay = codings.find((c) => c.display)?.display;
  const firstCode = codings.find((c) => c.code)?.code;
  const displayName = text?.trim() || firstDisplay?.trim() || firstCode?.trim() || '';
  return { system: null, code: null, displayName };
}

/** Whether a CodeableConcept asserts an absence ("no known history of X") — any coding whose code
 * is a known absence SNOMED concept (guardrail #1: never a positive condition). */
function assertsAbsence(cc: Record<string, unknown> | undefined): boolean {
  return codingsOf(cc).some((c) => c.code != null && ABSENCE_SNOMED.has(c.code));
}

/** The `Condition.verificationStatus` code, or `undefined` when the server never populated it. */
function verificationStatusOf(resource: Record<string, unknown>): string | undefined {
  const codes = codingsOf(asObj(resource.verificationStatus));
  return codes[0]?.code;
}

/** Whole-year age from an `Age` datatype (`{value, unit}`), or `null` — used directly, never invented. */
function ageFromOnsetAge(onset: unknown): number | null {
  const age = asObj(onset);
  if (!age) return null;
  const value =
    typeof age.value === 'number'
      ? String(age.value)
      : typeof age.value === 'string'
        ? age.value
        : null;
  if (value === null) return null;
  return ageToYears(value, typeof age.unit === 'string' ? age.unit : 'a');
}

/**
 * Proband age at onset (explicit-presence-only, guardrail #1): `onsetAge` used directly;
 * `onsetDateTime` / `onsetPeriod.start` → onset year − birth year, ONLY when both are present and
 * the result is ≥ 0; `onsetString` / `onsetRange` → `null` (never a fabricated point onset).
 */
function probandOnset(resource: Record<string, unknown>, birthYear: number | null): number | null {
  const fromAge = ageFromOnsetAge(resource.onsetAge);
  if (fromAge != null || resource.onsetAge != null) return fromAge;

  const onsetDate = str(resource.onsetDateTime) ?? str(asObj(resource.onsetPeriod)?.start);
  if (onsetDate) {
    const onsetYear = yearFromTs(onsetDate);
    if (onsetYear == null || birthYear == null) return null;
    const age = onsetYear - birthYear;
    return age >= 0 ? age : null;
  }
  // onsetString / onsetRange — never fabricated into a point onset.
  return null;
}

// ---------------------------------------------------------------------------
// parseFhirImport
// ---------------------------------------------------------------------------

/**
 * Parse a FHIR `Bundle` into its structural {@link ParsedHealthRecord}. Pure, deterministic, and
 * total — a missing Patient, an empty bundle, or hostile shapes never throw; they yield an
 * empty-but-valid result plus warnings.
 */
export function parseFhirImport(
  bundle: FhirImportBundle,
  opts: ParseFhirOptions = {},
): ParsedHealthRecord {
  const warnings: string[] = [];
  const resources: Record<string, unknown>[] = [];
  for (const entry of bundle?.entry ?? []) {
    const resource = asObj(entry?.resource);
    if (resource) resources.push(resource);
  }

  const byType = (type: string): Record<string, unknown>[] =>
    resources.filter((r) => r.resourceType === type);

  // --- Proband identity: Patient read ONLY for identity + birthDate (never demographics) ---
  const patients = byType('Patient');
  const patient = opts.patientId ? patients.find((p) => str(p.id) === opts.patientId) : patients[0];
  const probandBirthYear =
    patient && str(patient.birthDate) ? yearFromTs(str(patient.birthDate)!) : null;

  // --- Condition → proband problems ---
  let refutedCount = 0;
  let absenceCount = 0;
  let partialSeen = false;

  const probandProblems: ProblemEntry[] = [];
  let probIndex = 0;
  for (const resource of byType('Condition')) {
    const verStatus = verificationStatusOf(resource);
    if (verStatus === 'entered-in-error') continue; // excluded entirely, never counted or surfaced
    const cc = asObj(resource.code);
    if (assertsAbsence(cc)) {
      absenceCount++;
      continue;
    }
    if (verStatus === 'refuted') {
      refutedCount++;
      continue;
    }
    const raw = extractCoded(cc);
    if (raw.system === null && !raw.displayName) continue; // nothing to show

    // Only a `confirmed` condition passes its code through to the positive/duplicate gate; every
    // non-confirmed (incl. missing) status is surfaced narrative-only so staging defaults it OFF,
    // needs-review — never pre-selected despite a resolvable code (guardrail #1).
    const coded: ProblemEntry['coded'] =
      verStatus === 'confirmed' ? raw : { system: null, code: null, displayName: raw.displayName };

    probandProblems.push({
      parseId: `fhir-prob-${probIndex++}`,
      coded,
      onsetYear: probandOnset(resource, probandBirthYear),
    });
  }

  // --- FamilyMemberHistory → relatives + their conditions ---
  const familyMembers: RelativeEntry[] = [];
  let fhIndex = 0;
  for (const resource of byType('FamilyMemberHistory')) {
    const status = str(resource.status);
    if (status === 'entered-in-error') continue; // drop the whole relative instance
    if (status === 'partial') partialSeen = true;

    const parseId = `fhir-fmh-${fhIndex++}`;
    const { code: relationshipCode, display: relationshipDisplay } = parseRelationship(resource);

    // dataAbsentReason: any → unknown history (no fabricated conditions). `subject-unknown`
    // additionally forces manual placement (never auto-attached to genetic parentage).
    const dataAbsentReason = parseDataAbsentReason(resource);
    const forceAmbiguous = dataAbsentReason === 'subject-unknown';
    // `health-unknown` and any dataAbsentReason: create the relative (geometry) with NO conditions,
    // never asserted healthy.
    const suppressConditions = status === 'health-unknown' || dataAbsentReason != null;

    const effectiveCode = forceAmbiguous ? '' : relationshipCode;
    const sab = parseSab(resource, effectiveCode);

    const problems: ProblemEntry[] = [];
    if (!suppressConditions) {
      const condList = Array.isArray(resource.condition) ? resource.condition : [];
      let pk = 0;
      for (const raw of condList) {
        const cond = asObj(raw);
        if (!cond) continue;
        const cc = asObj(cond.code);
        if (assertsAbsence(cc)) {
          absenceCount++;
          continue;
        }
        const coded = extractCoded(cc);
        if (coded.system === null && !coded.displayName) continue;
        problems.push({
          parseId: `${parseId}-prob-${pk++}`,
          coded,
          // `contributedToDeath` is an annotation on an already-gated condition — never read here
          // (it changes no disposition). FMH condition onset is explicit-presence-only.
          onsetYear: ageFromOnsetAge(cond.onsetAge),
        });
      }
    }

    familyMembers.push({
      parseId,
      name: str(resource.name) ?? null,
      sab,
      relationshipCode: effectiveCode,
      relationshipDisplay,
      birthYear: str(resource.bornDate) ? yearFromTs(str(resource.bornDate)!) : null,
      death: parseDeath(resource),
      problems,
    });
  }

  if (refutedCount) {
    warnings.push(
      `${refutedCount} ${refutedCount === 1 ? 'condition was' : 'conditions were'} not imported because ${
        refutedCount === 1 ? 'it was' : 'they were'
      } recorded as ruled out (refuted).`,
    );
  }
  if (absenceCount) {
    warnings.push(
      `${absenceCount} "no known history" ${
        absenceCount === 1 ? 'entry was' : 'entries were'
      } not imported as a condition.`,
    );
  }
  if (partialSeen) {
    warnings.push(
      'A family history may be incomplete (it was recorded as "partial"); some conditions may not be listed.',
    );
  }

  return { proband: { problems: probandProblems }, familyMembers, warnings };
}

// ---------------------------------------------------------------------------
// FamilyMemberHistory field parsers
// ---------------------------------------------------------------------------

/**
 * Resolve the relationship into an effective RoleCode (for the placement engine) + a display label.
 * Auto-placement is possible ONLY for a `v3-RoleCode` coding (twin codes normalized to full
 * siblings); a non-RoleCode system, a `.text`-only relationship, or an absent relationship yields
 * an empty effective code → the engine surfaces it ambiguous, never auto-attaching to parentage.
 */
function parseRelationship(resource: Record<string, unknown>): { code: string; display: string } {
  const rel = asObj(resource.relationship);
  if (!rel) return { code: '', display: 'Relative' };

  const first = codingsOf(rel)[0];
  const text = str(rel.text);
  let code = '';
  let display = '';

  if (first) {
    const rawCode = first.code ? first.code.toUpperCase() : '';
    display = first.display?.trim() || RELATIONSHIP_LABELS[rawCode] || rawCode || '';
    if (first.system === SYS_V3_ROLECODE && rawCode) {
      code = TWIN_TO_SIBLING[rawCode] ?? rawCode;
    }
  } else if (text) {
    display = text;
  }

  if (!display) display = text ?? 'Relative';
  return { code, display };
}

/**
 * Sex assigned at birth (guardrail #4): from `FamilyMemberHistory.sex` (administrative-gender),
 * falling back to a sex-SPECIFIC relationship code ONLY when `sex.coding` is absent; a sex-neutral
 * code never infers sab. Never keyed off gender/identity.
 */
function parseSab(resource: Record<string, unknown>, relationshipCode: string): Sab {
  const sexCode = codingsOf(asObj(resource.sex))[0]?.code;
  if (sexCode === 'male') return 'm';
  if (sexCode === 'female') return 'f';
  if (sexCode === 'other') return 'x';
  if (sexCode === 'unknown') return 'u';
  // sex.coding absent → sex-specific relationship fallback only (never a neutral role).
  return CODE_SAB[relationshipCode] ?? 'u';
}

/** The `dataAbsentReason` code (e.g. `subject-unknown`), or `null` when the field is absent. */
function parseDataAbsentReason(resource: Record<string, unknown>): string | null {
  const dar = asObj(resource.dataAbsentReason);
  if (!dar) return null;
  return codingsOf(dar)[0]?.code ?? 'unknown';
}

/**
 * Deceased status (explicit-presence-only, guardrail #1; death is never inferred):
 * `deceasedBoolean` → dead/alive with no year; `deceasedDate` → dead + that year; `deceasedAge` →
 * dead with no calendar year; absent → unknown (`dead: null`).
 */
function parseDeath(resource: Record<string, unknown>): {
  year: number | null;
  dead: boolean | null;
} {
  if (typeof resource.deceasedBoolean === 'boolean') {
    return { year: null, dead: resource.deceasedBoolean };
  }
  const deceasedDate = str(resource.deceasedDate);
  if (deceasedDate) {
    return { year: yearFromTs(deceasedDate), dead: true };
  }
  if (resource.deceasedAge != null) {
    return { year: null, dead: true };
  }
  return { year: null, dead: null };
}
