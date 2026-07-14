import { describe, expect, it } from 'vitest';
import { seedRecord } from '@/data/seed';
import type { FamilyRecord, Person } from './types';
import { deriveGenerations, layoutFromGraph, linkRelative, removePerson } from './record';

/** Minimal fixture for a brand-new relative; linkRelative overwrites gen/x per relation. */
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

describe('linkRelative — partner', () => {
  it('creates a childless union between the anchor and the new partner, at the same generation', () => {
    const record = seedRecord();
    const anchor = record.people.find((p) => p.id === 'you')!;
    const partner = mkPerson('newpartner');
    const next = linkRelative(record, 'you', 'partner', partner);

    const union = next.unions.find(
      (u) => u.parents.includes('you') && u.parents.includes('newpartner'),
    );
    expect(union).toBeDefined();
    expect(union!.children).toEqual([]);
    const added = next.people.find((p) => p.id === 'newpartner')!;
    expect(added.gen).toBe(anchor.gen);
  });
});

describe('linkRelative — sibling', () => {
  it("joins the anchor's existing parental union, at the same generation", () => {
    const record = seedRecord();
    const anchor = record.people.find((p) => p.id === 'you')!;
    const before = record.unions.find((u) => u.children.includes('you'))!;

    const sibling = mkPerson('newsib');
    const next = linkRelative(record, 'you', 'sibling', sibling);

    // No new union was created — the same parental union grew a child.
    expect(next.unions).toHaveLength(record.unions.length);
    const after = next.unions.find(
      (u) => u.parents.includes('robert') && u.parents.includes('susan'),
    )!;
    expect(after.children).toEqual([...before.children, 'newsib']);
    const added = next.people.find((p) => p.id === 'newsib')!;
    expect(added.gen).toBe(anchor.gen);
  });
});

describe('linkRelative — parent', () => {
  it("creates a parental union for an anchor that doesn't have one, one generation up", () => {
    const record = seedRecord();
    const anchor = record.people.find((p) => p.id === 'walter')!;
    expect(record.unions.some((u) => u.children.includes('walter'))).toBe(false);

    const parent = mkPerson('newparent');
    const next = linkRelative(record, 'walter', 'parent', parent);

    expect(next.unions).toHaveLength(record.unions.length + 1);
    const union = next.unions.find((u) => u.children.includes('walter'))!;
    expect(union.parents).toContain('newparent');
    const added = next.people.find((p) => p.id === 'newparent')!;
    expect(added.gen).toBe(anchor.gen - 1);
  });

  it('refuses a third parent — a person has at most two — returning the same record reference', () => {
    const record = seedRecord();
    // Maya already has two recorded parents (Robert, Susan).
    const union = record.unions.find((u) => u.children.includes('you'))!;
    expect(union.parents).toEqual(['robert', 'susan']);

    const next = linkRelative(record, 'you', 'parent', mkPerson('third'));
    expect(next).toBe(record);
    expect(next.people.some((p) => p.id === 'third')).toBe(false);
  });
});

describe('linkRelative — child', () => {
  it("adds to the anchor's parental union one generation down, x averaging both parents", () => {
    const record = seedRecord();
    const anchor = record.people.find((p) => p.id === 'you')!;
    const alex = record.people.find((p) => p.id === 'alex')!;

    const child = mkPerson('newkid');
    const next = linkRelative(record, 'you', 'child', child);

    const union = next.unions.find((u) => u.parents.includes('you') && u.parents.includes('alex'))!;
    expect(union.children).toContain('newkid');
    const added = next.people.find((p) => p.id === 'newkid')!;
    expect(added.gen).toBe(anchor.gen + 1);
    expect(added.x).toBe((anchor.x + alex.x) / 2);
  });
});

describe('linkRelative — anchor not found', () => {
  it('returns the same record reference when neither the anchor nor a proband can be resolved', () => {
    // No person here carries isProband: true, so the anchor-resolution fallback fails too.
    const record: FamilyRecord = {
      people: [mkPerson('a'), mkPerson('b')],
      unions: [],
      timeline: [],
      probandId: 'a',
    };
    const next = linkRelative(record, 'nonexistent', 'child', mkPerson('c'));
    expect(next).toBe(record);
  });
});

describe('removePerson', () => {
  it('removes the person from the record', () => {
    const next = removePerson(seedRecord(), 'leo');
    expect(next.people.some((p) => p.id === 'leo')).toBe(false);
  });

  it('prunes a union left with fewer than two members', () => {
    const record: FamilyRecord = {
      people: [mkPerson('parent1'), mkPerson('child1')],
      unions: [{ parents: ['parent1'], children: ['child1'] }],
      timeline: [],
      probandId: 'parent1',
    };
    const next = removePerson(record, 'child1');
    // Left with only { parents: ['parent1'], children: [] } — one member, so it's dropped.
    expect(next.unions).toEqual([]);
  });

  it('keeps a union that still has two or more members after the removal', () => {
    const next = removePerson(seedRecord(), 'leo');
    const union = next.unions.find((u) => u.parents.includes('you') && u.parents.includes('alex'));
    expect(union).toBeDefined();
    expect(union!.children).toEqual(['zoe']);
  });

  it('is a no-op for the proband, returning the same record reference', () => {
    const record = seedRecord();
    const next = removePerson(record, record.probandId);
    expect(next).toBe(record);
    expect(next.people.some((p) => p.id === record.probandId)).toBe(true);
  });
});

describe('deriveGenerations', () => {
  it('places children one generation below each parent and partners at the same generation', () => {
    const people = [mkPerson('gp1'), mkPerson('gp2'), mkPerson('parent'), mkPerson('kid')];
    const unions: FamilyRecord['unions'] = [
      { parents: ['gp1', 'gp2'], children: ['parent'] },
      { parents: ['parent'], children: ['kid'] },
    ];
    const gen = deriveGenerations(people, unions);
    // Oldest generation is normalised to 0.
    expect(gen.get('gp1')).toBe(0);
    expect(gen.get('gp2')).toBe(0);
    expect(gen.get('parent')).toBe(1);
    expect(gen.get('kid')).toBe(2);
  });

  it('keeps siblings at one generation even when their union lists no parents', () => {
    const people = [mkPerson('a'), mkPerson('b')];
    const gen = deriveGenerations(people, [{ parents: [], children: ['a', 'b'] }]);
    expect(gen.get('a')).toBe(gen.get('b'));
  });

  it('reproduces the seed family generations (child = parent + 1 across every union)', () => {
    const record = seedRecord();
    const gen = deriveGenerations(record.people, record.unions);
    for (const u of record.unions) {
      for (const parent of u.parents) {
        for (const kid of u.children) {
          expect(gen.get(kid)! - gen.get(parent)!).toBe(1);
        }
      }
    }
  });
});

describe('layoutFromGraph', () => {
  it('assigns non-negative generations and distinct x within a generation', () => {
    const record: FamilyRecord = {
      people: [
        mkPerson('gp1'),
        mkPerson('gp2'),
        mkPerson('p'),
        mkPerson('you', { isProband: true }),
      ],
      unions: [
        { parents: ['gp1', 'gp2'], children: ['p'] },
        { parents: ['p'], children: ['you'] },
      ],
      timeline: [],
      probandId: 'you',
    };
    const laid = layoutFromGraph(record);
    const by = (id: string) => laid.people.find((p) => p.id === id)!;
    expect(by('gp1').gen).toBe(0);
    expect(by('p').gen).toBe(1);
    expect(by('you').gen).toBe(2);
    expect(laid.people.every((p) => p.gen >= 0)).toBe(true);
    // The two grandparents share a generation but not a column.
    expect(by('gp1').x).not.toBe(by('gp2').x);
  });

  it('preserves everything but gen/x and never mutates the input', () => {
    const record: FamilyRecord = {
      people: [mkPerson('a', { isProband: true, name: 'A', birth: 1950 })],
      unions: [],
      timeline: [],
      probandId: 'a',
    };
    const snapshot = structuredClone(record);
    const laid = layoutFromGraph(record);
    expect(record).toEqual(snapshot); // input untouched
    expect(laid.people[0]).toMatchObject({ id: 'a', name: 'A', birth: 1950, isProband: true });
  });
});
