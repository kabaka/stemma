/**
 * Append-only edit-history store — a SEPARATE Zustand `persist` store from the main record
 * store (`useStore`), with its own `stemma-history` localStorage key.
 *
 * Failure isolation is the whole point of the split: the durable asset is the family record,
 * and a corrupt or oversized history must never be able to break it. Keeping history under its
 * own key means hydration of one cannot poison the other, and {@link sanitizeHistory} fails the
 * history closed to `[]` on any garbage rather than propagating.
 *
 * Local-first, private by default (guardrail #5): this is an in-browser edit log — no network,
 * no clinical analysis, no risk numbers, no advisory text. It just records what the user changed.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { capHistory, sanitizeHistory, type HistoryEntry } from '@/domain/history';

/** Same id scheme as `useStore.newId` — `crypto.randomUUID` with a deterministic-ish fallback. */
const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.floor(Math.random() * 1e9).toString(36)}`;

interface HistoryState {
  entries: HistoryEntry[];
}

interface HistoryActions {
  /** Append a snapshot (the store assigns its `id`); caps are applied by {@link capHistory}. */
  push: (entry: Omit<HistoryEntry, 'id'>) => void;
  /** Clear the entire log. */
  clear: () => void;
}

export type HistoryStore = HistoryState & HistoryActions;

/** `sanitizeHistory(persisted?.entries ?? persisted)` — accepts both the partialized `{entries}`
 * shape and a bare array, and fails closed to `[]` on anything malformed. */
const hydrateEntries = (persisted: unknown): HistoryEntry[] =>
  sanitizeHistory((persisted as { entries?: unknown } | null | undefined)?.entries ?? persisted);

export const useHistoryStore = create<HistoryStore>()(
  persist(
    (set, get) => ({
      entries: [],
      push: (entry) => set({ entries: capHistory(get().entries, { ...entry, id: newId() }) }),
      clear: () => set({ entries: [] }),
    }),
    {
      name: 'stemma-history',
      version: 1,
      // A profile with no `stemma-history` key hydrates `entries: []` (persisted is undefined →
      // sanitizeHistory(undefined) → []). Both migrate and merge re-validate on every hydration.
      migrate: (persisted): HistoryState => ({ entries: hydrateEntries(persisted) }),
      merge: (persisted, current): HistoryStore => ({
        ...current,
        entries: hydrateEntries(persisted),
      }),
      partialize: (s): HistoryState => ({ entries: s.entries }),
    },
  ),
);
