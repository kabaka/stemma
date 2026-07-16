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
