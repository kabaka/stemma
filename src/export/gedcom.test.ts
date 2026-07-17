import { describe, it, expect } from 'vitest';
import { buildGedcom } from './gedcom';
import { seedRecord } from '@/data/seed';
import type { FamilyRecord, Person } from '@/domain/types';

/** Minimal fixture person for edge cases the seed family doesn't cover. */
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

  it('records a conditions NOTE carrying the onset age (Robert)', () => {
    const robertRec = records.find((r) => r.startsWith(`0 ${xref('robert')} INDI`));
    expect(robertRec).toBeDefined();
    expect(robertRec).toMatch(/NOTE Conditions:.*onset 60/);
  });
});

describe('buildGedcom (edge cases)', () => {
  it('emits "1 DEAT Y" for a dead person with no known death year', () => {
    const record: FamilyRecord = {
      people: [mkPerson('d1', { dead: true, birth: 1950, death: null, isProband: true })],
      unions: [],
      timeline: [],
      probandId: 'd1',
    };
    const gedcom = buildGedcom(record);
    expect(gedcom).toContain('1 DEAT Y');
    // And not a dated death (no "2 DATE" line would follow a DEAT with no year).
    expect(gedcom).not.toMatch(/1 DEAT\n2 DATE/);
  });

  it('assigns HUSB + WIFE for a same-sab union without dropping a partner', () => {
    const record: FamilyRecord = {
      people: [
        mkPerson('w1', { name: 'Partner One', sab: 'f', isProband: true }),
        mkPerson('w2', { name: 'Partner Two', sab: 'f' }),
      ],
      unions: [{ parents: ['w1', 'w2'], children: [] }],
      timeline: [],
      probandId: 'w1',
    };
    const gedcom = buildGedcom(record);
    const records = gedcom.split(/\n(?=0 )/);
    const xref = (id: string) => `@I${record.people.findIndex((p) => p.id === id) + 1}@`;
    const fam = records.find((r) => r.startsWith('0 @F1@ FAM'))!;
    expect(fam).toContain(`1 HUSB ${xref('w2')}`);
    expect(fam).toContain(`1 WIFE ${xref('w1')}`);
  });

  it('exports a UAAB (sab "x") person as "1 SEX U" — documented-lossy, same as unknown', () => {
    const record: FamilyRecord = {
      people: [mkPerson('u1', { sab: 'x', isProband: true })],
      unions: [],
      timeline: [],
      probandId: 'u1',
    };
    const gedcom = buildGedcom(record);
    expect(gedcom).toContain('1 SEX U');
  });
});
