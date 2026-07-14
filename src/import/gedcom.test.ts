import { describe, expect, it } from 'vitest';
import { buildRecordFromGedcom, parseGedcom } from './gedcom';
import { buildGedcom } from '@/export/gedcom';
import { seedRecord } from '@/data/seed';

/** A small, hand-written GEDCOM covering the shapes a real Ancestry-style export uses. */
const SAMPLE = `0 HEAD
1 SOUR Ancestry.com
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME John /Smith/
1 SEX M
1 BIRT
2 DATE 12 NOV 1948
1 DEAT
2 DATE ABT 2010
0 @I2@ INDI
1 NAME Mary /Smith/
1 SEX F
1 BIRT
2 DATE 1950
0 @I3@ INDI
1 NAME Jane /Smith/
1 SEX F
1 BIRT
2 DATE 1975
0 @I4@ INDI
1 NAME Peter /Jones/
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
0 @F2@ FAM
1 HUSB @I4@
1 WIFE @I3@
0 TRLR
`;

describe('parseGedcom', () => {
  const parsed = parseGedcom(SAMPLE);

  it('extracts every individual with a cleaned name and sab from SEX', () => {
    expect(parsed.individuals.map((i) => i.id)).toEqual(['I1', 'I2', 'I3', 'I4']);
    const john = parsed.individuals.find((i) => i.id === 'I1')!;
    expect(john.name).toBe('John Smith'); // surname slashes stripped
    expect(john.sab).toBe('m');
  });

  it('reads only the year out of assorted GEDCOM date forms', () => {
    const john = parsed.individuals.find((i) => i.id === 'I1')!;
    expect(john.birth).toBe(1948); // "12 NOV 1948" — day/month ignored
    expect(john.death).toBe(2010); // "ABT 2010"
    expect(john.dead).toBe(true);
  });

  it('marks the living as not dead with a null death year', () => {
    const mary = parsed.individuals.find((i) => i.id === 'I2')!;
    expect(mary.dead).toBe(false);
    expect(mary.death).toBeNull();
    expect(mary.birth).toBe(1950);
  });

  it('leaves an unknown SEX as sab "u" and an unknown birth as null', () => {
    const peter = parsed.individuals.find((i) => i.id === 'I4')!;
    expect(peter.sab).toBe('u');
    expect(peter.birth).toBeNull();
  });

  it('reads families with parents (HUSB/WIFE) and children (CHIL)', () => {
    const f1 = parsed.families.find((f) => f.children.includes('I3'))!;
    expect(f1.parents).toEqual(['I1', 'I2']);
    expect(f1.children).toEqual(['I3']);
  });
});

describe('buildRecordFromGedcom', () => {
  it('builds a laid-out record: derived generations, a proband, and no conditions', () => {
    const record = buildRecordFromGedcom(parseGedcom(SAMPLE))!;
    expect(record).not.toBeNull();
    const by = (id: string) => record.people.find((p) => p.id === id)!;
    // Parents older than child (lower gen), normalised so the oldest is 0.
    expect(by('I1').gen).toBe(0);
    expect(by('I2').gen).toBe(0);
    expect(by('I3').gen).toBe(1);
    // Structural import carries no health data.
    expect(record.people.every((p) => p.conds.length === 0)).toBe(true);
    // Display gender defaulted from sab, editable later.
    expect(by('I1').gender).toBe('man');
    expect(by('I2').gender).toBe('woman');
    expect(by('I4').gender).toBe('nb'); // unknown sab
  });

  it('defaults the proband to the first individual and marks exactly one', () => {
    const record = buildRecordFromGedcom(parseGedcom(SAMPLE))!;
    expect(record.probandId).toBe('I1');
    expect(record.people.filter((p) => p.isProband)).toHaveLength(1);
    expect(record.people.find((p) => p.isProband)!.id).toBe('I1');
  });

  it('honours an explicit proband choice', () => {
    const record = buildRecordFromGedcom(parseGedcom(SAMPLE), 'I3')!;
    expect(record.probandId).toBe('I3');
    expect(record.people.find((p) => p.isProband)!.id).toBe('I3');
  });

  it('falls back to the first individual when the chosen proband is unknown', () => {
    const record = buildRecordFromGedcom(parseGedcom(SAMPLE), 'nope')!;
    expect(record.probandId).toBe('I1');
  });

  it('returns null when there is nothing to import', () => {
    expect(buildRecordFromGedcom(parseGedcom('0 HEAD\n0 TRLR\n'))).toBeNull();
  });
});

describe('parseGedcom (leniency — never throws on real-world quirks)', () => {
  it('handles a BOM, CRLF line endings, and blank lines', () => {
    const text = '\uFEFF0 HEAD\r\n\r\n0 @I1@ INDI\r\n1 NAME Ann /Lee/\r\n1 SEX F\r\n0 TRLR\r\n';
    const parsed = parseGedcom(text);
    expect(parsed.individuals).toHaveLength(1);
    expect(parsed.individuals[0].name).toBe('Ann Lee');
  });

  it('skips a family link to a nonexistent individual and warns about it', () => {
    const text = `0 @I1@ INDI
1 NAME Solo /One/
1 SEX M
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I9@
1 CHIL @I8@
0 TRLR
`;
    const parsed = parseGedcom(text);
    const fam = parsed.families[0];
    expect(fam.parents).toEqual(['I1']); // @I9@ dropped
    expect(fam.children).toEqual([]); // @I8@ dropped
    expect(parsed.warnings.some((w) => /unknown/.test(w))).toBe(true);
  });

  it('warns when the file contains no individuals', () => {
    const parsed = parseGedcom('0 HEAD\n1 SOUR X\n0 TRLR\n');
    expect(parsed.individuals).toHaveLength(0);
    expect(parsed.warnings.some((w) => /No individuals/.test(w))).toBe(true);
  });

  it('assembles a name from GIVN/SURN when NAME has no value, else "(unknown)"', () => {
    const text = `0 @I1@ INDI
1 NAME
2 GIVN Robert
2 SURN Adams
0 @I2@ INDI
1 SEX F
0 TRLR
`;
    const parsed = parseGedcom(text);
    expect(parsed.individuals.find((i) => i.id === 'I1')!.name).toBe('Robert Adams');
    expect(parsed.individuals.find((i) => i.id === 'I2')!.name).toBe('(unknown)');
  });

  it('does not throw on empty or junk input', () => {
    expect(() => parseGedcom('')).not.toThrow();
    expect(() => parseGedcom('not gedcom at all\n\n???')).not.toThrow();
    expect(parseGedcom('').individuals).toEqual([]);
  });
});

describe('GEDCOM round-trip (export → import preserves the graph)', () => {
  const original = seedRecord();
  const reparsed = buildRecordFromGedcom(parseGedcom(buildGedcom(original)))!;

  it('preserves every person with name, sab, birth and death', () => {
    expect(reparsed.people).toHaveLength(original.people.length);
    for (const before of original.people) {
      const after = reparsed.people.find((p) => p.name === before.name)!;
      expect(after).toBeDefined();
      expect(after.sab).toBe(before.sab);
      expect(after.birth).toBe(before.birth);
      expect(after.dead).toBe(before.dead);
      expect(after.death).toBe(before.death);
    }
  });

  it('preserves the parent/child structure of every union', () => {
    const nameOf = (rec: typeof original, id: string) => rec.people.find((p) => p.id === id)!.name;
    // Represent each union as sorted parent-name / child-name sets, order-independent.
    const shape = (rec: typeof original) =>
      rec.unions
        .map((u) => ({
          parents: u.parents.map((id) => nameOf(rec, id)).sort(),
          children: u.children.map((id) => nameOf(rec, id)).sort(),
        }))
        .sort((a, b) => (a.parents[0] ?? '').localeCompare(b.parents[0] ?? ''));
    expect(shape(reparsed)).toEqual(shape(original));
  });

  it('re-derives generations consistent with the original parent→child ordering', () => {
    const genByName = new Map(reparsed.people.map((p) => [p.name, p.gen]));
    for (const u of original.unions) {
      const parentNames = u.parents.map((id) => original.people.find((p) => p.id === id)!.name);
      const childNames = u.children.map((id) => original.people.find((p) => p.id === id)!.name);
      for (const pn of parentNames)
        for (const cn of childNames) expect(genByName.get(cn)! - genByName.get(pn)!).toBe(1);
    }
  });
});
