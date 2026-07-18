/**
 * Component test for the Wave 2/3 full-timeline import's "Health events" section of
 * {@link CcdaReview} — the source-agnostic staged-events review UI shared by every
 * health-record importer. C-CDA parses always carry `events: []` (see `ccda.test.ts` and
 * `views.test.tsx`'s own "CcdaImport / CcdaReview" suite for that untouched path, which
 * this file must not regress); this suite covers the FHIR-sourced events path plus the
 * cross-cutting "no events -> no section" regression that keeps C-CDA's rendering identical
 * to before Wave 2/3.
 *
 * Builds staged input through the real parse -> stage pipeline (`parseFhirImport` /
 * `parseCcda` + `stageHealthRecordImport` / `stageCcdaImport` against real fixtures),
 * matching `SmartFhirConnect.test.tsx`'s own approach — no hand-rolled `StagedEvent` shapes
 * that could silently drift from what a real importer actually produces.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CcdaReview } from './CcdaReview';
import {
  parseCcda,
  parseFhirImport,
  stageCcdaImport,
  stageHealthRecordImport,
  type HealthRecordSelections,
} from '@/import';
import {
  SYS,
  allergyIntoleranceResource,
  fhirBundle,
  immunizationResource,
  medicationStatementResource,
  observationResource,
  patientResource,
} from '@/import/fixtures/fhir';
import { ccdaDoc } from '@/import/fixtures/ccda';
import { buildCatalog } from '@/domain/catalog';
import { seedRecord } from '@/data/seed';
import type { FamilyRecord } from '@/domain/types';

const catalog = buildCatalog([]);

function medBundle(id = 'ms1') {
  return fhirBundle([
    patientResource(),
    medicationStatementResource({
      id,
      status: 'active',
      medicationCodings: [{ system: SYS.rxnorm, code: '860975', display: 'Metformin' }],
      dosageText: '500mg twice daily',
      effectiveDateTime: '2020-05-01',
    }),
  ]);
}

describe('CcdaReview — Health events section (Wave 2/3 full-timeline import)', () => {
  it('an events-only staged import does not leave the confirm button stuck disabled, and confirming selects the event', async () => {
    const user = userEvent.setup();
    const record = seedRecord();
    const parsed = parseFhirImport(medBundle());
    const staged = stageHealthRecordImport(parsed, record, catalog);
    expect(staged.probandConditions).toHaveLength(0);
    expect(staged.familyMembers).toHaveLength(0);
    expect(staged.events).toHaveLength(1);
    expect(staged.events[0].defaultSelected).toBe(true);

    const onConfirm = vi.fn();
    render(<CcdaReview staged={staged} record={record} onConfirm={onConfirm} onCancel={vi.fn()} />);

    const confirmBtn = screen.getByRole('button', { name: /import selected items/i });
    // The highest-value regression this wave introduces: an import with nothing BUT events
    // must not read as "nothing to import" just because probandConditions/familyMembers are empty.
    expect(confirmBtn).toHaveAttribute('aria-disabled', 'false');

    await user.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [selections] = onConfirm.mock.calls[0] as [HealthRecordSelections];
    expect(selections.selectedParseIds.has(staged.events[0].parseId)).toBe(true);
  });

  it('groups events into labelled sub-sections by type, one heading per type actually present', () => {
    const record = seedRecord();
    const bundle = fhirBundle([
      patientResource(),
      medicationStatementResource({
        id: 'ms1',
        status: 'active',
        medicationCodings: [{ system: SYS.rxnorm, code: '860975', display: 'Metformin' }],
        effectiveDateTime: '2020-05-01',
      }),
      observationResource({
        id: 'lab1',
        category: 'laboratory',
        status: 'final',
        codings: [{ system: SYS.loinc, code: '4548-4', display: 'Hemoglobin A1c' }],
        effectiveDateTime: '2021-01-01',
        valueQuantity: { value: 7.1, unit: '%' },
      }),
      immunizationResource({
        id: 'imm1',
        status: 'completed',
        occurrenceDateTime: '2019-10-01',
        vaccineText: 'Influenza vaccine',
        doseNumber: 2,
      }),
    ]);
    const staged = stageHealthRecordImport(parseFhirImport(bundle), record, catalog);
    expect(staged.events).toHaveLength(3);

    render(<CcdaReview staged={staged} record={record} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Health events' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Medications' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Labs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Immunizations' })).toBeInTheDocument();
    // Never an empty group heading for a type that carried no events this import.
    expect(screen.queryByRole('heading', { name: 'Allergies' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Vitals' })).not.toBeInTheDocument();

    expect(screen.getByText('Metformin')).toBeInTheDocument();
    expect(screen.getByText('Hemoglobin A1c')).toBeInTheDocument();
    expect(screen.getByText('Influenza vaccine')).toBeInTheDocument();
  });

  it('Health events is a heading one level below the default h2, and each sub-section is one level below that', () => {
    const record = seedRecord();
    const staged = stageHealthRecordImport(parseFhirImport(medBundle()), record, catalog);

    render(<CcdaReview staged={staged} record={record} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Health events' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Medications' })).toBeInTheDocument();
  });

  it('disables a duplicate event row (re-sync of an already-imported event) and never checks it by default', () => {
    const base = seedRecord();
    const record: FamilyRecord = {
      ...base,
      timeline: [
        ...base.timeline,
        {
          id: 'fhir:MedicationStatement:ms-dup',
          person: base.probandId,
          year: 2020,
          type: 'medication',
          title: 'Metformin',
          detail: '',
          prov: 'record',
        },
      ],
    };
    const staged = stageHealthRecordImport(parseFhirImport(medBundle('ms-dup')), record, catalog);
    expect(staged.events[0].status).toBe('duplicate');
    expect(staged.events[0].defaultSelected).toBe(false);

    render(<CcdaReview staged={staged} record={record} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    const checkbox = screen.getByRole('checkbox', { name: /Metformin/i });
    expect(checkbox).toBeDisabled();
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText('Already recorded')).toBeInTheDocument();
  });

  it('renders the source-transcribed reference range for a lab result, and never an in/out-of-range flag or interpretation', () => {
    const record = seedRecord();
    const bundle = fhirBundle([
      patientResource(),
      observationResource({
        id: 'lab-range',
        category: 'laboratory',
        status: 'final',
        codings: [{ system: SYS.loinc, code: '4548-4', display: 'Hemoglobin A1c' }],
        effectiveDateTime: '2021-01-01',
        valueQuantity: { value: 7.1, unit: '%' },
        referenceRanges: [{ low: { value: 4, unit: '%' }, high: { value: 6, unit: '%' } }],
      }),
    ]);
    const staged = stageHealthRecordImport(parseFhirImport(bundle), record, catalog);
    expect(staged.events[0].lab?.refLow).toBe(4);
    expect(staged.events[0].lab?.refHigh).toBe(6);

    render(<CcdaReview staged={staged} record={record} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    // The exact, source-attributed wording — never an unattributed "normal range".
    expect(screen.getByText('Reference range (from this record): 4–6 %')).toBeInTheDocument();
    expect(screen.getByText(/7\.1 %/)).toBeInTheDocument();
    // Guardrail #1: Stemma never ships a built-in "normal" range and never flags the value
    // against it — no interpretation word or in/out-of-range flag anywhere on the page.
    expect(
      screen.queryByText(/abnormal|out of range|in range|\bnormal\b|\bhigh\b|\blow\b/i),
    ).not.toBeInTheDocument();
  });

  it('renders allergy substance/reaction/severity as plain text, never colour-alone', () => {
    const record = seedRecord();
    const bundle = fhirBundle([
      patientResource(),
      allergyIntoleranceResource({
        id: 'allergy1',
        verificationStatus: 'confirmed',
        text: 'Penicillin',
        reactions: [{ manifestationText: 'Rash', severity: 'severe' }],
        onsetDateTime: '2015-01-01',
      }),
    ]);
    const staged = stageHealthRecordImport(parseFhirImport(bundle), record, catalog);

    render(<CcdaReview staged={staged} record={record} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText('Penicillin')).toBeInTheDocument();
    expect(screen.getByText(/Rash/)).toBeInTheDocument();
    expect(screen.getByText(/severe/)).toBeInTheDocument();
  });

  it('a C-CDA-style staged import (events: []) renders with no Health-events section at all — unchanged behavior', () => {
    const record = seedRecord();
    const parsed = parseCcda(
      ccdaDoc({
        patientBirthTime: '19700101',
        problems: [
          {
            system: 'ICD-10-CM',
            code: 'C50.919',
            displayName: 'Breast cancer',
            onsetDate: '20200101',
          },
        ],
      }),
    );
    expect(parsed.proband.events).toEqual([]);
    const staged = stageCcdaImport(parsed, record, catalog);
    expect(staged.events).toEqual([]);

    render(<CcdaReview staged={staged} record={record} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 2, name: /your conditions/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /family members/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /health events/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Medications')).not.toBeInTheDocument();
  });

  it('the single ClinicalBoundary at the top still covers the whole surface (no duplicate added for the events section)', () => {
    const record = seedRecord();
    const staged = stageHealthRecordImport(parseFhirImport(medBundle()), record, catalog);

    render(<CcdaReview staged={staged} record={record} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getAllByRole('note', { name: /clinical boundary/i })).toHaveLength(1);
  });
});
