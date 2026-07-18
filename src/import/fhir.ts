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
import type {
  AllergyInfo,
  Coding,
  ImmunizationInfo,
  Measurement,
  MedicationInfo,
  PartialDate,
  Sab,
} from '@/domain/types';
import { isPartialDate, yearOfPartialDate } from '@/domain/dates';
import { GENETIC_LOINC, OBS_CATEGORY, SYS, VERIFIED_CODE_SYSTEMS } from '@/data/fhir-codes';
import type { ParsedEvent, ProblemEntry, RelativeEntry, ParsedHealthRecord } from './health-record';
import {
  ABSENCE_SNOMED,
  CODE_SAB,
  RELATIONSHIP_LABELS,
  ageToYears,
  yearFromTs,
} from './health-record';

/**
 * The minimal Bundle shape this parser consumes — mirrors the gateway's `FhirImportBundle`.
 * `fetchWarnings` (added by the W4 gateway) carries per-search retrieval failures ("Couldn't
 * retrieve labs …"); the parser merges them verbatim into {@link ParsedHealthRecord.warnings}. The
 * field may be absent on bundles assembled before W4, so every read guards with `?? []`.
 */
export interface FhirImportBundle {
  resourceType: 'Bundle';
  entry?: { fullUrl?: string; resource?: unknown }[];
  fetchWarnings?: string[];
}

/** Options for {@link parseFhirImport}: the proband's `Patient.id`, else the sole Patient is used. */
export interface ParseFhirOptions {
  patientId?: string;
}

// ---------------------------------------------------------------------------
// System URIs (the real ones a conformant SMART server emits — never invented).
// ---------------------------------------------------------------------------

// SNOMED / ICD-10-CM system URIs now come from the shared data-layer `fhir-codes.ts` (DR-0024) so
// the parser and gateway read one definition. `v3-RoleCode` is a relationship vocabulary (not a
// clinical code system) and stays local to this importer.
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
  if (system === SYS.ICD10CM) return 'ICD-10-CM';
  if (system === SYS.SNOMED) return 'SNOMED-CT';
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
// Wave 2/3 — full-timeline events (medications, labs, vitals, genomic, immunizations,
// allergies, procedures, encounters). Each mapper is pure and produces 0-or-1 ParsedEvent.
// ---------------------------------------------------------------------------

/** Best human-readable label for a CodeableConcept — `text`, else the first coding `display`, else
 * the first `code` (across ALL systems, so a display-only CPT/HCPCS/NDC term still reaches narrative). */
function conceptDisplay(cc: Record<string, unknown> | undefined): string {
  const text = str(cc?.text);
  if (text) return text.trim();
  const codings = codingsOf(cc);
  const firstDisplay = codings.find((c) => c.display)?.display;
  if (firstDisplay) return firstDisplay.trim();
  const firstCode = codings.find((c) => c.code)?.code;
  return firstCode?.trim() ?? '';
}

/** Codings whose system is a VERIFIED code system, preserved verbatim as {@link Coding}. Anything
 * else (CPT / HCPCS / NDC / ICD-9-CM / proprietary) is excluded — routed to narrative, never
 * crosswalked (guardrail #1). */
function extractCodings(cc: Record<string, unknown> | undefined): Coding[] {
  const out: Coding[] = [];
  for (const c of codingsOf(cc)) {
    if (!c.system || !c.code || !VERIFIED_CODE_SYSTEMS.has(c.system)) continue;
    const coding: Coding = { system: c.system, code: c.code };
    if (c.display != null) coding.display = c.display;
    out.push(coding);
  }
  return out;
}

/**
 * Parse the leading ISO date of a FHIR `dateTime`/`date` (stripping any time component), preserving
 * exactly the source precision: `"2020"`→`{2020,"2020"}`, `"2020-06"`→`{2020,"2020-06"}`,
 * `"2020-06-15T10:30:00Z"`→`{2020,"2020-06-15"}`. Validated through {@link isPartialDate} (so a real
 * calendar date only); anything malformed → `null`. Never fabricates a day/month the source omitted.
 */
function partialDateFromTs(value: string): { year: number; date: PartialDate } | null {
  const m = /^(\d{4}(?:-\d{2}(?:-\d{2})?)?)/.exec(value.trim());
  if (!m) return null;
  const date = m[1];
  if (!isPartialDate(date)) return null;
  return { year: yearOfPartialDate(date), date };
}

/** First non-empty ISO date among the given raw candidate strings → `{year, date}`, else `null`. */
function firstPartialDate(
  ...candidates: (string | undefined)[]
): { year: number; date: PartialDate } | null {
  for (const c of candidates) {
    if (c) {
      const parsed = partialDateFromTs(c);
      if (parsed) return parsed;
    }
  }
  return null;
}

/** The disposition of a status value against a resource's status buckets. `entered-in-error` is
 * always a silent drop; an unrecognized status defaults to `interim` (conservative needs-review). */
type StatusDisposition = 'settled' | 'interim' | 'absence' | 'drop-silent';
function classifyStatus(
  status: string | undefined,
  buckets: { settled: readonly string[]; interim: readonly string[]; absence: readonly string[] },
): StatusDisposition {
  if (status === 'entered-in-error') return 'drop-silent';
  if (status && buckets.settled.includes(status)) return 'settled';
  if (status && buckets.absence.includes(status)) return 'absence';
  if (status && buckets.interim.includes(status)) return 'interim';
  return 'interim';
}

/** Accumulator the event mappers report drops into (never a positive event for a dropped resource). */
interface EventSink {
  events: ParsedEvent[];
  /** Absence-status resources (not-taken/not-done/refuted/cancelled) — counted in a warning. */
  absence: number;
  /** Resources dropped for no usable date, or a missing `id` — counted in a warning. */
  incomplete: number;
}

/** Resolve a medication's coded concept from `medicationCodeableConcept`, an `_include`d bundle
 * `Medication` (by id / `Medication/<id>` reference), or a `contained` Medication (`#<id>`). Returns
 * the concept + whether it resolved; an unresolvable reference is surfaced needs-review, never dropped. */
function resolveMedicationConcept(
  resource: Record<string, unknown>,
  medicationById: Map<string, Record<string, unknown>>,
): { cc: Record<string, unknown> | undefined; resolved: boolean } {
  const inline = asObj(resource.medicationCodeableConcept);
  if (inline) return { cc: inline, resolved: true };

  const ref = str(asObj(resource.medicationReference)?.reference);
  if (!ref) return { cc: undefined, resolved: false };

  if (ref.startsWith('#')) {
    const id = ref.slice(1);
    const contained = (Array.isArray(resource.contained) ? resource.contained : [])
      .map(asObj)
      .find((m) => m && str(m.id) === id);
    const cc = asObj(contained?.code);
    return cc ? { cc, resolved: true } : { cc: undefined, resolved: false };
  }

  const id = ref.includes('/') ? ref.slice(ref.lastIndexOf('/') + 1) : ref;
  const cc = asObj(medicationById.get(id)?.code);
  return cc ? { cc, resolved: true } : { cc: undefined, resolved: false };
}

const MED_STATEMENT_BUCKETS = {
  settled: ['active', 'completed', 'stopped'],
  interim: ['intended', 'on-hold', 'unknown'],
  absence: ['not-taken'],
} as const;
const MED_REQUEST_BUCKETS = {
  settled: ['active', 'completed', 'stopped'],
  interim: ['on-hold', 'draft', 'unknown'],
  absence: ['cancelled'],
} as const;
const OBSERVATION_BUCKETS = {
  settled: ['final', 'amended', 'corrected'],
  interim: ['registered', 'preliminary', 'unknown'],
  absence: ['cancelled'],
} as const;
const IMMUNIZATION_BUCKETS = {
  settled: ['completed'],
  interim: [] as const,
  absence: ['not-done'],
} as const;
const ALLERGY_BUCKETS = {
  settled: ['confirmed'],
  interim: ['unconfirmed'],
  absence: ['refuted'],
} as const;
const PROCEDURE_BUCKETS = {
  settled: ['completed', 'stopped'],
  interim: ['preparation', 'in-progress', 'on-hold', 'unknown'],
  absence: ['not-done'],
} as const;
const ENCOUNTER_BUCKETS = {
  settled: ['finished'],
  interim: [] as const, // every non-cancelled/eie status → interim (still surfaced needs-review)
  absence: ['cancelled'],
} as const;

/** Map one MedicationStatement/MedicationRequest → a `medication` event (or a drop). */
function mapMedication(
  resource: Record<string, unknown>,
  parseId: string,
  medicationById: Map<string, Record<string, unknown>>,
  sink: EventSink,
  kind: 'statement' | 'request',
): void {
  const status = str(resource.status);
  const disp = classifyStatus(
    status,
    kind === 'statement' ? MED_STATEMENT_BUCKETS : MED_REQUEST_BUCKETS,
  );
  if (disp === 'drop-silent') return;
  if (disp === 'absence') {
    sink.absence++;
    return;
  }

  const parsedDate =
    kind === 'statement'
      ? firstPartialDate(
          str(resource.effectiveDateTime),
          str(asObj(resource.effectivePeriod)?.start),
        )
      : firstPartialDate(str(resource.authoredOn));
  if (!parsedDate) {
    sink.incomplete++;
    return;
  }

  const { cc, resolved } = resolveMedicationConcept(resource, medicationById);
  const coding = extractCodings(cc);
  const title = conceptDisplay(cc) || 'Medication';
  const dose =
    kind === 'statement'
      ? str(asObj(firstOf(resource.dosage))?.text)
      : str(asObj(firstOf(resource.dosageInstruction))?.text);
  const med: MedicationInfo = { ongoing: status === 'active' };
  if (dose) med.dose = dose;

  sink.events.push({
    parseId,
    type: 'medication',
    year: parsedDate.year,
    date: parsedDate.date,
    title,
    detail: dose ?? '',
    coding,
    med,
    // An unresolvable medicationReference is surfaced needs-review (never silently dropped).
    needsReview: disp === 'interim' || !resolved,
  });
}

/** Map one Observation → a `lab` / `vital` / `genetic` event (or a drop). */
function mapObservation(resource: Record<string, unknown>, parseId: string, sink: EventSink): void {
  const disp = classifyStatus(str(resource.status), OBSERVATION_BUCKETS);
  if (disp === 'drop-silent') return;
  if (disp === 'absence') {
    sink.absence++;
    return;
  }

  const code = asObj(resource.code);
  const categoryCodings = (Array.isArray(resource.category) ? resource.category : []).flatMap((c) =>
    codingsOf(asObj(c)),
  );
  const isGenomicCategory = categoryCodings.some(
    (c) => c.system === SYS.V2_0074 && (c.code === 'GE' || c.code === 'CG'),
  );
  const componentCodeCodings = (
    Array.isArray(resource.component) ? resource.component : []
  ).flatMap((comp) => codingsOf(asObj(asObj(comp)?.code)));
  const hasGeneticLoinc = [...codingsOf(code), ...componentCodeCodings].some(
    (c) => c.system === SYS.LOINC && c.code != null && GENETIC_LOINC.has(c.code),
  );
  const isGenetic = isGenomicCategory || hasGeneticLoinc;

  // Genomic date source is effectiveDateTime ONLY (fact-of-test); lab/vital also accept period/issued.
  const parsedDate = isGenetic
    ? firstPartialDate(str(resource.effectiveDateTime))
    : firstPartialDate(
        str(resource.effectiveDateTime),
        str(asObj(resource.effectivePeriod)?.start),
        str(resource.issued),
      );
  if (!parsedDate) {
    sink.incomplete++;
    return;
  }

  const title = conceptDisplay(code) || (isGenetic ? 'Genetic test' : 'Observation');
  const coding = extractCodings(code);

  if (isGenetic) {
    // Fact-of-test ONLY — never read value[x] / interpretation / component values, and ALWAYS
    // surface needs-review regardless of status (DR-0024 default-OFF; guardrail #1).
    sink.events.push({
      parseId,
      type: 'genetic',
      year: parsedDate.year,
      date: parsedDate.date,
      title,
      detail: '',
      coding,
      needsReview: true,
    });
    return;
  }

  const isVital = categoryCodings.some((c) => c.code === OBS_CATEGORY.VITAL);
  const type = isVital ? 'vital' : 'lab';
  const measurement = measurementOf(resource);
  const valueString = str(resource.valueString);

  const event: ParsedEvent = {
    parseId,
    type,
    year: parsedDate.year,
    date: parsedDate.date,
    title,
    detail: valueString ?? '',
    coding,
    needsReview: disp === 'interim',
  };
  if (measurement) {
    if (isVital) event.vital = measurement;
    else event.lab = measurement;
  }
  sink.events.push(event);
}

/** A {@link Measurement} from `valueQuantity` ONLY (never `valueString`), with a reference range
 * taken verbatim only when exactly one `referenceRange` applies and its bound unit matches the
 * value unit. NEVER an in/out-of-range interpretation flag (guardrail #1). */
function measurementOf(resource: Record<string, unknown>): Measurement | undefined {
  const vq = asObj(resource.valueQuantity);
  const value = vq && typeof vq.value === 'number' ? vq.value : undefined;
  const unit = str(vq?.unit);
  if (value === undefined || unit === undefined) return undefined;

  const measurement: Measurement = { value, unit };
  const ranges = Array.isArray(resource.referenceRange) ? resource.referenceRange : [];
  if (ranges.length === 1) {
    const r = asObj(ranges[0]);
    const low = asObj(r?.low);
    const high = asObj(r?.high);
    const lowVal = low && typeof low.value === 'number' ? low.value : undefined;
    const highVal = high && typeof high.value === 'number' ? high.value : undefined;
    const unitOk =
      (lowVal === undefined || str(low?.unit) === unit) &&
      (highVal === undefined || str(high?.unit) === unit);
    if (unitOk) {
      if (lowVal !== undefined) measurement.refLow = lowVal;
      if (highVal !== undefined) measurement.refHigh = highVal;
    }
  }
  return measurement;
}

/** Map one Immunization → an `immunization` event (or a drop). */
function mapImmunization(
  resource: Record<string, unknown>,
  parseId: string,
  sink: EventSink,
): void {
  const disp = classifyStatus(str(resource.status), IMMUNIZATION_BUCKETS);
  if (disp === 'drop-silent') return;
  if (disp === 'absence') {
    sink.absence++;
    return;
  }
  const parsedDate = firstPartialDate(str(resource.occurrenceDateTime));
  if (!parsedDate) {
    sink.incomplete++;
    return;
  }

  const vaccineCode = asObj(resource.vaccineCode);
  const immunization: ImmunizationInfo = {};
  const vaccine = conceptDisplay(vaccineCode);
  if (vaccine) immunization.vaccine = vaccine;
  const protocol = asObj(firstOf(resource.protocolApplied));
  const doseNum =
    protocol && typeof protocol.doseNumberPositiveInt === 'number'
      ? protocol.doseNumberPositiveInt
      : str(protocol?.doseNumberString);
  if (doseNum != null) immunization.doseLabel = `Dose ${doseNum}`;

  sink.events.push({
    parseId,
    type: 'immunization',
    year: parsedDate.year,
    date: parsedDate.date,
    title: vaccine || 'Immunization',
    detail: '',
    coding: extractCodings(vaccineCode),
    immunization,
    needsReview: disp === 'interim',
  });
}

/** Map one AllergyIntolerance → an `allergy` event (or a drop). Gated on verificationStatus;
 * clinicalStatus NEVER excludes. Onset order: onsetDateTime → onsetPeriod.start → onsetAge (never
 * recordedDate, never onsetString). */
function mapAllergy(
  resource: Record<string, unknown>,
  parseId: string,
  birthYear: number | null,
  sink: EventSink,
): void {
  const verStatus = codingsOf(asObj(resource.verificationStatus))[0]?.code;
  const disp = classifyStatus(verStatus, ALLERGY_BUCKETS);
  if (disp === 'drop-silent') return;
  if (disp === 'absence') {
    sink.absence++;
    return;
  }

  const parsedDate = firstPartialDate(
    str(resource.onsetDateTime),
    str(asObj(resource.onsetPeriod)?.start),
  );
  let year: number;
  let date: PartialDate | undefined;
  if (parsedDate) {
    year = parsedDate.year;
    date = parsedDate.date;
  } else {
    // onsetAge → a calendar year via Patient.birthDate (never recordedDate / onsetString).
    const age = ageFromOnsetAge(resource.onsetAge);
    if (age == null || birthYear == null) {
      sink.incomplete++;
      return;
    }
    year = birthYear + age;
    date = undefined;
  }

  const code = asObj(resource.code);
  const firstReaction = asObj(firstOf(resource.reaction));
  const reactionText = firstReaction
    ? conceptDisplay(asObj(firstOf(firstReaction.manifestation))) || str(firstReaction.description)
    : undefined;
  const severity = str(firstReaction?.severity);
  const allergy: AllergyInfo = { substance: conceptDisplay(code) || 'Allergy' };
  if (reactionText) allergy.reaction = reactionText;
  if (severity === 'mild' || severity === 'moderate' || severity === 'severe') {
    allergy.severity = severity;
  }

  sink.events.push({
    parseId,
    type: 'allergy',
    year,
    date,
    title: allergy.substance,
    detail: reactionText ?? '',
    coding: extractCodings(code),
    allergy,
    needsReview: disp === 'interim',
  });
}

/** Map one Procedure → a `procedure` event (or a drop). */
function mapProcedure(resource: Record<string, unknown>, parseId: string, sink: EventSink): void {
  const disp = classifyStatus(str(resource.status), PROCEDURE_BUCKETS);
  if (disp === 'drop-silent') return;
  if (disp === 'absence') {
    sink.absence++;
    return;
  }
  const parsedDate = firstPartialDate(
    str(resource.performedDateTime),
    str(asObj(resource.performedPeriod)?.start),
  );
  if (!parsedDate) {
    sink.incomplete++;
    return;
  }
  const code = asObj(resource.code);
  sink.events.push({
    parseId,
    type: 'procedure',
    year: parsedDate.year,
    date: parsedDate.date,
    title: conceptDisplay(code) || 'Procedure',
    detail: '',
    coding: extractCodings(code),
    needsReview: disp === 'interim',
  });
}

/** Map one Encounter → a `visit` event (or a drop). ALWAYS needs-review (DR-0024 default-OFF). */
function mapEncounter(resource: Record<string, unknown>, parseId: string, sink: EventSink): void {
  const disp = classifyStatus(str(resource.status), ENCOUNTER_BUCKETS);
  if (disp === 'drop-silent') return;
  if (disp === 'absence') {
    sink.absence++;
    return;
  }
  const parsedDate = firstPartialDate(str(asObj(resource.period)?.start));
  if (!parsedDate) {
    sink.incomplete++;
    return;
  }
  const typeConcept = asObj(firstOf(resource.type));
  const cls = asObj(resource.class);
  const title = conceptDisplay(typeConcept) || str(cls?.display) || str(cls?.code) || 'Visit';
  sink.events.push({
    parseId,
    type: 'visit',
    year: parsedDate.year,
    date: parsedDate.date,
    title,
    detail: '',
    coding: extractCodings(typeConcept),
    needsReview: true,
  });
}

/** First element of an unknown value when it is a non-empty array, else `undefined`. */
function firstOf(v: unknown): unknown {
  return Array.isArray(v) && v.length > 0 ? v[0] : undefined;
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

  // `_include`d Medication resources, indexed by id for `medicationReference` resolution.
  const medicationById = new Map<string, Record<string, unknown>>();
  for (const med of byType('Medication')) {
    const id = str(med.id);
    if (id) medicationById.set(id, med);
  }

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
    // Placement uses the (possibly blanked) effective code so `subject-unknown` stays ambiguous,
    // but sex-assigned-at-birth reads the UN-blanked relationship code: a known sex-specific role
    // (e.g. MTH→'f') must not be downgraded to 'u' just because placement is ambiguous (guardrail #4).
    const sab = parseSab(resource, relationshipCode);

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

  // --- Full-timeline events (Wave 2/3): dispatch each event resource to its pure mapper. ---
  const sink: EventSink = { events: [], absence: 0, incomplete: 0 };
  for (const resource of resources) {
    const type = str(resource.resourceType);
    if (!type || !EVENT_RESOURCE_TYPES.has(type)) continue;
    const id = str(resource.id);
    if (!id) {
      // No id ⇒ no deterministic dedup identity; never fabricate one — drop + count.
      sink.incomplete++;
      continue;
    }
    const parseId = `fhir:${type}:${id}`;
    switch (type) {
      case 'MedicationStatement':
        mapMedication(resource, parseId, medicationById, sink, 'statement');
        break;
      case 'MedicationRequest':
        mapMedication(resource, parseId, medicationById, sink, 'request');
        break;
      case 'Observation':
        mapObservation(resource, parseId, sink);
        break;
      case 'Immunization':
        mapImmunization(resource, parseId, sink);
        break;
      case 'AllergyIntolerance':
        mapAllergy(resource, parseId, probandBirthYear, sink);
        break;
      case 'Procedure':
        mapProcedure(resource, parseId, sink);
        break;
      case 'Encounter':
        mapEncounter(resource, parseId, sink);
        break;
    }
  }
  if (sink.absence) {
    warnings.push(
      `${sink.absence} record ${sink.absence === 1 ? 'entry was' : 'entries were'} not imported because ${
        sink.absence === 1 ? 'it was' : 'they were'
      } recorded as not taken, not done, or ruled out.`,
    );
  }
  if (sink.incomplete) {
    warnings.push(
      `${sink.incomplete} timeline ${sink.incomplete === 1 ? 'event was' : 'events were'} not imported because ${
        sink.incomplete === 1 ? 'it was' : 'they were'
      } missing a usable date.`,
    );
  }

  // Merge the gateway's per-search retrieval warnings verbatim (W4; absent on pre-W4 bundles).
  for (const w of bundle?.fetchWarnings ?? []) {
    if (typeof w === 'string') warnings.push(w);
  }

  return { proband: { problems: probandProblems, events: sink.events }, familyMembers, warnings };
}

/** Resource types the Wave 2/3 event pipeline maps (Condition / FamilyMemberHistory are handled by
 * the problem/relative parsers above; Medication resources are referenced, never events themselves). */
const EVENT_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  'MedicationStatement',
  'MedicationRequest',
  'Observation',
  'Immunization',
  'AllergyIntolerance',
  'Procedure',
  'Encounter',
]);

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
 * `deceasedBoolean` → dead/alive with no year; `deceasedDate` → dead + that year; `deceasedAge` /
 * `deceasedRange` / `deceasedString` → dead with no calendar year (a range/textual death description
 * clearly asserts death but never a fabricated year); absent → unknown (`dead: null`).
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
  // deceasedAge / deceasedRange / deceasedString all assert death without a calendar year — parity
  // with deceasedAge's dead-true. Never invent a year; never infer death from an absent field.
  if (
    resource.deceasedAge != null ||
    resource.deceasedRange != null ||
    str(resource.deceasedString) != null
  ) {
    return { year: null, dead: true };
  }
  return { year: null, dead: null };
}
