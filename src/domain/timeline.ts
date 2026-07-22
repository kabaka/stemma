/**
 * Timeline read-models: pure, deterministic views derived from a person's timeline
 * events. These project the recorded facts (structured medication / lab payloads) into
 * the shapes the UI charts and lists consume, without inferring anything beyond what was
 * recorded — no in-range/out-of-range flag, no clinical interpretation, that is reserved
 * for a clinician (guardrail #1). Like the rest of `src/domain/`, no wall clock: any
 * "now" is injected as an explicit `asOfYear`.
 */
import type { FamilyRecord, Measurement, TimelineEvent } from './types';

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

/** One sample in a measurement (lab or vital) time series. Reference bounds are user-entered, never a shipped band. */
export interface MeasurementPoint {
  eventId: string;
  year: number;
  value: number;
  unit: string;
  refLow?: number;
  refHigh?: number;
}

/** Back-compat alias for {@link MeasurementPoint} (labs were the first measurement series). */
export type LabPoint = MeasurementPoint;

/**
 * The measurement-bearing event kinds. `lab` and `vital` share the {@link Measurement}
 * payload shape but live on different event fields, so every read-model that projects a
 * measurement is parameterised by this discriminant — never assume a title is unique
 * across the two axes (a `lab` and a `vital` may share a title and must not mix).
 */
export type MeasurementEventType = 'lab' | 'vital';

/** The measurement payload for `type`: the `lab` field for labs, the `vital` field for vitals. */
function measurementField(e: TimelineEvent, type: MeasurementEventType): Measurement | undefined {
  return type === 'lab' ? e.lab : e.vital;
}

/**
 * Shared projector behind {@link labSeries}/{@link vitalSeries}: the time series for one
 * measurement title on one person of the given `type`, matched by trimmed case-insensitive
 * title, sorted ascending by year. Both the event `type` and the presence of the matching
 * payload field are guarded (defence-in-depth against a hand-crafted/corrupt backup that
 * attaches a measurement payload to some other event type). Pure; returns the recorded data
 * as-is — no in-range/out-of-range flag or interpretation (guardrail #1).
 */
function measurementSeries(
  record: FamilyRecord,
  personId: string,
  title: string,
  type: MeasurementEventType,
): MeasurementPoint[] {
  const key = title.trim().toLowerCase();
  const out: MeasurementPoint[] = [];
  for (const e of record.timeline) {
    if (e.person !== personId || e.type !== type) continue;
    const m = measurementField(e, type);
    if (m === undefined || e.title.trim().toLowerCase() !== key) continue;
    out.push({
      eventId: e.id,
      year: e.year,
      value: m.value,
      unit: m.unit,
      refLow: m.refLow,
      refHigh: m.refHigh,
    });
  }
  return out.sort((a, b) => a.year - b.year);
}

/**
 * Shared projector behind {@link labTitles}/{@link vitalTitles}: distinct measurement titles
 * (original casing, first-seen) recorded for a person on events of the given `type` carrying
 * the matching payload. Deduplicated by trimmed case-insensitive title so `"HbA1c"` and
 * `" hba1c "` collapse to the first spelling seen. Pure.
 */
function measurementTitles(
  record: FamilyRecord,
  personId: string,
  type: MeasurementEventType,
): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const e of record.timeline) {
    if (e.person !== personId || e.type !== type) continue;
    if (measurementField(e, type) === undefined) continue;
    const key = e.title.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(e.title);
  }
  return titles;
}

/**
 * Time series for one lab test on one person, matched by trimmed case-insensitive title,
 * sorted ascending by year. Pure. Only `lab`-type events carrying a `lab` payload (the
 * type check is defence-in-depth against a hand-crafted/corrupt backup that attaches a
 * `lab` payload to some other event type). Returns the recorded data as-is — no
 * in-range/out-of-range flag or interpretation (guardrail #1).
 */
export function labSeries(
  record: FamilyRecord,
  personId: string,
  title: string,
): MeasurementPoint[] {
  return measurementSeries(record, personId, title, 'lab');
}

/**
 * Distinct lab titles (original casing, first-seen) recorded for a person on `lab`-type
 * events carrying a `lab` payload. Deduplicated by trimmed case-insensitive title so
 * `"HbA1c"` and `" hba1c "` collapse to the first spelling seen.
 */
export function labTitles(record: FamilyRecord, personId: string): string[] {
  return measurementTitles(record, personId, 'lab');
}

/**
 * Time series for one vital sign on one person, matched by trimmed case-insensitive title,
 * sorted ascending by year. Structurally identical to {@link labSeries} but discriminates
 * on `vital`-type events carrying a `vital` payload; a `lab` and a `vital` sharing an
 * identical title never cross-contaminate (the event-type discriminant is explicit). Pure;
 * returns the recorded data as-is — no interpretation (guardrail #1).
 */
export function vitalSeries(
  record: FamilyRecord,
  personId: string,
  title: string,
): MeasurementPoint[] {
  return measurementSeries(record, personId, title, 'vital');
}

/**
 * Distinct vital titles (original casing, first-seen) recorded for a person on `vital`-type
 * events carrying a `vital` payload. Deduplicated by trimmed case-insensitive title, exactly
 * as {@link labTitles}.
 */
export function vitalTitles(record: FamilyRecord, personId: string): string[] {
  return measurementTitles(record, personId, 'vital');
}

/**
 * One row of the printable "Labs & vitals" summary: the latest recorded sample of a single
 * measurement series plus its span, a faithful restatement of the recorded facts only —
 * no min/max, no in-range/out-of-range flag, no interpretation (guardrail #1).
 */
export interface MeasurementSeriesSummary {
  title: string;
  type: MeasurementEventType;
  latestValue: number;
  latestUnit: string;
  latestYear: number;
  refLow?: number;
  refHigh?: number;
  count: number;
  firstYear: number;
}

/**
 * Reduces one measurement series (as returned by {@link labSeries}/{@link vitalSeries},
 * already ascending by year) to its summary row. "Latest" relies on that ascending-year
 * invariant — the last point, no re-sort and no `max()`. `latestUnit`/`refLow`/`refHigh`
 * come from the latest point; `firstYear` from the first; `count` is the point count.
 * Returns `undefined` for an empty series. Pure; no interpretation (guardrail #1).
 */
export function seriesSummary(
  title: string,
  type: MeasurementEventType,
  points: MeasurementPoint[],
): MeasurementSeriesSummary | undefined {
  if (points.length === 0) return undefined;
  const latest = points[points.length - 1];
  return {
    title,
    type,
    latestValue: latest.value,
    latestUnit: latest.unit,
    latestYear: latest.year,
    refLow: latest.refLow,
    refHigh: latest.refHigh,
    count: points.length,
    firstYear: points[0].year,
  };
}

/**
 * Every distinct lab OR vital series for a person (per `type`), each reduced to its
 * {@link seriesSummary} row, in the same first-seen order as {@link labTitles}/
 * {@link vitalTitles}. A title exists only because at least one event carries it, so no
 * series is empty and every title yields a row. Pure; faithful restatement only (guardrail #1).
 */
export function measurementSummaries(
  record: FamilyRecord,
  personId: string,
  type: MeasurementEventType,
): MeasurementSeriesSummary[] {
  const out: MeasurementSeriesSummary[] = [];
  for (const title of measurementTitles(record, personId, type)) {
    const summary = seriesSummary(title, type, measurementSeries(record, personId, title, type));
    if (summary !== undefined) out.push(summary);
  }
  return out;
}
