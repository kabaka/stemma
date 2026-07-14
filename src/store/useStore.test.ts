import { beforeEach, describe, expect, it } from 'vitest';
import { buildCatalog, useStore } from './useStore';

const reset = () => useStore.getState().resetRecord();

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
