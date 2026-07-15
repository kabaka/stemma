import { describe, expect, it } from 'vitest';
import { parseNativeBackup } from './native';
import { buildNativeBackup } from '@/export/native';
import { seedRecord } from '@/data/seed';
import type { Condition } from '@/domain/types';

const backupOf = (record = seedRecord(), ext: Condition[] = []) =>
  buildNativeBackup(record, ext, { now: '2026-07-15T00:00:00.000Z' });

describe('parseNativeBackup', () => {
  it('restores a well-formed backup', () => {
    const record = seedRecord();
    const res = parseNativeBackup(backupOf(record));
    expect(res.data?.record.probandId).toBe(record.probandId);
    expect(res.warnings).toEqual([]);
  });

  it('rejects non-JSON', () => {
    const res = parseNativeBackup('not json {');
    expect(res.data).toBeNull();
    expect(res.warnings[0]).toMatch(/not valid JSON/i);
  });

  it('rejects a foreign JSON file (wrong kind)', () => {
    const res = parseNativeBackup(JSON.stringify({ kind: 'something.else', record: {} }));
    expect(res.data).toBeNull();
    expect(res.warnings[0]).toMatch(/not a Stemma backup/i);
  });

  it('rejects a backup with an invalid record', () => {
    const res = parseNativeBackup(
      JSON.stringify({ kind: 'stemma.backup', version: 1, record: { people: [] } }),
    );
    expect(res.data).toBeNull();
    expect(res.warnings[0]).toMatch(/valid family record/i);
  });

  it('warns but still restores when the backup is from a newer version', () => {
    const env = JSON.parse(backupOf());
    env.version = 999;
    const res = parseNativeBackup(JSON.stringify(env));
    expect(res.data).not.toBeNull();
    expect(res.warnings.some((w) => /newer version/i.test(w))).toBe(true);
  });

  it('drops malformed extensions without failing the whole restore', () => {
    const good: Condition = {
      id: 'x1',
      name: 'Good',
      cat: 'other',
      base: 0.1,
      pattern: 'Unknown',
    };
    const env = JSON.parse(backupOf(seedRecord(), [good]));
    env.extensions.push({ id: 'bad' }); // missing required fields
    const res = parseNativeBackup(JSON.stringify(env));
    expect(res.data?.extensions).toEqual([good]);
    expect(res.warnings.some((w) => /skipped/i.test(w))).toBe(true);
  });

  it('drops an extension whose category is not a real CategoryKey (crash-safety)', () => {
    // An unknown `cat` would crash the pedigree/highlight views (CATEGORIES[cat].label).
    const env = JSON.parse(backupOf());
    env.extensions = [
      { id: 'x9', name: 'Bad category', cat: 'not-a-category', base: 0.1, pattern: 'Unknown' },
    ];
    const res = parseNativeBackup(JSON.stringify(env));
    expect(res.data?.extensions).toEqual([]);
    expect(res.warnings.some((w) => /skipped/i.test(w))).toBe(true);
  });

  it('never lets an extension redefine a curated condition (guardrail #1)', () => {
    // A hostile backup must not shadow curated clinical metadata the engine reads.
    const env = JSON.parse(backupOf());
    env.extensions = [
      { id: 'brca', name: 'Fake BRCA', cat: 'other', base: 99, pattern: 'Not real' },
    ];
    const res = parseNativeBackup(JSON.stringify(env));
    expect(res.data?.extensions).toEqual([]);
    expect(res.warnings.some((w) => /skipped/i.test(w))).toBe(true);
  });

  it('dedupes extensions by id', () => {
    const dupe: Condition = { id: 'dup', name: 'Dup', cat: 'other', base: 0.1, pattern: 'Unknown' };
    const env = JSON.parse(backupOf(seedRecord(), [dupe]));
    env.extensions.push({ ...dupe, name: 'Dup 2' });
    const res = parseNativeBackup(JSON.stringify(env));
    expect(res.data?.extensions).toHaveLength(1);
  });

  it('defaults extensions to an empty array when absent', () => {
    const env = JSON.parse(backupOf());
    delete env.extensions;
    const res = parseNativeBackup(JSON.stringify(env));
    expect(res.data?.extensions).toEqual([]);
  });
});
