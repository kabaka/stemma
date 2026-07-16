import { describe, expect, it } from 'vitest';
import {
  buildNativeBackup,
  NATIVE_BACKUP_KIND,
  NATIVE_BACKUP_VERSION,
  type NativeBackup,
} from './native';
import { parseNativeBackup } from '@/import/native';
import { seedRecord } from '@/data/seed';
import type { Condition, TimelineEvent } from '@/domain/types';

const EXT: Condition[] = [
  { id: 'C99.9', name: 'Custom long-tail condition', cat: 'other', base: 0.1, pattern: 'Unknown' },
];

describe('buildNativeBackup', () => {
  it('wraps the record and extensions in a versioned envelope', () => {
    const record = seedRecord();
    const json = buildNativeBackup(record, EXT, { now: '2026-07-15T00:00:00.000Z' });
    const parsed = JSON.parse(json) as NativeBackup;

    expect(parsed.kind).toBe(NATIVE_BACKUP_KIND);
    expect(parsed.version).toBe(NATIVE_BACKUP_VERSION);
    expect(parsed.generatedAt).toBe('2026-07-15T00:00:00.000Z');
    expect(parsed.record.probandId).toBe(record.probandId);
    expect(parsed.record.people).toHaveLength(record.people.length);
    expect(parsed.extensions).toEqual(EXT);
  });

  it('is deterministic given the same inputs (no wall-clock read)', () => {
    const record = seedRecord();
    const a = buildNativeBackup(record, EXT, { now: '2026-01-01T00:00:00.000Z' });
    const b = buildNativeBackup(record, EXT, { now: '2026-01-01T00:00:00.000Z' });
    expect(a).toBe(b);
  });

  it('omits generatedAt when no timestamp is injected', () => {
    const parsed = JSON.parse(buildNativeBackup(seedRecord())) as NativeBackup;
    expect(parsed.generatedAt).toBeUndefined();
    expect(parsed.extensions).toEqual([]);
  });

  it('round-trips losslessly through parseNativeBackup', () => {
    const record = seedRecord();
    const restored = parseNativeBackup(buildNativeBackup(record, EXT, { now: 'x' }));
    expect(restored.data).not.toBeNull();
    expect(restored.data?.record).toEqual(record);
    expect(restored.data?.extensions).toEqual(EXT);
    expect(restored.warnings).toEqual([]);
  });

  it('round-trips new timeline event fields (med/lab/vital/allergy/immunization/attachments) verbatim', () => {
    const record = seedRecord();
    const newEvents: TimelineEvent[] = [
      {
        id: 'rt-med',
        person: 'you',
        year: 2024,
        type: 'medication',
        title: 'Started Metformin',
        detail: '',
        med: { dose: '500mg BID', ongoing: true },
      },
      {
        id: 'rt-lab',
        person: 'you',
        year: 2024,
        type: 'lab',
        title: 'LDL',
        detail: '',
        lab: { value: 130, unit: 'mg/dL', refLow: 0, refHigh: 100 },
      },
      {
        id: 'rt-vital',
        person: 'you',
        year: 2024,
        type: 'vital',
        title: 'Blood pressure',
        detail: '',
        vital: { value: 128, unit: 'mmHg' },
      },
      {
        id: 'rt-allergy',
        person: 'you',
        year: 2024,
        type: 'allergy',
        title: 'Penicillin allergy',
        detail: '',
        allergy: { substance: 'Penicillin', reaction: 'Hives', severity: 'moderate' },
      },
      {
        id: 'rt-imm',
        person: 'you',
        year: 2024,
        type: 'immunization',
        title: 'Flu shot',
        detail: '',
        immunization: { vaccine: 'Influenza', doseLabel: '2024-25' },
      },
      {
        id: 'rt-att',
        person: 'you',
        year: 2024,
        type: 'procedure',
        title: 'Colonoscopy',
        detail: '',
        attachments: [
          { id: 'att-1', name: 'report.pdf', note: 'Path report', mediaType: 'application/pdf' },
        ],
      },
    ];
    record.timeline = [...record.timeline, ...newEvents];

    const restored = parseNativeBackup(
      buildNativeBackup(record, [], { now: '2026-07-16T00:00:00.000Z' }),
    );
    expect(restored.data).not.toBeNull();
    expect(restored.data?.record).toEqual(record);
    expect(restored.warnings).toEqual([]);
  });

  it('keeps the import-side format constants in lock-step', () => {
    // The importer restates these constants (layering bars import→export); a drift here
    // would silently break restore, so assert the values the export side commits to.
    expect(NATIVE_BACKUP_KIND).toBe('stemma.backup');
    expect(NATIVE_BACKUP_VERSION).toBe(1);
  });
});
