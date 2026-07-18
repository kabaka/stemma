import { describe, expect, it } from 'vitest';
import { seedRecord } from '@/data/seed';
import type { ConditionEntry, FamilyRecord, Person, TimelineEvent } from './types';
import {
  deriveGenerations,
  isValidRecord,
  layoutFromGraph,
  linkRelative,
  removePerson,
} from './record';
import { eventProv } from './person';

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

/**
 * Assign fields not yet declared on the TS type. Used throughout the W1 (full-timeline
 * import) sections below to set `prov`/`coding`/`date`/`birthDate`/`deathDate`/`onsetDate`
 * — this oracle is written test-first, against the contract, before `types.ts` carries
 * those fields. Mutates and returns `obj` so call sites can inline it.
 */
function patch<T extends object>(obj: T, fields: Record<string, unknown>): T {
  Object.assign(obj as unknown as Record<string, unknown>, fields);
  return obj;
}

/** Minimal timeline-event fixture for the W1 prov/coding/date tests below. */
function mkEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'e1',
    person: 'a',
    year: 2019,
    type: 'diagnosis',
    title: 'Diagnosed',
    detail: '',
    ...overrides,
  };
}

/** Minimal condition-entry fixture for the W1 onsetDate tests below. */
function mkCond(overrides: Record<string, unknown> = {}): ConditionEntry {
  return patch<ConditionEntry>({ id: 'brca', onset: null, prov: 'self' }, overrides);
}

/** Wraps a single timeline event in an otherwise-minimal, valid record. */
function recordWithEvent(event: TimelineEvent): FamilyRecord {
  return {
    people: [mkPerson('a', { isProband: true })],
    unions: [],
    timeline: [event],
    probandId: 'a',
  };
}

/** Wraps a single person in an otherwise-minimal, valid record. */
function recordWithPerson(person: Person): FamilyRecord {
  return {
    people: [person],
    unions: [],
    timeline: [],
    probandId: person.id,
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

describe('isValidRecord — deep validation', () => {
  const base = (): FamilyRecord => ({
    people: [mkPerson('a', { isProband: true })],
    unions: [],
    timeline: [],
    probandId: 'a',
  });

  it('accepts a well-formed record (and the seed)', () => {
    expect(isValidRecord(base())).toBe(true);
    expect(isValidRecord(seedRecord())).toBe(true);
  });

  it('rejects non-objects and missing collections', () => {
    expect(isValidRecord(null)).toBe(false);
    expect(isValidRecord({ people: [], unions: [], timeline: [] })).toBe(false); // no proband
    expect(isValidRecord({ ...base(), people: 'nope' })).toBe(false);
  });

  it('rejects a record whose proband id resolves to nobody', () => {
    expect(isValidRecord({ ...base(), probandId: 'ghost' })).toBe(false);
  });

  it('rejects a person with a non-number birth (SVG-injection / type-confusion guard)', () => {
    const rec = base();
    (rec.people[0] as unknown as Record<string, unknown>).birth = '<script>evil</script>';
    expect(isValidRecord(rec)).toBe(false);
  });

  it('rejects a person with an out-of-enum sab or gender', () => {
    const badSab = base();
    // 'x' (UAAB) is a valid sab now — use a genuinely out-of-enum sentinel.
    (badSab.people[0] as unknown as Record<string, unknown>).sab = 'z';
    expect(isValidRecord(badSab)).toBe(false);
    const badGender = base();
    (badGender.people[0] as unknown as Record<string, unknown>).gender = 'other';
    expect(isValidRecord(badGender)).toBe(false);
  });

  it('accepts sab "x" (UAAB) as a valid enum member', () => {
    const rec = base();
    rec.people[0].sab = 'x';
    expect(isValidRecord(rec)).toBe(true);
  });

  it('REGRESSION: legacy sab values ({m,f,u}) still validate now that "x" (UAAB) has widened the enum', () => {
    for (const sab of ['m', 'f', 'u'] as const) {
      const rec = base();
      rec.people[0].sab = sab;
      expect(isValidRecord(rec)).toBe(true);
    }
  });

  it('rejects a malformed condition entry (bad prov / non-string id)', () => {
    const rec = base();
    rec.people[0].conds = [{ id: 'brca', onset: null, prov: 'hearsay' as never }];
    expect(isValidRecord(rec)).toBe(false);
  });

  it('rejects a person with a non-number gen/x (would render a NaN layout position)', () => {
    const badGen = base();
    (badGen.people[0] as unknown as Record<string, unknown>).gen = 'top';
    expect(isValidRecord(badGen)).toBe(false);
    const badX = base();
    delete (badX.people[0] as unknown as Record<string, unknown>).x;
    expect(isValidRecord(badX)).toBe(false);
  });

  it('rejects a malformed optional field but accepts valid or absent ones', () => {
    const nonArray = base();
    (nonArray.people[0] as unknown as Record<string, unknown>).organs = 'breasts'; // not an array
    expect(isValidRecord(nonArray)).toBe(false);

    const unknownOrgan = base();
    unknownOrgan.people[0].organs = ['spleen'] as never; // not a known Organ
    expect(isValidRecord(unknownOrgan)).toBe(false);

    const badPronouns = base();
    (badPronouns.people[0] as unknown as Record<string, unknown>).pronouns = 42;
    expect(isValidRecord(badPronouns)).toBe(false);

    const good = base();
    good.people[0].organs = ['breasts', 'ovaries'];
    good.people[0].pronouns = 'she/her';
    expect(isValidRecord(good)).toBe(true);
    // Absent optionals are fine (base() sets neither).
    expect(isValidRecord(base())).toBe(true);
  });

  it('rejects a malformed union or timeline event', () => {
    const badUnion = base();
    (badUnion.unions as unknown[]) = [{ parents: [1, 2], children: [] }];
    expect(isValidRecord(badUnion)).toBe(false);
    const badEvent = base();
    (badEvent.timeline as unknown[]) = [
      { id: 'e', person: 'a', year: 2020, type: 'not-a-type', title: 't', detail: '' },
    ];
    expect(isValidRecord(badEvent)).toBe(false);
  });
});

describe('isValidRecord — union referential integrity (Defect 5)', () => {
  // Three real people, so a "legit union" positive control and each negative case can
  // reuse the same base set without id collisions.
  const threePeople = (): FamilyRecord => ({
    people: [mkPerson('a', { isProband: true }), mkPerson('b'), mkPerson('c')],
    unions: [],
    timeline: [],
    probandId: 'a',
  });

  it('rejects a union whose parent id does not resolve to any recorded person (dangling parent)', () => {
    const rec = threePeople();
    rec.unions = [{ parents: ['a', 'ghost-parent'], children: ['c'] }];
    expect(isValidRecord(rec)).toBe(false);
  });

  it('rejects a union whose child id does not resolve to any recorded person (dangling child)', () => {
    const rec = threePeople();
    rec.unions = [{ parents: ['a', 'b'], children: ['ghost-child'] }];
    expect(isValidRecord(rec)).toBe(false);
  });

  it('rejects a union where a person is listed as both a parent and a child (self-parenting overlap)', () => {
    const rec = threePeople();
    // 'a' is both a parent AND a child of the same union — a cycle a crafted/corrupt blob
    // could smuggle past a shallow shape check.
    rec.unions = [{ parents: ['a', 'b'], children: ['a', 'c'] }];
    expect(isValidRecord(rec)).toBe(false);
  });

  it('accepts legitimate unions — single-parent, childless, and normal two-parent shapes all stay valid', () => {
    const rec = threePeople();
    rec.unions = [
      { parents: ['a'], children: ['c'] }, // single-parent union (a normal in-progress state)
      { parents: ['a', 'b'], children: [] }, // childless union (partners with no kids yet)
    ];
    expect(isValidRecord(rec)).toBe(true);
  });
});

describe('isValidRecord — timeline event structured payloads (med/lab/vital/allergy/immunization/attachments)', () => {
  const base = (): FamilyRecord => ({
    people: [mkPerson('a', { isProband: true })],
    unions: [],
    timeline: [],
    probandId: 'a',
  });

  const baseEvent = (overrides: Partial<TimelineEvent> = {}): TimelineEvent => ({
    id: 'e1',
    person: 'a',
    year: 2020,
    type: 'medication',
    title: 'Started X',
    detail: '',
    ...overrides,
  });

  const withEvent = (event: TimelineEvent): FamilyRecord => {
    const rec = base();
    rec.timeline = [event];
    return rec;
  };

  it('REGRESSION: a legacy flat event ({id,person,year,type,title,detail}, no new fields) still validates', () => {
    const legacy: TimelineEvent = {
      id: 'legacy-1',
      person: 'a',
      year: 2016,
      type: 'medication',
      title: 'Started Levothyroxine',
      detail: '50 mcg daily',
    };
    expect(isValidRecord(withEvent(legacy))).toBe(true);
  });

  it('accepts a full record carrying an event for every new field, each well-formed', () => {
    const rec = base();
    rec.timeline = [
      baseEvent({ id: 'e-med', type: 'medication', med: { dose: '10mg', ongoing: true } }),
      baseEvent({
        id: 'e-lab',
        type: 'lab',
        title: 'LDL',
        lab: { value: 130, unit: 'mg/dL', refLow: 0, refHigh: 100 },
      }),
      baseEvent({
        id: 'e-vital',
        type: 'vital',
        title: 'Blood pressure',
        vital: { value: 128, unit: 'mmHg' },
      }),
      baseEvent({
        id: 'e-allergy',
        type: 'allergy',
        title: 'Penicillin allergy',
        allergy: { substance: 'Penicillin', reaction: 'Hives', severity: 'severe' },
      }),
      baseEvent({
        id: 'e-imm',
        type: 'immunization',
        title: 'Flu shot',
        immunization: { vaccine: 'Influenza', doseLabel: '2024-25' },
      }),
      baseEvent({
        id: 'e-att',
        type: 'procedure',
        title: 'Colonoscopy',
        attachments: [
          { id: 'att-1', name: 'report.pdf', note: 'Path report', mediaType: 'application/pdf' },
        ],
      }),
      baseEvent({
        id: 'e-screen',
        type: 'screening',
        title: 'Mammogram',
        screeningId: 'mammogram',
      }),
    ];
    expect(isValidRecord(rec)).toBe(true);
  });

  it('rejects an allergy with an out-of-enum severity', () => {
    const rec = withEvent(
      baseEvent({
        type: 'allergy',
        allergy: { substance: 'Peanuts', severity: 'critical' as never },
      }),
    );
    expect(isValidRecord(rec)).toBe(false);
  });

  it('rejects a lab Measurement with a non-number value', () => {
    const rec = withEvent(baseEvent({ type: 'lab', lab: { value: '5.4' as never, unit: '%' } }));
    expect(isValidRecord(rec)).toBe(false);
  });

  it('rejects a medication payload missing the required ongoing flag', () => {
    const rec = withEvent(baseEvent({ type: 'medication', med: { dose: '10mg' } as never }));
    expect(isValidRecord(rec)).toBe(false);
  });

  it('rejects a non-array attachments field', () => {
    const rec = withEvent(baseEvent({ attachments: 'file.pdf' as never }));
    expect(isValidRecord(rec)).toBe(false);
  });

  it('rejects an attachment missing its name or its id', () => {
    expect(isValidRecord(withEvent(baseEvent({ attachments: [{ id: 'a1' } as never] })))).toBe(
      false,
    );
    expect(isValidRecord(withEvent(baseEvent({ attachments: [{ name: 'x' } as never] })))).toBe(
      false,
    );
  });

  it('rejects a non-string screeningId', () => {
    const rec = withEvent(baseEvent({ type: 'screening', screeningId: 123 as never }));
    expect(isValidRecord(rec)).toBe(false);
  });

  it('accepts a well-formed value for each new optional field individually', () => {
    expect(
      isValidRecord(
        withEvent(baseEvent({ type: 'medication', med: { ongoing: false, stopYear: 2022 } })),
      ),
    ).toBe(true);
    expect(
      isValidRecord(withEvent(baseEvent({ type: 'lab', lab: { value: 100, unit: 'mg/dL' } }))),
    ).toBe(true);
    expect(
      isValidRecord(withEvent(baseEvent({ type: 'vital', vital: { value: 72, unit: 'bpm' } }))),
    ).toBe(true);
    expect(
      isValidRecord(withEvent(baseEvent({ type: 'allergy', allergy: { substance: 'Latex' } }))),
    ).toBe(true);
    expect(isValidRecord(withEvent(baseEvent({ type: 'immunization', immunization: {} })))).toBe(
      true,
    );
    expect(
      isValidRecord(withEvent(baseEvent({ attachments: [{ id: 'a1', name: 'x.pdf' }] }))),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PR 3 — union `twins` (isValidTwinSets) and a type-checked `consanguineous`
// ---------------------------------------------------------------------------

describe('isValidRecord — union twins & consanguineous (PR 3 pedigree extras)', () => {
  /** Two unions off the same proband: the first (children b, c, e) is the one twin fixtures
   * patch; the second (child d) supplies a real person id that is NOT a child of the first
   * union, for the "twin member outside this union's own children" negative case. */
  const twinsBase = (): FamilyRecord => ({
    people: [
      mkPerson('a', { isProband: true }),
      mkPerson('b'),
      mkPerson('c'),
      mkPerson('d'),
      mkPerson('e'),
    ],
    unions: [
      { parents: ['a'], children: ['b', 'c', 'e'] },
      { parents: ['a'], children: ['d'] },
    ],
    timeline: [],
    probandId: 'a',
  });

  it('accepts a well-formed twins entry', () => {
    const rec = twinsBase();
    rec.unions[0].twins = [{ members: ['b', 'c'], zygosity: 'di' }];
    expect(isValidRecord(rec)).toBe(true);
  });

  it("rejects a twin member that is a real person but not among THIS union's own children", () => {
    const rec = twinsBase();
    // 'd' is a valid person and a child of the second union, but not of the first.
    rec.unions[0].twins = [{ members: ['b', 'd'], zygosity: 'di' }];
    expect(isValidRecord(rec)).toBe(false);
  });

  it('rejects a TwinSet with fewer than two members', () => {
    const rec = twinsBase();
    rec.unions[0].twins = [{ members: ['b'], zygosity: 'di' }];
    expect(isValidRecord(rec)).toBe(false);
  });

  it('rejects a child id claimed by two TwinSets in the same union', () => {
    const rec = twinsBase();
    rec.unions[0].twins = [
      { members: ['b', 'c'], zygosity: 'di' },
      { members: ['c', 'e'], zygosity: 'mono' },
    ];
    expect(isValidRecord(rec)).toBe(false);
  });

  it('rejects an out-of-enum zygosity', () => {
    const rec = twinsBase();
    rec.unions[0].twins = [{ members: ['b', 'c'], zygosity: 'identical' as never }];
    expect(isValidRecord(rec)).toBe(false);
  });

  it('a legacy union with no `twins` key at all still validates', () => {
    expect(isValidRecord(twinsBase())).toBe(true);
  });

  it('rejects a non-boolean consanguineous flag', () => {
    const rec = twinsBase();
    (rec.unions[0] as unknown as Record<string, unknown>).consanguineous = 'yes';
    expect(isValidRecord(rec)).toBe(false);
  });

  it('accepts consanguineous true and accepts it absent', () => {
    const withFlag = twinsBase();
    withFlag.unions[0].consanguineous = true;
    expect(isValidRecord(withFlag)).toBe(true);
    expect(isValidRecord(twinsBase())).toBe(true); // absent
  });
});

// ---------------------------------------------------------------------------
// W1 — full-timeline import: TimelineEvent.prov/coding/date, Person.birthDate/deathDate,
// ConditionEntry.onsetDate, and the `eventProv` helper (src/domain/person.ts). Additive
// and backward-compatible: every case in this section that omits the new fields must
// validate identically to before. See the W1 contract (DR-0023/DR-0024).
// ---------------------------------------------------------------------------

describe('isValidRecord — event prov/coding/date (W1 full-timeline import)', () => {
  it('REGRESSION: an event with none of prov/coding/date still validates exactly as before', () => {
    expect(isValidRecord(recordWithEvent(mkEvent()))).toBe(true);
  });

  it.each(['self', 'record', 'death'] as const)('accepts prov %s', (prov) => {
    expect(isValidRecord(recordWithEvent(patch(mkEvent(), { prov })))).toBe(true);
  });

  it('accepts prov absent', () => {
    const event = mkEvent();
    expect('prov' in event).toBe(false);
    expect(isValidRecord(recordWithEvent(event))).toBe(true);
  });

  it('rejects an out-of-enum prov', () => {
    expect(isValidRecord(recordWithEvent(patch(mkEvent(), { prov: 'bogus' })))).toBe(false);
  });

  it('accepts a well-formed coding array, with and without a display', () => {
    const event = patch(mkEvent(), {
      coding: [
        { system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'E11.9', display: 'Type 2 diabetes' },
        { system: 'http://snomed.info/sct', code: '44054006' },
      ],
    });
    expect(isValidRecord(recordWithEvent(event))).toBe(true);
  });

  it('accepts an empty coding array', () => {
    expect(isValidRecord(recordWithEvent(patch(mkEvent(), { coding: [] })))).toBe(true);
  });

  it('accepts coding absent (legacy event)', () => {
    expect(isValidRecord(recordWithEvent(mkEvent()))).toBe(true);
  });

  it('rejects a non-array coding', () => {
    expect(isValidRecord(recordWithEvent(patch(mkEvent(), { coding: 'E11.9' })))).toBe(false);
  });

  it('rejects a coding entry missing its system', () => {
    const event = patch(mkEvent(), { coding: [{ code: 'E11.9' }] });
    expect(isValidRecord(recordWithEvent(event))).toBe(false);
  });

  it('rejects a coding entry missing its code', () => {
    const event = patch(mkEvent(), { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm' }] });
    expect(isValidRecord(recordWithEvent(event))).toBe(false);
  });

  it('rejects a coding entry whose code is not a string', () => {
    const event = patch(mkEvent(), {
      coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 12345 }],
    });
    expect(isValidRecord(recordWithEvent(event))).toBe(false);
  });

  it('accepts a date whose year component matches the event year', () => {
    const event = patch(mkEvent({ year: 2019 }), { date: '2019-06-02' });
    expect(isValidRecord(recordWithEvent(event))).toBe(true);
  });

  it('rejects a date whose year component does not match the event year', () => {
    const event = patch(mkEvent({ year: 2020 }), { date: '2019-06-02' });
    expect(isValidRecord(recordWithEvent(event))).toBe(false);
  });

  it('rejects a malformed date string even when its leading digits match the year', () => {
    expect(
      isValidRecord(recordWithEvent(patch(mkEvent({ year: 2019 }), { date: '2019-13-40' }))),
    ).toBe(false);
    expect(
      isValidRecord(recordWithEvent(patch(mkEvent({ year: 2019 }), { date: 'not-a-date' }))),
    ).toBe(false);
  });

  it('accepts date absent (legacy/year-only event)', () => {
    expect(isValidRecord(recordWithEvent(mkEvent({ year: 2019 })))).toBe(true);
  });

  it('accepts an event carrying prov, coding, and a matching date all at once', () => {
    const event = patch(mkEvent({ year: 2019, type: 'lab' }), {
      prov: 'record',
      coding: [{ system: 'http://loinc.org', code: '2093-3', display: 'Cholesterol' }],
      date: '2019-06-02',
    });
    expect(isValidRecord(recordWithEvent(event))).toBe(true);
  });
});

describe('isValidRecord — person birthDate/deathDate & condition onsetDate (W1 full-timeline import)', () => {
  it('REGRESSION: a person with none of birthDate/deathDate/onsetDate still validates', () => {
    const person = mkPerson('a', { isProband: true, birth: 1975, death: null, dead: false });
    expect(isValidRecord(recordWithPerson(person))).toBe(true);
  });

  it('accepts a birthDate whose year component matches birth', () => {
    const person = patch(mkPerson('a', { isProband: true, birth: 1975 }), {
      birthDate: '1975-06-02',
    });
    expect(isValidRecord(recordWithPerson(person))).toBe(true);
  });

  it('rejects a birthDate whose year component does not match birth', () => {
    const person = patch(mkPerson('a', { isProband: true, birth: 1975 }), {
      birthDate: '1976-06-02',
    });
    expect(isValidRecord(recordWithPerson(person))).toBe(false);
  });

  it('rejects a present birthDate when birth is null', () => {
    const person = patch(mkPerson('a', { isProband: true, birth: null }), {
      birthDate: '1975-06-02',
    });
    expect(isValidRecord(recordWithPerson(person))).toBe(false);
  });

  it('rejects a malformed birthDate string even when the record has no other issue', () => {
    const person = patch(mkPerson('a', { isProband: true, birth: 1975 }), {
      birthDate: '1975-13-40',
    });
    expect(isValidRecord(recordWithPerson(person))).toBe(false);
  });

  it('accepts birthDate absent', () => {
    const person = mkPerson('a', { isProband: true, birth: 1975 });
    expect(isValidRecord(recordWithPerson(person))).toBe(true);
  });

  it('accepts a deathDate whose year component matches death', () => {
    const person = patch(mkPerson('a', { isProband: true, birth: 1950, dead: true, death: 2020 }), {
      deathDate: '2020-03-10',
    });
    expect(isValidRecord(recordWithPerson(person))).toBe(true);
  });

  it('rejects a deathDate whose year component does not match death', () => {
    const person = patch(mkPerson('a', { isProband: true, birth: 1950, dead: true, death: 2020 }), {
      deathDate: '2021-03-10',
    });
    expect(isValidRecord(recordWithPerson(person))).toBe(false);
  });

  it('rejects a present deathDate when death is null', () => {
    const person = patch(mkPerson('a', { isProband: true, dead: false, death: null }), {
      deathDate: '2020-03-10',
    });
    expect(isValidRecord(recordWithPerson(person))).toBe(false);
  });

  it('rejects a malformed deathDate string even when the record has no other issue', () => {
    const person = patch(mkPerson('a', { isProband: true, dead: true, death: 2020 }), {
      deathDate: '2020-99-99',
    });
    expect(isValidRecord(recordWithPerson(person))).toBe(false);
  });

  it('accepts deathDate absent', () => {
    const person = mkPerson('a', { isProband: true, dead: false, death: null });
    expect(isValidRecord(recordWithPerson(person))).toBe(true);
  });

  it('accepts a person carrying birthDate and deathDate together, both year-matched', () => {
    const person = patch(mkPerson('a', { isProband: true, birth: 1950, dead: true, death: 2020 }), {
      birthDate: '1950-01-15',
      deathDate: '2020-03-10',
    });
    expect(isValidRecord(recordWithPerson(person))).toBe(true);
  });

  it('accepts a well-formed onsetDate regardless of the recorded onset age (shape-only, no year-match)', () => {
    const person = mkPerson('a', { isProband: true });
    person.conds = [mkCond({ onset: 45, onsetDate: '1980-05-01' })];
    expect(isValidRecord(recordWithPerson(person))).toBe(true);
  });

  it('accepts a well-formed onsetDate even when onset itself is null (onset is an age, not a year — no coarse value to match)', () => {
    const person = mkPerson('a', { isProband: true });
    person.conds = [mkCond({ onset: null, onsetDate: '1980-05-01' })];
    expect(isValidRecord(recordWithPerson(person))).toBe(true);
  });

  it('rejects a malformed onsetDate string', () => {
    const person = mkPerson('a', { isProband: true });
    person.conds = [mkCond({ onset: 45, onsetDate: 'not-a-date' })];
    expect(isValidRecord(recordWithPerson(person))).toBe(false);
  });

  it('accepts onsetDate absent', () => {
    const person = mkPerson('a', { isProband: true });
    person.conds = [mkCond({ onset: 45 })];
    expect(isValidRecord(recordWithPerson(person))).toBe(true);
  });
});

describe('isValidRecord — a pre-W1 persisted record round-trips unchanged (legacy fixture)', () => {
  it('a hand-authored legacy record (no prov/coding/date/birthDate/deathDate/onsetDate anywhere) passes isValidRecord', () => {
    const legacy: FamilyRecord = {
      people: [
        {
          id: 'proband',
          name: 'Proband',
          sab: 'f',
          gender: 'woman',
          gen: 1,
          x: 0,
          dead: false,
          birth: 1990,
          death: null,
          conds: [{ id: 'brca', onset: 32, prov: 'self' }],
          isProband: true,
        },
        {
          id: 'parent',
          name: 'Parent',
          sab: 'm',
          gender: 'man',
          gen: 0,
          x: 0,
          dead: true,
          birth: 1960,
          death: 2015,
          conds: [{ id: 'cad', onset: 50, prov: 'death' }],
        },
      ],
      unions: [{ parents: ['parent'], children: ['proband'] }],
      timeline: [
        {
          id: 'legacy-evt-1',
          person: 'proband',
          year: 2015,
          type: 'diagnosis',
          title: 'Diagnosed BRCA1',
          detail: 'Genetic counseling referral',
        },
      ],
      probandId: 'proband',
    };
    expect(isValidRecord(legacy)).toBe(true);
  });

  it('REGRESSION: the illustrative seed record (a real pre-W1 fixture) still validates', () => {
    expect(isValidRecord(seedRecord())).toBe(true);
  });
});

describe('eventProv', () => {
  it('defaults to self when prov is absent', () => {
    const event = mkEvent();
    expect('prov' in event).toBe(false);
    expect(eventProv(event)).toBe('self');
  });

  it.each(['self', 'record', 'death'] as const)(
    'returns the recorded provenance %s when set',
    (prov) => {
      expect(eventProv(patch(mkEvent(), { prov }))).toBe(prov);
    },
  );
});
