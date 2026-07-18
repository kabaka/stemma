/**
 * Oracle for the W2 full-timeline import ENGINE additions to `src/import/health-record.ts` —
 * the source-agnostic `events` path through `ParsedEvent` / `StagedEvent` shared by every
 * importer (FHIR today; a future C-CDA vitals/meds section would reuse it identically). This
 * file does not re-litigate the per-resource FHIR parsing rules (status buckets, referenceRange,
 * genomic dispatch, …) — that's `fhir.test.ts`'s job. It covers what is genuinely engine-level:
 * the deterministic `parseId` contract, dedup against an existing timeline, the proband guard,
 * `prov: 'record'` attribution, an events-only selection, and the `coding: []` → `undefined`
 * normalization `applyHealthRecordImport` performs on merge.
 *
 * Uses the FHIR parser + fixtures as a convenient, realistic source of `ParsedEvent`s — the W2
 * engine has no FHIR-specific logic of its own, so exercising it through a real parse keeps this
 * oracle honest (no hand-rolled `ParsedEvent` shapes that could silently drift from what a real
 * importer actually produces).
 */
import { describe, expect, it } from 'vitest';
import { parseFhirImport } from './fhir';
import { applyHealthRecordImport, stageHealthRecordImport } from './health-record';
import {
  SYS,
  fhirBundle,
  medicationStatementResource,
  patientResource,
  procedureResource,
} from './fixtures/fhir';
import { buildCatalog } from '@/domain/catalog';
import { emptyRecord, seedRecord } from '@/data/seed';
import type { FamilyRecord } from '@/domain/types';

const catalog = buildCatalog([]);

const RXNORM_METFORMIN = { system: SYS.rxnorm, code: '860975', display: 'Metformin' };

function medBundle(id = 'ms1') {
  return fhirBundle([
    patientResource(),
    medicationStatementResource({
      id,
      status: 'active',
      medicationCodings: [RXNORM_METFORMIN],
      effectiveDateTime: '2020-05-01',
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Deterministic parseId
// ---------------------------------------------------------------------------

describe('W2 engine — deterministic parseId', () => {
  it('an event parseId is exactly `fhir:<ResourceType>:<resource.id>`', () => {
    const parsed = parseFhirImport(medBundle('my-med-1'));
    expect(parsed.proband.events).toHaveLength(1);
    expect(parsed.proband.events[0].parseId).toBe('fhir:MedicationStatement:my-med-1');
  });

  it('parsing the same bundle twice yields the identical parseId both times (pure, deterministic)', () => {
    const bundle = medBundle('stable-id');
    const a = parseFhirImport(bundle).proband.events[0].parseId;
    const b = parseFhirImport(bundle).proband.events[0].parseId;
    expect(a).toBe(b);
    expect(a).toBe('fhir:MedicationStatement:stable-id');
  });
});

// ---------------------------------------------------------------------------
// Dedup: two identical sync cycles
// ---------------------------------------------------------------------------

describe('W2 engine — dedup against an already-imported timeline', () => {
  it('a first sync stages the event as new; a second sync against the now-updated record stages it as duplicate, and applying it again is a no-op', () => {
    const bundle = medBundle('ms-dedup');
    const record0 = emptyRecord();

    // First sync: new -> select -> apply.
    const parsed = parseFhirImport(bundle);
    const staged1 = stageHealthRecordImport(parsed, record0, catalog);
    expect(staged1.events).toHaveLength(1);
    expect(staged1.events[0].status).toBe('new');
    expect(staged1.events[0].defaultSelected).toBe(true);

    const { record: record1 } = applyHealthRecordImport(
      record0,
      staged1,
      { selectedParseIds: new Set(staged1.events.map((e) => e.parseId)) },
      catalog,
    );
    expect(record1.timeline).toHaveLength(1);

    // Second sync against the SAME bundle, now that record1 already carries the imported event.
    const staged2 = stageHealthRecordImport(parseFhirImport(bundle), record1, catalog);
    expect(staged2.events).toHaveLength(1);
    expect(staged2.events[0].status).toBe('duplicate');
    expect(staged2.events[0].defaultSelected).toBe(false);

    // Applying it again — even if the UI selected it anyway — must not grow the timeline.
    const { record: record2 } = applyHealthRecordImport(
      record1,
      staged2,
      { selectedParseIds: new Set(staged2.events.map((e) => e.parseId)) },
      catalog,
    );
    expect(record2.timeline).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// prov: 'record' + person === probandId
// ---------------------------------------------------------------------------

describe('W2 engine — every applied event is attributed to the record and the proband', () => {
  it('an applied event carries prov: "record" and person === probandId', () => {
    const record = seedRecord();
    const parsed = parseFhirImport(medBundle());
    const staged = stageHealthRecordImport(parsed, record, catalog);
    const { record: applied } = applyHealthRecordImport(
      record,
      staged,
      { selectedParseIds: new Set(staged.events.map((e) => e.parseId)) },
      catalog,
    );
    const added = applied.timeline.find((e) => e.id === 'fhir:MedicationStatement:ms1');
    expect(added).toBeDefined();
    expect(added?.prov).toBe('record');
    expect(added?.person).toBe(record.probandId);
  });
});

// ---------------------------------------------------------------------------
// Events-only selection
// ---------------------------------------------------------------------------

describe('W2 engine — an events-only selection applies (no conditions selected)', () => {
  it('selecting only an event parseId applies that event and nothing else', () => {
    const record = seedRecord();
    const parsed = parseFhirImport(medBundle());
    const staged = stageHealthRecordImport(parsed, record, catalog);
    expect(staged.probandConditions).toHaveLength(0); // this fixture carries no Condition resource
    expect(staged.events).toHaveLength(1);

    const { record: applied } = applyHealthRecordImport(
      record,
      staged,
      { selectedParseIds: new Set([staged.events[0].parseId]) },
      catalog,
    );
    expect(applied.timeline).toHaveLength(record.timeline.length + 1);
    expect(applied.timeline.some((e) => e.type === 'medication')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// coding: [] -> undefined on apply
// ---------------------------------------------------------------------------

describe('W2 engine — an empty coding[] normalizes to undefined on the applied TimelineEvent', () => {
  it('a staged event with coding: [] (no verified system present) applies with coding undefined, not []', () => {
    const bundle = fhirBundle([
      patientResource(),
      procedureResource({
        id: 'proc-uncoded',
        status: 'completed',
        performedDateTime: '2018-09-01',
        codings: [{ system: SYS.proprietary, code: 'LOCAL-1', display: 'Local vendor procedure' }],
      }),
    ]);
    const record = emptyRecord();
    const staged = stageHealthRecordImport(parseFhirImport(bundle), record, catalog);
    expect(staged.events[0].coding).toEqual([]);

    const { record: applied } = applyHealthRecordImport(
      record,
      staged,
      { selectedParseIds: new Set(staged.events.map((e) => e.parseId)) },
      catalog,
    );
    const added = applied.timeline.find((e) => e.id === 'fhir:Procedure:proc-uncoded');
    expect(added).toBeDefined();
    expect(added?.coding).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// A resource missing `id` is dropped + counted
// ---------------------------------------------------------------------------

describe('W2/W3 — a resource with no `id` is dropped and counted, never fabricated an id', () => {
  it('a MedicationStatement with no `id` field yields no event and a warning, never a synthesized parseId', () => {
    const bundle = fhirBundle([
      patientResource(),
      {
        resourceType: 'MedicationStatement',
        status: 'active',
        subject: { reference: 'Patient/pat-1' },
        medicationCodeableConcept: { coding: [RXNORM_METFORMIN] },
        effectiveDateTime: '2020-01-01',
      },
    ]);
    const parsed = parseFhirImport(bundle);
    expect(parsed.proband.events).toHaveLength(0);
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The proband guard: no matching probandPerson -> apply is a no-op for events
// ---------------------------------------------------------------------------

describe('W2 engine — the proband guard: events only apply when probandPerson exists', () => {
  it('applyHealthRecordImport never pushes an event when record.probandId resolves to no person', () => {
    const ghostRecord: FamilyRecord = { ...emptyRecord(), people: [] }; // probandId 'you' with no matching Person
    const parsed = parseFhirImport(medBundle());
    const staged = stageHealthRecordImport(parsed, ghostRecord, catalog);
    expect(staged.events).toHaveLength(1); // staging is read-only and still reports the suggestion

    const { record: applied } = applyHealthRecordImport(
      ghostRecord,
      staged,
      { selectedParseIds: new Set(staged.events.map((e) => e.parseId)) },
      catalog,
    );
    expect(applied.timeline).toHaveLength(0);
  });
});
