/**
 * Timeline read-models: pure, deterministic views derived from a person's timeline
 * events. These project the recorded facts (structured medication / lab payloads) into
 * the shapes the UI charts and lists consume, without inferring anything beyond what was
 * recorded — no in-range/out-of-range flag, no clinical interpretation, that is reserved
 * for a clinician (guardrail #1). Like the rest of `src/domain/`, no wall clock: any
 * "now" is injected as an explicit `asOfYear`.
 */
import type { FamilyRecord, TimelineEvent } from './types';

/** A medication a person is taking, resolved against its structured `med` payload. */
export interface MedicationEntry {
  event: TimelineEvent;
  startYear: number;
  stopYear?: number;
}

/**
 * Medications a person is currently taking as of `asOfYear`: medication events with a
 * structured `med` payload, `ongoing === true`, and start year (`event.year`) `<= asOfYear`.
 * Legacy/unstructured medication events (no `med`) are excluded. Pure; no inference beyond
 * the recorded `ongoing` flag.
 */
export function currentMedications(
  record: FamilyRecord,
  personId: string,
  asOfYear: number,
): MedicationEntry[] {
  const out: MedicationEntry[] = [];
  for (const event of record.timeline) {
    if (event.person !== personId || event.type !== 'medication') continue;
    const med = event.med;
    if (!med || !med.ongoing || event.year > asOfYear) continue;
    out.push({ event, startYear: event.year, stopYear: med.stopYear });
  }
  return out;
}

/** One recorded allergy/intolerance. */
export interface AllergyEntry {
  event: TimelineEvent;
  substance: string;
  reaction?: string;
  /** A recorded fact, never a computed risk (guardrail #1). */
  severity?: 'mild' | 'moderate' | 'severe';
}

/**
 * Allergies recorded for a person: `allergy`-type events carrying a structured `allergy`
 * payload. The type check is defence-in-depth against a hand-crafted/corrupt backup that
 * attaches an `allergy` payload to some other event type (as {@link labSeries} guards).
 * Pure and not as-of-dependent — an allergy is a standing fact, not a time-relative event,
 * so nothing is filtered by year. Projects the recorded fields as-is, no interpretation
 * (guardrail #1).
 */
export function allergies(record: FamilyRecord, personId: string): AllergyEntry[] {
  return record.timeline
    .filter((e) => e.person === personId && e.type === 'allergy' && e.allergy !== undefined)
    .map((e) => {
      const allergy = e.allergy as NonNullable<TimelineEvent['allergy']>;
      return {
        event: e,
        substance: allergy.substance,
        reaction: allergy.reaction,
        severity: allergy.severity,
      };
    });
}

/** One recorded immunization. */
export interface ImmunizationEntry {
  event: TimelineEvent;
  vaccine?: string;
  doseLabel?: string;
  year: number;
}

/**
 * Immunizations recorded for a person: `immunization`-type events carrying a structured
 * `immunization` payload, sorted ascending by year (a vaccination history reads
 * oldest→newest, mirroring {@link labSeries}' same-type series convention). The type check
 * is defence-in-depth against a corrupt backup that attaches an `immunization` payload to
 * some other event type. Pure; projects the recorded fields as-is, no interpretation
 * (guardrail #1).
 */
export function immunizations(record: FamilyRecord, personId: string): ImmunizationEntry[] {
  return record.timeline
    .filter(
      (e) => e.person === personId && e.type === 'immunization' && e.immunization !== undefined,
    )
    .map((e) => {
      const immunization = e.immunization as NonNullable<TimelineEvent['immunization']>;
      return {
        event: e,
        vaccine: immunization.vaccine,
        doseLabel: immunization.doseLabel,
        year: e.year,
      };
    })
    .sort((a, b) => a.year - b.year);
}

/** One sample in a lab time series. Reference bounds are user-entered, never a shipped band. */
export interface LabPoint {
  eventId: string;
  year: number;
  value: number;
  unit: string;
  refLow?: number;
  refHigh?: number;
}

/**
 * Time series for one lab test on one person, matched by trimmed case-insensitive title,
 * sorted ascending by year. Pure. Only `lab`-type events carrying a `lab` payload (the
 * type check is defence-in-depth against a hand-crafted/corrupt backup that attaches a
 * `lab` payload to some other event type). Returns the recorded data as-is — no
 * in-range/out-of-range flag or interpretation (guardrail #1).
 */
export function labSeries(record: FamilyRecord, personId: string, title: string): LabPoint[] {
  const key = title.trim().toLowerCase();
  return record.timeline
    .filter(
      (e) =>
        e.person === personId &&
        e.type === 'lab' &&
        e.lab !== undefined &&
        e.title.trim().toLowerCase() === key,
    )
    .map((e) => {
      const lab = e.lab as NonNullable<TimelineEvent['lab']>;
      return {
        eventId: e.id,
        year: e.year,
        value: lab.value,
        unit: lab.unit,
        refLow: lab.refLow,
        refHigh: lab.refHigh,
      };
    })
    .sort((a, b) => a.year - b.year);
}

/**
 * Distinct lab titles (original casing, first-seen) recorded for a person on `lab`-type
 * events carrying a `lab` payload. Deduplicated by trimmed case-insensitive title so
 * `"HbA1c"` and `" hba1c "` collapse to the first spelling seen.
 */
export function labTitles(record: FamilyRecord, personId: string): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const e of record.timeline) {
    if (e.person !== personId || e.type !== 'lab' || e.lab === undefined) continue;
    const key = e.title.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(e.title);
  }
  return titles;
}
