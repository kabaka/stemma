import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './useStore';
import { buildCatalog } from '@/domain/catalog';
import type { FamilyRecord } from '@/domain/types';

// Most mutation tests operate on the example family, so load it explicitly (the app's
// real default is now an empty record — see the "default record" block below).
const reset = () => useStore.getState().loadSample();

describe('default record', () => {
  it('starts empty (proband only) — never the fictional example family', () => {
    useStore.getState().resetRecord();
    const record = useStore.getState().record;
    expect(record.people).toHaveLength(1);
    expect(record.people[0].isProband).toBe(true);
    expect(record.people[0].name).toBe('You');
    expect(record.people[0].conds).toEqual([]);
    expect(record.unions).toEqual([]);
    expect(record.timeline).toEqual([]);
  });

  it('loads the example family only on explicit opt-in', () => {
    useStore.getState().resetRecord();
    expect(useStore.getState().record.people.length).toBe(1);
    useStore.getState().loadSample();
    expect(useStore.getState().record.people.length).toBeGreaterThan(1);
    expect(useStore.getState().record.people.some((p) => p.name === 'Maya')).toBe(true);
  });
});

describe('store mutations', () => {
  beforeEach(reset);

  it('adds a child and links it into a union', () => {
    const before = useStore.getState().record.people.length;
    const id = useStore.getState().addRelative('you', 'child', {
      name: 'Newkid',
      sab: 'f',
      gender: 'woman',
      dead: false,
      birth: 2024,
      death: null,
      condIds: [],
    });
    const state = useStore.getState();
    expect(state.record.people).toHaveLength(before + 1);
    const child = state.record.people.find((p) => p.id === id)!;
    expect(child.name).toBe('Newkid');
    // Linked as a child of a union containing the proband.
    expect(
      state.record.unions.some((u) => u.parents.includes('you') && u.children.includes(id)),
    ).toBe(true);
  });

  it('toggles a condition on and off', () => {
    useStore.getState().toggleCondition('alex', 't2d');
    expect(
      useStore
        .getState()
        .record.people.find((p) => p.id === 'alex')!
        .conds.some((c) => c.id === 't2d'),
    ).toBe(true);
    useStore.getState().toggleCondition('alex', 't2d');
    expect(
      useStore
        .getState()
        .record.people.find((p) => p.id === 'alex')!
        .conds.some((c) => c.id === 't2d'),
    ).toBe(false);
  });

  it('edits a condition entry field', () => {
    useStore.getState().toggleCondition('alex', 't2d');
    useStore.getState().setConditionField('alex', 't2d', 'onset', '55');
    useStore.getState().setConditionField('alex', 't2d', 'prov', 'record');
    const entry = useStore
      .getState()
      .record.people.find((p) => p.id === 'alex')!
      .conds.find((c) => c.id === 't2d')!;
    expect(entry.onset).toBe(55);
    expect(entry.prov).toBe('record');
  });

  it('preserves a congenital onset age of 0 (does not collapse to null)', () => {
    useStore.getState().toggleCondition('alex', 'celiac');
    useStore.getState().setConditionField('alex', 'celiac', 'onset', '0');
    const entry = useStore
      .getState()
      .record.people.find((p) => p.id === 'alex')!
      .conds.find((c) => c.id === 'celiac')!;
    expect(entry.onset).toBe(0);
    // Blanking the field clears it back to unknown.
    useStore.getState().setConditionField('alex', 'celiac', 'onset', '');
    expect(
      useStore
        .getState()
        .record.people.find((p) => p.id === 'alex')!
        .conds.find((c) => c.id === 'celiac')!.onset,
    ).toBeNull();
  });

  it('updatePerson can clear a birth year to unknown', () => {
    useStore.getState().updatePerson('alex', {
      name: 'Alex',
      sab: 'm',
      gender: 'man',
      dead: false,
      birth: null,
      death: null,
      condIds: [],
    });
    expect(useStore.getState().record.people.find((p) => p.id === 'alex')!.birth).toBeNull();
  });

  it('never deletes the proband', () => {
    useStore.getState().deletePerson('you');
    expect(useStore.getState().record.people.some((p) => p.id === 'you')).toBe(true);
  });

  it('deletes a relative and prunes empty unions', () => {
    const before = useStore.getState().record.people.length;
    useStore.getState().deletePerson('leo');
    const state = useStore.getState();
    expect(state.record.people).toHaveLength(before - 1);
    expect(state.record.people.some((p) => p.id === 'leo')).toBe(false);
  });

  it('adds and removes timeline events', () => {
    const before = useStore.getState().record.timeline.length;
    useStore
      .getState()
      .addEvent({ person: 'you', year: 2027, type: 'visit', title: 'Checkup', detail: '' });
    const added = useStore.getState().record.timeline;
    expect(added).toHaveLength(before + 1);
    const ev = added.find((e) => e.title === 'Checkup')!;
    useStore.getState().deleteEvent(ev.id);
    expect(useStore.getState().record.timeline).toHaveLength(before);
  });

  it('registers a long-tail condition once', () => {
    const cond = {
      id: 'C50.911',
      name: 'Malignant neoplasm of right female breast',
      cat: 'other' as const,
      base: 0,
      pattern: '—',
    };
    useStore.getState().registerCondition(cond);
    useStore.getState().registerCondition(cond);
    expect(useStore.getState().extensions.filter((c) => c.id === 'C50.911')).toHaveLength(1);
    // And it shows up in a freshly built catalog.
    expect(buildCatalog(useStore.getState().extensions).has('C50.911')).toBe(true);
  });
});

describe('toggleOrgan', () => {
  beforeEach(reset);

  it('materializes the sab-derived defaults on first toggle, then toggles from the explicit set', () => {
    // Maya (sab 'f') has no explicit organ inventory recorded — it's implied by defaultOrgans.
    expect(useStore.getState().record.people.find((p) => p.id === 'you')!.organs).toBeUndefined();

    useStore.getState().toggleOrgan('you', 'prostate');
    expect(useStore.getState().record.people.find((p) => p.id === 'you')!.organs).toEqual([
      'breasts',
      'ovaries',
      'uterus',
      'cervix',
      'prostate',
    ]);

    useStore.getState().toggleOrgan('you', 'breasts');
    expect(useStore.getState().record.people.find((p) => p.id === 'you')!.organs).toEqual([
      'ovaries',
      'uterus',
      'cervix',
      'prostate',
    ]);
  });
});

describe('updatePerson', () => {
  beforeEach(reset);

  it('preserves onset/provenance for a kept condition and defaults a newly-added one', () => {
    // Robert starts with cad {60,'record'}, htn {52,'record'}, chol {48,'record'}.
    useStore.getState().updatePerson('robert', {
      name: 'Robert',
      sab: 'm',
      gender: 'man',
      dead: false,
      birth: 1965,
      death: null,
      condIds: ['cad', 't2d'], // keep cad, drop htn/chol, add t2d
    });
    const robert = useStore.getState().record.people.find((p) => p.id === 'robert')!;
    expect(robert.conds).toEqual([
      { id: 'cad', onset: 60, prov: 'record' },
      { id: 't2d', onset: null, prov: 'self' },
    ]);
  });
});

describe('replaceRecord', () => {
  beforeEach(reset);

  it('swaps the record and resets vantage state and extensions', () => {
    useStore.getState().setRiskRoot('robert');
    useStore.getState().selectPerson('robert');
    useStore
      .getState()
      .registerCondition({ id: 'X1', name: 'X', cat: 'other', base: 0, pattern: '—' });
    expect(useStore.getState().extensions).toHaveLength(1);

    const minimal: FamilyRecord = {
      people: [
        {
          id: 'p1',
          name: 'P1',
          sab: 'f',
          gender: 'woman',
          gen: 0,
          x: 0,
          dead: false,
          birth: 2000,
          death: null,
          conds: [],
          isProband: true,
        },
      ],
      unions: [],
      timeline: [],
      probandId: 'p1',
    };
    useStore.getState().replaceRecord(minimal);

    const state = useStore.getState();
    expect(state.record.people).toHaveLength(1);
    expect(state.record.probandId).toBe('p1');
    expect(state.riskRoot).toBe('p1');
    expect(state.tlPerson).toBe('p1');
    expect(state.selectedId).toBeNull();
    expect(state.extensions).toEqual([]);
  });

  it('ignores an invalid record rather than overwriting good state', () => {
    const before = useStore.getState().record; // the loaded example family
    // probandId references nobody → fails isValidRecord; must be a no-op.
    const invalid = {
      people: [],
      unions: [],
      timeline: [],
      probandId: 'ghost',
    } as unknown as FamilyRecord;
    useStore.getState().replaceRecord(invalid);
    expect(useStore.getState().record).toBe(before);
  });
});

describe('record-swap actions leave navigation state alone', () => {
  beforeEach(reset);

  // Regression test for a UI bug: PedigreeView keeps its own highlight/add-form state
  // in local useState, which survives a record swap because loadSample()/resetRecord()/
  // replaceRecord() never unmount the view. That local state has to be cleared by the
  // view itself — but only because the store side of the contract genuinely holds:
  // swapping the record is not a navigation event, so `view` (and nothing else in
  // UiState) is untouched by any of the three swap actions. Pin that contract here so
  // a future change to `recordUi()` can't silently start bouncing the user to Overview.
  it('never resets `view` — swapping the record is not a navigation event', () => {
    useStore.getState().setView('tree');

    useStore.getState().loadSample();
    expect(useStore.getState().view).toBe('tree');

    useStore.getState().resetRecord();
    expect(useStore.getState().view).toBe('tree');

    const minimal: FamilyRecord = {
      people: [
        {
          id: 'p1',
          name: 'P1',
          sab: 'f',
          gender: 'woman',
          gen: 0,
          x: 0,
          dead: false,
          birth: 2000,
          death: null,
          conds: [],
          isProband: true,
        },
      ],
      unions: [],
      timeline: [],
      probandId: 'p1',
    };
    useStore.getState().replaceRecord(minimal);
    expect(useStore.getState().view).toBe('tree');
  });
});

describe('deletePerson (vantage reset)', () => {
  beforeEach(reset);

  it('resets riskRoot to the proband when the deleted person was the current vantage', () => {
    useStore.getState().setRiskRoot('robert');
    useStore.getState().deletePerson('robert');
    expect(useStore.getState().riskRoot).toBe(useStore.getState().record.probandId);
  });

  it('leaves riskRoot untouched when the deleted person was not the vantage', () => {
    useStore.getState().setRiskRoot('you');
    useStore.getState().deletePerson('leo');
    expect(useStore.getState().riskRoot).toBe('you');
  });
});

describe('persistence', () => {
  beforeEach(reset);

  it('partializes to record/extensions/palette only — never transient UI state', () => {
    useStore.getState().setView('timeline');
    useStore.getState().selectPerson('robert');
    useStore.getState().setRiskRoot('robert');

    const raw = localStorage.getItem('stemma-record');
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(persisted.state).toHaveProperty('record');
    expect(persisted.state).toHaveProperty('extensions');
    expect(persisted.state).toHaveProperty('palette');
    expect(persisted.state).not.toHaveProperty('view');
    expect(persisted.state).not.toHaveProperty('selectedId');
    expect(persisted.state).not.toHaveProperty('riskRoot');
  });

  it('falls back to a clean empty record when a persisted blob fails the record shape guard', async () => {
    localStorage.setItem(
      'stemma-record',
      JSON.stringify({ state: { record: { garbage: true } }, version: 1 }),
    );
    await useStore.persist.rehydrate();
    const state = useStore.getState();
    expect(state.record.probandId).toBe('you');
    expect(state.record.people.length).toBeGreaterThan(0);
  });
});
