import { beforeEach, describe, expect, it } from 'vitest';
import { useHistoryStore } from './useHistoryStore';
import { HISTORY_MAX_ENTRIES } from '@/domain/history';
import { emptyRecord } from '@/data/seed';

beforeEach(() => useHistoryStore.setState({ entries: [] }));

describe('useHistoryStore.push', () => {
  it('appends an entry and assigns it an id', () => {
    useHistoryStore
      .getState()
      .push({ ts: 1, label: 'Added relative: Jane', record: emptyRecord() });
    const { entries } = useHistoryStore.getState();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toEqual(expect.any(String));
    expect(entries[0].id.length).toBeGreaterThan(0);
    expect(entries[0].label).toBe('Added relative: Jane');
    expect(entries[0].ts).toBe(1);
  });

  it('appends in order, newest last', () => {
    useHistoryStore.getState().push({ ts: 1, label: 'First', record: emptyRecord() });
    useHistoryStore.getState().push({ ts: 2, label: 'Second', record: emptyRecord() });
    const { entries } = useHistoryStore.getState();
    expect(entries.map((e) => e.label)).toEqual(['First', 'Second']);
  });

  it('assigns distinct ids to successive pushes', () => {
    useHistoryStore.getState().push({ ts: 1, label: 'First', record: emptyRecord() });
    useHistoryStore.getState().push({ ts: 2, label: 'Second', record: emptyRecord() });
    const { entries } = useHistoryStore.getState();
    expect(entries[0].id).not.toBe(entries[1].id);
  });

  it('caps the log at HISTORY_MAX_ENTRIES when pushed past the limit', () => {
    for (let i = 0; i < HISTORY_MAX_ENTRIES + 5; i++) {
      useHistoryStore.getState().push({ ts: i, label: `Change ${i}`, record: emptyRecord() });
    }
    const { entries } = useHistoryStore.getState();
    expect(entries).toHaveLength(HISTORY_MAX_ENTRIES);
    // The oldest 5 were evicted; the newest survives.
    expect(entries[entries.length - 1].label).toBe(`Change ${HISTORY_MAX_ENTRIES + 4}`);
    expect(entries.some((e) => e.label === 'Change 0')).toBe(false);
  });
});

describe('useHistoryStore.clear', () => {
  it('empties the log', () => {
    useHistoryStore.getState().push({ ts: 1, label: 'First', record: emptyRecord() });
    expect(useHistoryStore.getState().entries).toHaveLength(1);
    useHistoryStore.getState().clear();
    expect(useHistoryStore.getState().entries).toEqual([]);
  });

  it('is a no-op on an already-empty log', () => {
    useHistoryStore.getState().clear();
    expect(useHistoryStore.getState().entries).toEqual([]);
  });
});
