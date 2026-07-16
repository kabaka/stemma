import { describe, expect, it } from 'vitest';
import { emptyRecord } from '@/data/seed';
import type { FamilyRecord, Person, TimelineEvent, Union } from './types';
import {
  HISTORY_MAX_ENTRIES,
  capHistory,
  diffRecords,
  isValidHistoryEntry,
  sanitizeHistory,
  summarizeDiff,
  type HistoryEntry,
  type RecordDiff,
} from './history';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

/** A minimal but `isValidRecord`-passing record: one proband, nothing else. */
function baseRecord(): FamilyRecord {
  return {
    people: [mkPerson('p1', { isProband: true })],
    unions: [],
    timeline: [],
    probandId: 'p1',
  };
}

function mkEvent(id: string, overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id,
    person: 'p1',
    year: 2020,
    type: 'visit',
    title: `Event ${id}`,
    detail: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// diffRecords
// ---------------------------------------------------------------------------

describe('diffRecords — people', () => {
  it('reports a wholly new person as peopleAdded — and does NOT enumerate their conditions', () => {
    const before = baseRecord();
    const after: FamilyRecord = {
      ...before,
      people: [
        ...before.people,
        mkPerson('p2', { name: 'Jane', conds: [{ id: 'brca', onset: 40, prov: 'self' }] }),
      ],
    };
    const diff = diffRecords(before, after);
    expect(diff.peopleAdded).toHaveLength(1);
    expect(diff.peopleAdded[0].id).toBe('p2');
    expect(diff.peopleChanged).toEqual([]);
    // Key rule: a wholesale-added person's conditions are implied by the add, not
    // separately enumerated in conditionsChanged.
    expect(diff.conditionsChanged).toEqual([]);
    expect(diff.isEmpty).toBe(false);
  });

  it('reports a removed person as peopleRemoved', () => {
    const before: FamilyRecord = {
      ...baseRecord(),
      people: [mkPerson('p1', { isProband: true }), mkPerson('p2', { name: 'Bob' })],
    };
    const after = baseRecord();
    const diff = diffRecords(before, after);
    expect(diff.peopleRemoved).toHaveLength(1);
    expect(diff.peopleRemoved[0].id).toBe('p2');
  });

  it('reports a name change on a person present in both snapshots', () => {
    const before = baseRecord();
    const after: FamilyRecord = {
      ...before,
      people: [{ ...before.people[0], name: 'Renamed' }],
    };
    const diff = diffRecords(before, after);
    expect(diff.peopleChanged).toEqual([
      { id: 'p1', name: 'Renamed', changes: [{ field: 'name', before: 'p1', after: 'Renamed' }] },
    ]);
  });

  it('reports an organs change as order-independent (no diff if the same set is reordered)', () => {
    const before: FamilyRecord = {
      ...baseRecord(),
      people: [mkPerson('p1', { isProband: true, organs: ['breasts', 'ovaries'] })],
    };
    // Same set, different order — must NOT be a change.
    const reordered: FamilyRecord = {
      ...before,
      people: [{ ...before.people[0], organs: ['ovaries', 'breasts'] }],
    };
    expect(diffRecords(before, reordered).peopleChanged).toEqual([]);

    // A genuinely different set IS a change.
    const changed: FamilyRecord = {
      ...before,
      people: [{ ...before.people[0], organs: ['breasts', 'prostate'] }],
    };
    const diff = diffRecords(before, changed);
    expect(diff.peopleChanged).toEqual([
      {
        id: 'p1',
        name: 'p1',
        changes: [
          { field: 'organs', before: ['breasts', 'ovaries'], after: ['breasts', 'prostate'] },
        ],
      },
    ]);
  });

  it('reports a dead/birth change together', () => {
    const before = baseRecord();
    const after: FamilyRecord = {
      ...before,
      people: [{ ...before.people[0], dead: true, birth: 1950 }],
    };
    const diff = diffRecords(before, after);
    expect(diff.peopleChanged).toHaveLength(1);
    const fields = diff.peopleChanged[0].changes.map((c) => c.field).sort();
    expect(fields).toEqual(['birth', 'dead']);
  });

  it('excludes gen/x-only differences from peopleChanged — layout math, not a user edit', () => {
    const before = baseRecord();
    const after: FamilyRecord = {
      ...before,
      people: [{ ...before.people[0], gen: 3, x: 999 }],
    };
    const diff = diffRecords(before, after);
    expect(diff.peopleChanged).toEqual([]);
    expect(diff.isEmpty).toBe(true);
  });
});

describe('diffRecords — conditions (person present in BOTH snapshots)', () => {
  const withCond = (conds: FamilyRecord['people'][0]['conds']): FamilyRecord => ({
    ...baseRecord(),
    people: [mkPerson('p1', { isProband: true, conds })],
  });

  it('reports an added condition', () => {
    const before = withCond([]);
    const after = withCond([{ id: 'brca', onset: 40, prov: 'self' }]);
    const diff = diffRecords(before, after);
    expect(diff.conditionsChanged).toEqual([
      {
        personId: 'p1',
        personName: 'p1',
        conditionId: 'brca',
        kind: 'added',
        after: { id: 'brca', onset: 40, prov: 'self' },
      },
    ]);
  });

  it('reports a removed condition', () => {
    const before = withCond([{ id: 'brca', onset: 40, prov: 'self' }]);
    const after = withCond([]);
    const diff = diffRecords(before, after);
    expect(diff.conditionsChanged).toEqual([
      {
        personId: 'p1',
        personName: 'p1',
        conditionId: 'brca',
        kind: 'removed',
        before: { id: 'brca', onset: 40, prov: 'self' },
      },
    ]);
  });

  it('reports a changed condition when onset differs (including onset 0)', () => {
    const before = withCond([{ id: 'brca', onset: null, prov: 'self' }]);
    const after = withCond([{ id: 'brca', onset: 0, prov: 'self' }]);
    const diff = diffRecords(before, after);
    expect(diff.conditionsChanged).toEqual([
      {
        personId: 'p1',
        personName: 'p1',
        conditionId: 'brca',
        kind: 'changed',
        before: { id: 'brca', onset: null, prov: 'self' },
        after: { id: 'brca', onset: 0, prov: 'self' },
      },
    ]);
  });

  it('reports a changed condition when provenance differs', () => {
    const before = withCond([{ id: 'brca', onset: 40, prov: 'self' }]);
    const after = withCond([{ id: 'brca', onset: 40, prov: 'record' }]);
    const diff = diffRecords(before, after);
    expect(diff.conditionsChanged[0].kind).toBe('changed');
  });

  it('does not report a condition on a person NOT present in both snapshots (removed person)', () => {
    const before: FamilyRecord = {
      ...baseRecord(),
      people: [
        mkPerson('p1', { isProband: true }),
        mkPerson('p2', { conds: [{ id: 'brca', onset: 40, prov: 'self' }] }),
      ],
    };
    const after = baseRecord(); // p2 removed entirely
    const diff = diffRecords(before, after);
    expect(diff.conditionsChanged).toEqual([]);
    expect(diff.peopleRemoved.map((p) => p.id)).toEqual(['p2']);
  });
});

describe('diffRecords — unions (matched by order-independent parents set)', () => {
  const twoParentRecord = (union: Union): FamilyRecord => ({
    people: [
      mkPerson('parent1', { name: 'Parent1' }),
      mkPerson('parent2', { name: 'Parent2' }),
      mkPerson('kid', { name: 'Kid', isProband: true }),
      mkPerson('kid2', { name: 'Kid2' }),
    ],
    unions: [union],
    timeline: [],
    probandId: 'kid',
  });

  it('reports an added union', () => {
    const before: FamilyRecord = { ...baseRecord() };
    const after = twoParentRecord({ parents: ['parent1', 'parent2'], children: ['kid'] });
    const diff = diffRecords(before, after);
    expect(diff.unionsAdded).toHaveLength(1);
    expect(diff.unionsRemoved).toEqual([]);
  });

  it('reports a removed union', () => {
    const before = twoParentRecord({ parents: ['parent1', 'parent2'], children: ['kid'] });
    const after: FamilyRecord = { ...before, unions: [] };
    const diff = diffRecords(before, after);
    expect(diff.unionsRemoved).toHaveLength(1);
    expect(diff.unionsAdded).toEqual([]);
  });

  it('matches a union across reordered parents — a consanguineous toggle is a change, not add+remove', () => {
    const before = twoParentRecord({ parents: ['parent1', 'parent2'], children: ['kid'] });
    const after: FamilyRecord = {
      ...before,
      unions: [{ parents: ['parent2', 'parent1'], children: ['kid'], consanguineous: true }],
    };
    const diff = diffRecords(before, after);
    expect(diff.unionsAdded).toEqual([]);
    expect(diff.unionsRemoved).toEqual([]);
    expect(diff.unionsChanged).toEqual([
      {
        parents: ['parent2', 'parent1'],
        changes: [{ field: 'consanguineous', before: undefined, after: true }],
      },
    ]);
  });

  it('reports twins added to a union', () => {
    const before = twoParentRecord({ parents: ['parent1', 'parent2'], children: ['kid', 'kid2'] });
    const twins = [{ members: ['kid', 'kid2'], zygosity: 'di' as const }];
    const after: FamilyRecord = {
      ...before,
      unions: [{ parents: ['parent1', 'parent2'], children: ['kid', 'kid2'], twins }],
    };
    const diff = diffRecords(before, after);
    expect(diff.unionsChanged).toEqual([
      {
        parents: ['parent1', 'parent2'],
        changes: [{ field: 'twins', before: undefined, after: twins }],
      },
    ]);
  });

  it('reports a children-set change (order-independent) on the matched union', () => {
    const before = twoParentRecord({ parents: ['parent1', 'parent2'], children: ['kid'] });
    const after: FamilyRecord = {
      ...before,
      unions: [{ parents: ['parent1', 'parent2'], children: ['kid', 'kid2'] }],
    };
    const diff = diffRecords(before, after);
    expect(diff.unionsChanged).toEqual([
      {
        parents: ['parent1', 'parent2'],
        changes: [{ field: 'children', before: ['kid'], after: ['kid', 'kid2'] }],
      },
    ]);
  });
});

// Regression tests for code-review finding 1: unions have no stable id, and the parents-set
// is not a unique key — an empty-`parents` union (a legal shape `linkRelative` creates for a
// sibling/parent added onto an anchor with no recorded parent union) means several distinct
// unions can share the `''` key. Keying purely by parents used to pair two unrelated
// empty-parents unions and report a phantom "changed" instead of the real add/remove.
describe('diffRecords — union-diff collision safety (code-review finding 1)', () => {
  const withUnions = (unions: Union[]): FamilyRecord => ({ ...baseRecord(), unions });

  it('reports only the genuinely added union among two distinct empty-parents unions (no phantom "changed" on the untouched one)', () => {
    const before = withUnions([{ parents: [], children: ['b'] }]);
    const after = withUnions([
      { parents: [], children: ['b'] },
      { parents: [], children: ['c', 'd'] },
    ]);
    const diff = diffRecords(before, after);
    expect(diff.unionsAdded).toEqual([{ parents: [], children: ['c', 'd'] }]);
    expect(diff.unionsRemoved).toEqual([]);
    expect(diff.unionsChanged).toEqual([]);
  });

  it('reports only the genuinely removed union among two distinct empty-parents unions (symmetric case)', () => {
    const before = withUnions([
      { parents: [], children: ['b'] },
      { parents: [], children: ['c', 'd'] },
    ]);
    const after = withUnions([{ parents: [], children: ['b'] }]);
    const diff = diffRecords(before, after);
    expect(diff.unionsRemoved).toEqual([{ parents: [], children: ['c', 'd'] }]);
    expect(diff.unionsAdded).toEqual([]);
    expect(diff.unionsChanged).toEqual([]);
  });

  it('still detects a genuine change on a normal two-parent union (regression guard: the collision fix must not break real change-detection)', () => {
    const before = withUnions([{ parents: ['x', 'y'], children: ['a'] }]);
    const after = withUnions([{ parents: ['x', 'y'], children: ['a', 'z'] }]);
    const diff = diffRecords(before, after);
    expect(diff.unionsChanged).toEqual([
      { parents: ['x', 'y'], changes: [{ field: 'children', before: ['a'], after: ['a', 'z'] }] },
    ]);
    expect(diff.unionsAdded).toEqual([]);
    expect(diff.unionsRemoved).toEqual([]);
  });

  it('cancels two structurally-identical empty-parents unions present in both snapshots (no change reported)', () => {
    const unions: Union[] = [
      { parents: [], children: ['b'] },
      { parents: [], children: ['c', 'd'] },
    ];
    const before = withUnions(unions);
    const after = withUnions(structuredClone(unions)); // same content, distinct references/order
    const diff = diffRecords(before, after);
    expect(diff.unionsAdded).toEqual([]);
    expect(diff.unionsRemoved).toEqual([]);
    expect(diff.unionsChanged).toEqual([]);
    expect(diff.isEmpty).toBe(true);
  });
});

describe('diffRecords — events (matched by id)', () => {
  it('reports an added event', () => {
    const before = baseRecord();
    const after: FamilyRecord = { ...before, timeline: [mkEvent('e1')] };
    const diff = diffRecords(before, after);
    expect(diff.eventsAdded.map((e) => e.id)).toEqual(['e1']);
  });

  it('reports a removed event', () => {
    const before: FamilyRecord = { ...baseRecord(), timeline: [mkEvent('e1')] };
    const after: FamilyRecord = { ...before, timeline: [] };
    const diff = diffRecords(before, after);
    expect(diff.eventsRemoved.map((e) => e.id)).toEqual(['e1']);
  });

  it('reports a changed event (same id, different content)', () => {
    const before: FamilyRecord = { ...baseRecord(), timeline: [mkEvent('e1', { title: 'Old' })] };
    const after: FamilyRecord = { ...before, timeline: [mkEvent('e1', { title: 'New' })] };
    const diff = diffRecords(before, after);
    expect(diff.eventsChanged).toHaveLength(1);
    expect(diff.eventsChanged[0]).toMatchObject({ id: 'e1', kind: 'changed' });
    expect(diff.eventsChanged[0].after?.title).toBe('New');
  });
});

describe('diffRecords — isEmpty', () => {
  it('is true for structurally identical records (even distinct object references)', () => {
    const before = baseRecord();
    const after: FamilyRecord = JSON.parse(JSON.stringify(before));
    const diff = diffRecords(before, after);
    expect(diff.isEmpty).toBe(true);
    expect(diff.peopleAdded).toEqual([]);
    expect(diff.peopleRemoved).toEqual([]);
    expect(diff.peopleChanged).toEqual([]);
    expect(diff.conditionsChanged).toEqual([]);
    expect(diff.unionsAdded).toEqual([]);
    expect(diff.unionsRemoved).toEqual([]);
    expect(diff.unionsChanged).toEqual([]);
    expect(diff.eventsAdded).toEqual([]);
    expect(diff.eventsRemoved).toEqual([]);
    expect(diff.eventsChanged).toEqual([]);
  });

  it('is false when anything at all differs', () => {
    const before = baseRecord();
    const after: FamilyRecord = { ...before, timeline: [mkEvent('e1')] };
    expect(diffRecords(before, after).isEmpty).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// summarizeDiff — exact bullet-string assertions
// ---------------------------------------------------------------------------

describe('summarizeDiff', () => {
  it('returns no lines for an empty diff', () => {
    const empty: RecordDiff = {
      peopleAdded: [],
      peopleRemoved: [],
      peopleChanged: [],
      conditionsChanged: [],
      unionsAdded: [],
      unionsRemoved: [],
      unionsChanged: [],
      eventsAdded: [],
      eventsRemoved: [],
      eventsChanged: [],
      isEmpty: true,
    };
    expect(summarizeDiff(empty)).toEqual([]);
  });

  it('renders one bullet per change kind, in the stable people → conditions → unions → events order', () => {
    const diff: RecordDiff = {
      peopleAdded: [mkPerson('p2', { name: 'Jane' })],
      peopleRemoved: [mkPerson('p3', { name: 'Bob' })],
      peopleChanged: [
        {
          id: 'p1',
          name: 'Carol',
          changes: [
            { field: 'name', before: 'Carol Old', after: 'Carol' },
            { field: 'birth', before: 1990, after: 1991 },
          ],
        },
      ],
      conditionsChanged: [
        {
          personId: 'p1',
          personName: 'Carol',
          conditionId: 'brca',
          kind: 'added',
          after: { id: 'brca', onset: 40, prov: 'self' },
        },
        {
          personId: 'p1',
          personName: 'Carol',
          conditionId: 't2d',
          kind: 'removed',
          before: { id: 't2d', onset: 50, prov: 'self' },
        },
        {
          personId: 'p1',
          personName: 'Carol',
          conditionId: 'htn',
          kind: 'changed',
          before: { id: 'htn', onset: 50, prov: 'self' },
          after: { id: 'htn', onset: 52, prov: 'record' },
        },
      ],
      unionsAdded: [{ parents: ['p1', 'p2'], children: [] }],
      unionsRemoved: [{ parents: ['p4', 'p5'], children: [] }],
      unionsChanged: [
        {
          parents: ['p1', 'p2'],
          changes: [{ field: 'consanguineous', before: undefined, after: true }],
        },
      ],
      eventsAdded: [mkEvent('e1', { year: 2020, title: 'Checkup' })],
      eventsRemoved: [mkEvent('e2', { year: 2019, title: 'Bloodwork' })],
      eventsChanged: [
        {
          id: 'e3',
          kind: 'changed',
          before: mkEvent('e3', { year: 2018, title: 'Old title' }),
          after: mkEvent('e3', { year: 2018, title: 'New title' }),
        },
      ],
      isEmpty: false,
    };

    expect(summarizeDiff(diff)).toEqual([
      'Added relative: Jane',
      'Removed: Bob',
      'Edited Carol: name, birth',
      'Edited Carol: added condition brca',
      'Edited Carol: removed condition t2d',
      'Edited Carol: updated condition htn',
      'Added family union',
      'Removed family union',
      'Updated family union',
      'Added event (2020): Checkup',
      'Removed event (2019): Bloodwork',
      'Edited event (2018): New title',
    ]);
  });
});

// ---------------------------------------------------------------------------
// capHistory
// ---------------------------------------------------------------------------

function mkEntry(id: string, labelLen = 5): HistoryEntry {
  return { id, ts: 0, label: 'x'.repeat(labelLen), record: baseRecord() };
}

describe('capHistory', () => {
  it('evicts the oldest entry once the count exceeds HISTORY_MAX_ENTRIES (the 51st push drops the 1st)', () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < HISTORY_MAX_ENTRIES + 1; i++) {
      list = capHistory(list, mkEntry(`id-${i}`));
    }
    expect(list).toHaveLength(HISTORY_MAX_ENTRIES);
    expect(list.map((e) => e.id)).not.toContain('id-0');
    expect(list[0].id).toBe('id-1');
    expect(list[list.length - 1].id).toBe(`id-${HISTORY_MAX_ENTRIES}`);
  });

  it('evicts oldest entries once the serialized byte budget is exceeded', () => {
    // Each entry with a 2000-char label serializes to roughly ~2KB; a 6000-byte cap can
    // hold at most two or three, so accumulating five must evict the earliest ones.
    let list: HistoryEntry[] = [];
    for (let i = 0; i < 5; i++) {
      list = capHistory(list, mkEntry(`id-${i}`, 2000), 50, 6000);
    }
    expect(list.length).toBeLessThan(5);
    expect(list[list.length - 1].id).toBe('id-4'); // newest always retained
    expect(list.map((e) => e.id)).not.toContain('id-0'); // earliest evicted
    expect(JSON.stringify(list).length).toBeLessThanOrEqual(6000);
  });

  it('never drops the just-added newest entry, even when it alone exceeds the byte cap', () => {
    const huge = mkEntry('huge', 100_000);
    const result = capHistory([], huge, 50, 100);
    expect(result).toEqual([huge]);
    expect(JSON.stringify(result).length).toBeGreaterThan(100); // over budget, but kept anyway
  });

  it('honors both caps together — evicting past whichever bound is tighter', () => {
    // maxEntries=3 is the binding constraint here (maxBytes is generous).
    let list: HistoryEntry[] = [];
    for (let i = 0; i < 5; i++) {
      list = capHistory(list, mkEntry(`id-${i}`), 3, 1_000_000);
    }
    expect(list.map((e) => e.id)).toEqual(['id-2', 'id-3', 'id-4']);
  });

  it('is pure — does not mutate the input array', () => {
    const original = [mkEntry('id-0')];
    const snapshotLength = original.length;
    capHistory(original, mkEntry('id-1'));
    expect(original).toHaveLength(snapshotLength);
  });
});

// ---------------------------------------------------------------------------
// isValidHistoryEntry
// ---------------------------------------------------------------------------

describe('isValidHistoryEntry', () => {
  it('accepts a well-formed entry', () => {
    const entry: HistoryEntry = {
      id: 'h1',
      ts: 1_700_000_000_000,
      label: 'Edited: Alex',
      record: emptyRecord(),
    };
    expect(isValidHistoryEntry(entry)).toBe(true);
  });

  it('rejects a non-object', () => {
    expect(isValidHistoryEntry(null)).toBe(false);
    expect(isValidHistoryEntry(undefined)).toBe(false);
    expect(isValidHistoryEntry('nope')).toBe(false);
    expect(isValidHistoryEntry(42)).toBe(false);
  });

  it('rejects a missing id', () => {
    const { id: _id, ...rest } = { id: 'h1', ts: 1, label: 'L', record: emptyRecord() };
    expect(isValidHistoryEntry(rest)).toBe(false);
  });

  it('rejects a non-number ts', () => {
    expect(
      isValidHistoryEntry({ id: 'h1', ts: '1700000000000', label: 'L', record: emptyRecord() }),
    ).toBe(false);
  });

  it('rejects a missing label', () => {
    expect(isValidHistoryEntry({ id: 'h1', ts: 1, record: emptyRecord() })).toBe(false);
  });

  it('rejects an entry whose record fails isValidRecord', () => {
    expect(isValidHistoryEntry({ id: 'h1', ts: 1, label: 'L', record: { garbage: true } })).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// sanitizeHistory
// ---------------------------------------------------------------------------

describe('sanitizeHistory', () => {
  it('coerces a non-array (or any garbage) to an empty array', () => {
    expect(sanitizeHistory(null)).toEqual([]);
    expect(sanitizeHistory(undefined)).toEqual([]);
    expect(sanitizeHistory({})).toEqual([]);
    expect(sanitizeHistory('garbage')).toEqual([]);
    expect(sanitizeHistory(42)).toEqual([]);
  });

  it('drops individually-invalid entries but keeps valid ones', () => {
    const valid: HistoryEntry = { id: 'h1', ts: 1, label: 'Good', record: emptyRecord() };
    const invalidRecord = { id: 'h2', ts: 2, label: 'Bad', record: { garbage: true } };
    const missingField = { id: 'h3', ts: 3, record: emptyRecord() }; // no label
    const result = sanitizeHistory([valid, invalidRecord, missingField]);
    expect(result).toEqual([valid]);
  });

  it('applies the entry-count cap to a persisted blob larger than HISTORY_MAX_ENTRIES', () => {
    const raw = Array.from({ length: HISTORY_MAX_ENTRIES + 10 }, (_, i) => ({
      id: `h-${i}`,
      ts: i,
      label: `L${i}`,
      record: emptyRecord(),
    }));
    const result = sanitizeHistory(raw);
    expect(result).toHaveLength(HISTORY_MAX_ENTRIES);
    // Newest entries retained (oldest 10 evicted).
    expect(result[0].id).toBe('h-10');
    expect(result[result.length - 1].id).toBe(`h-${HISTORY_MAX_ENTRIES + 9}`);
  });
});
