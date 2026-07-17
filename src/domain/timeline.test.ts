import { describe, expect, it } from 'vitest';
import type { FamilyRecord, Person, TimelineEvent } from './types';
import { allergies, currentMedications, immunizations, labSeries, labTitles } from './timeline';

/** Minimal fixture person, matching the style of record.test.ts / screening.test.ts. */
function mkPerson(id: string, overrides: Partial<Person> = {}): Person {
  return {
    id,
    name: id,
    sab: 'f',
    gender: 'woman',
    gen: 0,
    x: 0,
    dead: false,
    birth: null,
    death: null,
    conds: [],
    ...overrides,
  };
}

function mkRecord(people: Person[], timeline: TimelineEvent[] = []): FamilyRecord {
  return { people, unions: [], timeline, probandId: people[0].id };
}

describe('currentMedications', () => {
  // Fixed as-of year throughout — never the wall clock (seed convention: 2026).
  const ASOF = 2026;

  it('includes an ongoing medication whose start year is at or before asOfYear', () => {
    const event: TimelineEvent = {
      id: 'e1',
      person: 'a',
      year: 2020,
      type: 'medication',
      title: 'Started Metformin',
      detail: '',
      med: { dose: '500mg BID', ongoing: true },
    };
    const record = mkRecord([mkPerson('a')], [event]);
    const meds = currentMedications(record, 'a', ASOF);
    expect(meds).toEqual([{ event, startYear: 2020, stopYear: undefined }]);
  });

  it('excludes a medication explicitly marked not ongoing', () => {
    const event: TimelineEvent = {
      id: 'e2',
      person: 'a',
      year: 2018,
      type: 'medication',
      title: 'Stopped Amoxicillin',
      detail: '',
      med: { ongoing: false, stopYear: 2019 },
    };
    const record = mkRecord([mkPerson('a')], [event]);
    expect(currentMedications(record, 'a', ASOF)).toEqual([]);
  });

  it('excludes a medication whose start year is after asOfYear (future start)', () => {
    const event: TimelineEvent = {
      id: 'e3',
      person: 'a',
      year: 2030,
      type: 'medication',
      title: 'Planned future medication',
      detail: '',
      med: { ongoing: true },
    };
    const record = mkRecord([mkPerson('a')], [event]);
    expect(currentMedications(record, 'a', ASOF)).toEqual([]);
  });

  it('includes an ongoing medication whose start year exactly equals asOfYear (boundary)', () => {
    const event: TimelineEvent = {
      id: 'e3b',
      person: 'a',
      year: ASOF,
      type: 'medication',
      title: 'Started this year',
      detail: '',
      med: { ongoing: true },
    };
    const record = mkRecord([mkPerson('a')], [event]);
    expect(currentMedications(record, 'a', ASOF)).toHaveLength(1);
  });

  it('excludes a medication event with no structured med payload (legacy/unstructured)', () => {
    const event: TimelineEvent = {
      id: 'e4',
      person: 'a',
      year: 2016,
      type: 'medication',
      title: 'Started Levothyroxine',
      detail: '50 mcg daily',
      // No `med` payload — a legacy flat event.
    };
    const record = mkRecord([mkPerson('a')], [event]);
    expect(currentMedications(record, 'a', ASOF)).toEqual([]);
  });

  it("isolates by person — another person's ongoing medications are never returned", () => {
    const eventA: TimelineEvent = {
      id: 'e5',
      person: 'a',
      year: 2020,
      type: 'medication',
      title: "A's medication",
      detail: '',
      med: { ongoing: true },
    };
    const eventB: TimelineEvent = {
      id: 'e6',
      person: 'b',
      year: 2020,
      type: 'medication',
      title: "B's medication",
      detail: '',
      med: { ongoing: true },
    };
    const record = mkRecord([mkPerson('a'), mkPerson('b')], [eventA, eventB]);
    const forA = currentMedications(record, 'a', ASOF);
    expect(forA).toHaveLength(1);
    expect(forA[0].event.id).toBe('e5');
    const forB = currentMedications(record, 'b', ASOF);
    expect(forB).toHaveLength(1);
    expect(forB[0].event.id).toBe('e6');
  });

  it('reports startYear from the event year and stopYear from the recorded med payload', () => {
    const event: TimelineEvent = {
      id: 'e7',
      person: 'a',
      year: 2021,
      type: 'medication',
      title: 'Started Atorvastatin',
      detail: '',
      med: { dose: '10mg daily', ongoing: true, stopYear: 2025 },
    };
    const record = mkRecord([mkPerson('a')], [event]);
    const [entry] = currentMedications(record, 'a', ASOF);
    expect(entry.startYear).toBe(2021);
    expect(entry.stopYear).toBe(2025);
  });
});

describe('allergies', () => {
  it('includes an allergy event with a valid payload, surfacing substance/reaction/severity', () => {
    const event: TimelineEvent = {
      id: 'a1',
      person: 'a',
      year: 2015,
      type: 'allergy',
      title: 'Penicillin allergy',
      detail: '',
      allergy: { substance: 'Penicillin', reaction: 'Hives', severity: 'moderate' },
    };
    const record = mkRecord([mkPerson('a')], [event]);
    expect(allergies(record, 'a')).toEqual([
      { event, substance: 'Penicillin', reaction: 'Hives', severity: 'moderate' },
    ]);
  });

  it('excludes an allergy-type event with no structured allergy payload (defence-in-depth)', () => {
    const event: TimelineEvent = {
      id: 'a2',
      person: 'a',
      year: 2015,
      type: 'allergy',
      title: 'Legacy allergy note',
      detail: 'Some free-text allergy mention',
      // No `allergy` payload.
    };
    const record = mkRecord([mkPerson('a')], [event]);
    expect(allergies(record, 'a')).toEqual([]);
  });

  it("isolates by person — another person's allergies are never returned", () => {
    const eventA: TimelineEvent = {
      id: 'a3',
      person: 'a',
      year: 2015,
      type: 'allergy',
      title: "A's allergy",
      detail: '',
      allergy: { substance: 'Peanuts' },
    };
    const eventB: TimelineEvent = {
      id: 'a4',
      person: 'b',
      year: 2015,
      type: 'allergy',
      title: "B's allergy",
      detail: '',
      allergy: { substance: 'Latex' },
    };
    const record = mkRecord([mkPerson('a'), mkPerson('b')], [eventA, eventB]);
    const forA = allergies(record, 'a');
    expect(forA).toHaveLength(1);
    expect(forA[0].substance).toBe('Peanuts');
    const forB = allergies(record, 'b');
    expect(forB).toHaveLength(1);
    expect(forB[0].substance).toBe('Latex');
  });

  it('returns an empty array when the person has no recorded allergies', () => {
    const record = mkRecord([mkPerson('a')], []);
    expect(allergies(record, 'a')).toEqual([]);
  });

  it('ignores an allergy payload attached to a non-allergy event type (defense-in-depth)', () => {
    const wrongType: TimelineEvent = {
      id: 'a5',
      person: 'a',
      year: 2015,
      type: 'diagnosis',
      title: 'X',
      detail: '',
      allergy: { substance: 'Shellfish' },
    };
    const record = mkRecord([mkPerson('a')], [wrongType]);
    expect(allergies(record, 'a')).toEqual([]);
  });
});

describe('immunizations', () => {
  it('includes an immunization event with a valid payload, carrying vaccine/doseLabel/year', () => {
    const event: TimelineEvent = {
      id: 'i1',
      person: 'a',
      year: 2018,
      type: 'immunization',
      title: 'Flu shot',
      detail: '',
      immunization: { vaccine: 'Influenza', doseLabel: 'Annual' },
    };
    const record = mkRecord([mkPerson('a')], [event]);
    expect(immunizations(record, 'a')).toEqual([
      { event, vaccine: 'Influenza', doseLabel: 'Annual', year: 2018 },
    ]);
  });

  it('excludes an immunization-type event with no structured immunization payload', () => {
    const event: TimelineEvent = {
      id: 'i2',
      person: 'a',
      year: 2018,
      type: 'immunization',
      title: 'Legacy immunization note',
      detail: 'Some free-text vaccination mention',
      // No `immunization` payload.
    };
    const record = mkRecord([mkPerson('a')], [event]);
    expect(immunizations(record, 'a')).toEqual([]);
  });

  it('ignores an immunization payload attached to a non-immunization event type (defense-in-depth)', () => {
    const wrongType: TimelineEvent = {
      id: 'i3',
      person: 'a',
      year: 2018,
      type: 'procedure',
      title: 'X',
      detail: '',
      immunization: { vaccine: 'MMR' },
    };
    const record = mkRecord([mkPerson('a')], [wrongType]);
    expect(immunizations(record, 'a')).toEqual([]);
  });

  it('sorts results ascending by year regardless of recorded order', () => {
    const late: TimelineEvent = {
      id: 'i4',
      person: 'a',
      year: 2022,
      type: 'immunization',
      title: 'Booster',
      detail: '',
      immunization: { vaccine: 'COVID-19' },
    };
    const early: TimelineEvent = {
      id: 'i5',
      person: 'a',
      year: 2010,
      type: 'immunization',
      title: 'Tetanus',
      detail: '',
      immunization: { vaccine: 'Tdap' },
    };
    const mid: TimelineEvent = {
      id: 'i6',
      person: 'a',
      year: 2016,
      type: 'immunization',
      title: 'Hep B',
      detail: '',
      immunization: { vaccine: 'Hepatitis B' },
    };
    // Deliberately out of order in the record.
    const record = mkRecord([mkPerson('a')], [late, early, mid]);
    const series = immunizations(record, 'a');
    expect(series.map((e) => e.year)).toEqual([2010, 2016, 2022]);
  });

  it("isolates by person — another person's immunizations are never returned", () => {
    const eventA: TimelineEvent = {
      id: 'i7',
      person: 'a',
      year: 2015,
      type: 'immunization',
      title: "A's shot",
      detail: '',
      immunization: { vaccine: 'HPV' },
    };
    const eventB: TimelineEvent = {
      id: 'i8',
      person: 'b',
      year: 2015,
      type: 'immunization',
      title: "B's shot",
      detail: '',
      immunization: { vaccine: 'Shingles' },
    };
    const record = mkRecord([mkPerson('a'), mkPerson('b')], [eventA, eventB]);
    const forA = immunizations(record, 'a');
    expect(forA).toHaveLength(1);
    expect(forA[0].event.id).toBe('i7');
    const forB = immunizations(record, 'b');
    expect(forB).toHaveLength(1);
    expect(forB[0].event.id).toBe('i8');
  });

  it('surfaces vaccine/doseLabel as optional passthrough — absent when not recorded', () => {
    const event: TimelineEvent = {
      id: 'i9',
      person: 'a',
      year: 2012,
      type: 'immunization',
      title: 'Unspecified vaccination',
      detail: '',
      immunization: {},
    };
    const record = mkRecord([mkPerson('a')], [event]);
    const [entry] = immunizations(record, 'a');
    expect(entry.vaccine).toBeUndefined();
    expect(entry.doseLabel).toBeUndefined();
    expect(entry.year).toBe(2012);
  });

  it('returns an empty array when the person has no recorded immunizations', () => {
    const record = mkRecord([mkPerson('a')], []);
    expect(immunizations(record, 'a')).toEqual([]);
  });
});

describe('labSeries', () => {
  it('matches by trimmed, case-insensitive title', () => {
    const event: TimelineEvent = {
      id: 'l1',
      person: 'a',
      year: 2020,
      type: 'lab',
      title: 'LDL',
      detail: '',
      lab: { value: 130, unit: 'mg/dL' },
    };
    const record = mkRecord([mkPerson('a')], [event]);
    expect(labSeries(record, 'a', ' ldl ')).toHaveLength(1);
    expect(labSeries(record, 'a', 'LDL')).toHaveLength(1);
    expect(labSeries(record, 'a', 'ldl')).toHaveLength(1);
    expect(labSeries(record, 'a', 'HDL')).toEqual([]);
  });

  it('sorts results ascending by year regardless of recorded order', () => {
    const late: TimelineEvent = {
      id: 'l2',
      person: 'a',
      year: 2023,
      type: 'lab',
      title: 'HbA1c',
      detail: '',
      lab: { value: 6.1, unit: '%' },
    };
    const early: TimelineEvent = {
      id: 'l3',
      person: 'a',
      year: 2019,
      type: 'lab',
      title: 'HbA1c',
      detail: '',
      lab: { value: 5.4, unit: '%' },
    };
    const mid: TimelineEvent = {
      id: 'l4',
      person: 'a',
      year: 2021,
      type: 'lab',
      title: 'HbA1c',
      detail: '',
      lab: { value: 5.8, unit: '%' },
    };
    // Deliberately out of order in the record.
    const record = mkRecord([mkPerson('a')], [late, early, mid]);
    const series = labSeries(record, 'a', 'HbA1c');
    expect(series.map((p) => p.year)).toEqual([2019, 2021, 2023]);
  });

  it('only includes events carrying a lab payload — same title without one is excluded', () => {
    const labEvent: TimelineEvent = {
      id: 'l5',
      person: 'a',
      year: 2020,
      type: 'lab',
      title: 'TSH',
      detail: '',
      lab: { value: 6.8, unit: 'mIU/L' },
    };
    const nonLabEvent: TimelineEvent = {
      id: 'l6',
      person: 'a',
      year: 2021,
      type: 'diagnosis',
      title: 'TSH',
      detail: 'Not a lab payload',
    };
    const record = mkRecord([mkPerson('a')], [labEvent, nonLabEvent]);
    const series = labSeries(record, 'a', 'TSH');
    expect(series).toHaveLength(1);
    expect(series[0].eventId).toBe('l5');
  });

  it('returns value/unit/refLow/refHigh exactly as recorded, with no interpretation flag', () => {
    const event: TimelineEvent = {
      id: 'l7',
      person: 'a',
      year: 2020,
      type: 'lab',
      title: 'LDL',
      detail: '',
      lab: { value: 168, unit: 'mg/dL', refLow: 0, refHigh: 100 },
    };
    const record = mkRecord([mkPerson('a')], [event]);
    const [point] = labSeries(record, 'a', 'LDL');
    expect(point).toEqual({
      eventId: 'l7',
      year: 2020,
      value: 168,
      unit: 'mg/dL',
      refLow: 0,
      refHigh: 100,
    });
  });

  it("isolates by person — another person's identically-titled lab is never returned", () => {
    const forA: TimelineEvent = {
      id: 'l8',
      person: 'a',
      year: 2020,
      type: 'lab',
      title: 'LDL',
      detail: '',
      lab: { value: 130, unit: 'mg/dL' },
    };
    const forB: TimelineEvent = {
      id: 'l9',
      person: 'b',
      year: 2020,
      type: 'lab',
      title: 'LDL',
      detail: '',
      lab: { value: 200, unit: 'mg/dL' },
    };
    const record = mkRecord([mkPerson('a'), mkPerson('b')], [forA, forB]);
    const seriesA = labSeries(record, 'a', 'LDL');
    expect(seriesA).toHaveLength(1);
    expect(seriesA[0].eventId).toBe('l8');
  });

  it('ignores a lab payload attached to a non-lab event type (defense-in-depth, code-review finding 2)', () => {
    // A `lab` payload sitting on some other event type shouldn't happen through the UI,
    // but a hand-crafted/corrupt backup could smuggle one past isValidEvent (which only
    // shape-checks the payload, not which event `type` it's attached to).
    const wrongType: TimelineEvent = {
      id: 'l10',
      person: 'a',
      year: 2020,
      type: 'procedure',
      title: 'X',
      detail: '',
      lab: { value: 5, unit: 'x' },
    };
    const record = mkRecord([mkPerson('a')], [wrongType]);
    expect(labSeries(record, 'a', 'X')).toEqual([]);
  });
});

describe('labTitles', () => {
  it('returns distinct titles, deduplicated case-insensitively', () => {
    const record = mkRecord(
      [mkPerson('a')],
      [
        {
          id: 't1',
          person: 'a',
          year: 2020,
          type: 'lab',
          title: 'HbA1c',
          detail: '',
          lab: { value: 5.4, unit: '%' },
        },
        {
          id: 't2',
          person: 'a',
          year: 2021,
          type: 'lab',
          title: ' hba1c ',
          detail: '',
          lab: { value: 5.6, unit: '%' },
        },
        {
          id: 't3',
          person: 'a',
          year: 2020,
          type: 'lab',
          title: 'LDL',
          detail: '',
          lab: { value: 130, unit: 'mg/dL' },
        },
      ],
    );
    expect(labTitles(record, 'a')).toEqual(['HbA1c', 'LDL']);
  });

  it('preserves the first-seen casing when a later duplicate uses different casing', () => {
    const record = mkRecord(
      [mkPerson('a')],
      [
        {
          id: 't4',
          person: 'a',
          year: 2019,
          type: 'lab',
          title: 'ldl',
          detail: '',
          lab: { value: 120, unit: 'mg/dL' },
        },
        {
          id: 't5',
          person: 'a',
          year: 2020,
          type: 'lab',
          title: 'LDL',
          detail: '',
          lab: { value: 130, unit: 'mg/dL' },
        },
      ],
    );
    expect(labTitles(record, 'a')).toEqual(['ldl']);
  });

  it('excludes titles from events without a lab payload', () => {
    const record = mkRecord(
      [mkPerson('a')],
      [
        {
          id: 't6',
          person: 'a',
          year: 2020,
          type: 'diagnosis',
          title: 'Hypothyroidism',
          detail: '',
        },
      ],
    );
    expect(labTitles(record, 'a')).toEqual([]);
  });

  it("isolates by person — another person's lab titles are never returned", () => {
    const record = mkRecord(
      [mkPerson('a'), mkPerson('b')],
      [
        {
          id: 't7',
          person: 'a',
          year: 2020,
          type: 'lab',
          title: 'LDL',
          detail: '',
          lab: { value: 130, unit: 'mg/dL' },
        },
        {
          id: 't8',
          person: 'b',
          year: 2020,
          type: 'lab',
          title: 'HbA1c',
          detail: '',
          lab: { value: 5.4, unit: '%' },
        },
      ],
    );
    expect(labTitles(record, 'a')).toEqual(['LDL']);
    expect(labTitles(record, 'b')).toEqual(['HbA1c']);
  });

  it('ignores a lab payload attached to a non-lab event type (defense-in-depth, code-review finding 2)', () => {
    const wrongType: TimelineEvent = {
      id: 't9',
      person: 'a',
      year: 2020,
      type: 'procedure',
      title: 'X',
      detail: '',
      lab: { value: 5, unit: 'x' },
    };
    const record = mkRecord([mkPerson('a')], [wrongType]);
    expect(labTitles(record, 'a')).toEqual([]);
  });
});
