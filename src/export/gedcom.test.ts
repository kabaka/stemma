import { describe, it, expect } from 'vitest';
import { buildGedcom } from './gedcom';
import { seedRecord } from '@/data/seed';

describe('buildGedcom', () => {
  const record = seedRecord();
  const gedcom = buildGedcom(record);
  const records = gedcom.split(/\n(?=0 )/);
  const xref = (id: string): string => `@I${record.people.findIndex((p) => p.id === id) + 1}@`;

  it('opens with a HEAD carrying the Stemma source and GEDCOM 5.5.1', () => {
    expect(gedcom.startsWith('0 HEAD')).toBe(true);
    expect(gedcom).toContain('1 SOUR Stemma');
    expect(gedcom).toContain('2 VERS 5.5.1');
    expect(gedcom).toContain('1 CHAR UTF-8');
  });

  it('terminates with a TRLR', () => {
    expect(gedcom.trimEnd().endsWith('0 TRLR')).toBe(true);
  });

  it('emits one INDI per person and one FAM per union', () => {
    expect(records.filter((r) => /^0 @I\d+@ INDI/.test(r)).length).toBe(record.people.length);
    expect(records.filter((r) => /^0 @F\d+@ FAM/.test(r)).length).toBe(record.unions.length);
  });

  it('emits an INDI for Maya with sex and birth', () => {
    const maya = records.find((r) => r.startsWith(`0 ${xref('you')} INDI`));
    expect(maya).toBeDefined();
    expect(maya).toContain('1 NAME Maya');
    expect(maya).toContain('1 SEX F');
    expect(maya).toContain('2 DATE 1988');
  });

  it('links the proband parents (Robert + Susan) to their children', () => {
    const fam = records.find(
      (r) =>
        r.startsWith('0 @F') &&
        r.includes(`1 HUSB ${xref('robert')}`) &&
        r.includes(`1 WIFE ${xref('susan')}`),
    );
    expect(fam).toBeDefined();
    expect(fam).toContain(`1 CHIL ${xref('jack')}`);
    expect(fam).toContain(`1 CHIL ${xref('you')}`);
    expect(fam).toContain(`1 CHIL ${xref('emma')}`);
  });
});
