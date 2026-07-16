/**
 * Application state — a Zustand store persisted to localStorage.
 *
 * Local-first by design: the whole record lives in the browser and never leaves it
 * (roadmap §8, storage adapter #1). Persistence is scoped to the durable data (record,
 * long-tail catalog extensions, palette); transient UI state (current view, selection)
 * is not persisted. The mutation actions are ports of the prototype's, made immutable.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Condition,
  ConditionEntry,
  EventType,
  FamilyRecord,
  Organ,
  Person,
  Provenance,
  TimelineEvent,
  Union,
} from '@/domain/types';
import type { Palette } from '@/data/categories';
import { emptyRecord, seedRecord } from '@/data/seed';
import { CONDITIONS } from '@/data/conditions';
import { sanitizeExtensions } from '@/domain/catalog';
import { organsOf } from '@/domain/person';
import { isValidRecord, linkRelative, removePerson, type Relation } from '@/domain/record';
import { useHistoryStore } from './useHistoryStore';

/** The current calendar year, used as the "as of" date for age math. */
export const CURRENT_YEAR = new Date().getFullYear();

export type View = 'overview' | 'tree' | 'patterns' | 'timeline' | 'reports' | 'history';

export type { Relation };

/** Fields accepted when adding or editing a person. */
export interface PersonInput {
  name: string;
  sab: Person['sab'];
  gender: Person['gender'];
  pronouns?: string;
  organs?: Organ[];
  dead: boolean;
  birth: number | null;
  death: number | null;
  /** Condition ids to record (onset/provenance preserved on edit where possible). */
  condIds: string[];
}

interface PersistedState {
  record: FamilyRecord;
  /** Long-tail conditions attached via vocabulary search, merged into the catalog. */
  extensions: Condition[];
  palette: Palette;
}

interface UiState {
  view: View;
  selectedId: string | null;
  /** Vantage for pattern/screening computation (re-rootable). */
  riskRoot: string;
  /** Person whose timeline is shown. */
  tlPerson: string;
  tlType: EventType | 'all';
}

interface Actions {
  setView: (view: View) => void;
  setPalette: (palette: Palette) => void;
  selectPerson: (id: string | null) => void;
  setRiskRoot: (id: string) => void;
  setTlPerson: (id: string) => void;
  setTlType: (t: EventType | 'all') => void;

  addRelative: (anchorId: string, relation: Relation, input: PersonInput) => string;
  updatePerson: (id: string, input: PersonInput) => void;
  deletePerson: (id: string) => void;
  /** Patch a union's pedigree-structure flags (consanguinity, twin sets), matched by its
   * `parents` set (order-independent). A no-op if no union has exactly those parents. */
  updateUnion: (parents: string[], patch: Partial<Pick<Union, 'consanguineous' | 'twins'>>) => void;

  toggleCondition: (personId: string, condId: string) => void;
  setConditionField: (
    personId: string,
    condId: string,
    field: 'onset' | 'prov',
    value: string,
  ) => void;
  toggleOrgan: (personId: string, organ: Organ) => void;
  /** Register a long-tail condition in the catalog (from vocabulary search). */
  registerCondition: (condition: Condition) => void;

  addEvent: (event: Omit<TimelineEvent, 'id'>) => void;
  updateEvent: (id: string, patch: Partial<Omit<TimelineEvent, 'id'>>) => void;
  deleteEvent: (id: string) => void;

  /** Reset to an empty record (proband only). */
  resetRecord: () => void;
  /** Opt-in: load the fictional example family (for exploring the app). */
  loadSample: () => void;
  replaceRecord: (record: FamilyRecord, extensions?: Condition[], label?: string) => void;
}

export type Store = PersistedState & UiState & Actions;

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.floor(Math.random() * 1e9).toString(36)}`;

/**
 * UI state that depends on *which record* is loaded — re-pointed whenever the record is
 * swapped wholesale (reset / load sample / import), since the previous selection or risk
 * vantage may not exist in the new record. Deliberately excludes `view`: swapping the
 * record's data is not a navigation event, so wherever the user is looking (e.g. the
 * Pedigree view's own "Load example family" control) is left alone rather than bounced
 * to Overview out from under them.
 */
function recordUi(
  record: FamilyRecord,
): Pick<UiState, 'selectedId' | 'riskRoot' | 'tlPerson' | 'tlType'> {
  return {
    selectedId: null,
    riskRoot: record.probandId,
    tlPerson: record.probandId,
    tlType: 'all',
  };
}

/**
 * Clamp the transient vantage (selection + risk/timeline roots) to the record being hydrated.
 * On reload, the persisted `record` is restored but the vantage is transient UI state that
 * spread in from `current` (the fresh default store) — for an imported/restored record whose
 * proband is not `'you'`, that vantage points at a person the rehydrated record no longer
 * contains, so `detectPatterns`/`screeningsFor` hit their `if (!root) return []` guard and
 * silently render empty. Keep each value only when it still resolves to a real person in the
 * record (checked by actual id existence — never a truthy shortcut or a hardcoded `'you'`),
 * else fall back to `recordUi(record)` (the proband). `view`/`tlType` are left untouched.
 */
function reconcileVantage(
  record: FamilyRecord,
  current: Pick<UiState, 'selectedId' | 'riskRoot' | 'tlPerson'>,
): Pick<UiState, 'selectedId' | 'riskRoot' | 'tlPerson'> {
  const fallback = recordUi(record);
  const exists = (id: string | null): boolean =>
    id != null && record.people.some((p) => p.id === id);
  return {
    selectedId: exists(current.selectedId) ? current.selectedId : fallback.selectedId,
    riskRoot: exists(current.riskRoot) ? current.riskRoot : fallback.riskRoot,
    tlPerson: exists(current.tlPerson) ? current.tlPerson : fallback.tlPerson,
  };
}

const cloneRecord = (r: FamilyRecord): FamilyRecord => structuredClone(r);

/**
 * Commit a history-worthy record change: append a snapshot to the separate edit-history store,
 * then apply the record (plus any transient extras) to this store. This is the SOLE wall-clock
 * boundary for history — `Date.now()` is read here and nowhere in the pure diff/history domain.
 * A stored snapshot is deep-cloned so the history and the live record never share references.
 *
 * Non-changes must never record: every action keeps its existing no-op early-returns BEFORE
 * calling `commit`, so a refused edit (proband delete, third-parent cap, no-matching-union,
 * invalid replaceRecord) leaves the log untouched.
 */
function commit(
  set: (partial: Partial<Store>) => void,
  next: FamilyRecord,
  label: string,
  extra?: Partial<Store>,
): void {
  useHistoryStore.getState().push({ ts: Date.now(), label, record: cloneRecord(next) });
  set({ record: next, ...extra });
}

/** Coerce a persisted blob (any version) into a valid PersistedState, or reset to seed. */
function migratePersisted(persisted: unknown): PersistedState {
  const s = (persisted ?? {}) as Partial<PersistedState>;
  if (!isValidRecord(s.record)) {
    return { record: emptyRecord(), extensions: [], palette: 'default' };
  }
  return {
    record: s.record,
    extensions: Array.isArray(s.extensions) ? s.extensions : [],
    palette: s.palette === 'colorblind' ? 'colorblind' : 'default',
  };
}

const initial = emptyRecord();

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      record: initial,
      extensions: [],
      palette: 'default',
      view: 'overview',
      ...recordUi(initial),

      setView: (view) => set({ view }),
      // Swaps only the CategoryKey → colour mapping read via `categoryColor` (see
      // src/data/categories.ts). Severity/screening/band/event colours are intentionally
      // out of scope — they're always paired with a text label, so they're not a 1.4.1 risk.
      setPalette: (palette) => set({ palette }),
      selectPerson: (selectedId) => set({ selectedId }),
      setRiskRoot: (riskRoot) => set({ riskRoot }),
      setTlPerson: (tlPerson) => set({ tlPerson, tlType: 'all' }),
      setTlType: (tlType) => set({ tlType }),

      addRelative: (anchorId, relation, input) => {
        const id = newId();
        // Build the person here (id + condition entries); the domain links it into the
        // graph (unions, generation, layout). gen/x are placeholders — linkRelative sets them.
        const person: Person = {
          id,
          name: input.name.trim(),
          sab: input.sab,
          gender: input.gender,
          pronouns: input.pronouns,
          organs: input.organs,
          gen: 0,
          x: 0,
          dead: input.dead,
          birth: input.birth,
          death: input.dead ? input.death : null,
          conds: input.condIds.map((cid) => ({ id: cid, onset: null, prov: 'self' as Provenance })),
        };
        const record = get().record;
        const next = linkRelative(record, anchorId, relation, person);
        // linkRelative returns the same reference on any no-op — anchor not found, or the
        // two-parent cap refusing a third parent. Report it as '' so callers don't select
        // a person that was never added.
        if (next === record) return '';
        commit(set, next, `Added relative: ${person.name}`);
        return id;
      },

      updatePerson: (id, input) => {
        const record = cloneRecord(get().record);
        const person = record.people.find((p) => p.id === id);
        if (!person) return;
        // Preserve onset/provenance for conditions already recorded.
        const prevById = new Map(person.conds.map((c) => [c.id, c]));
        person.name = input.name.trim();
        person.sab = input.sab;
        person.gender = input.gender;
        person.pronouns = input.pronouns;
        person.organs = input.organs;
        person.dead = input.dead;
        // Direct assignment so an explicit null can clear a birth year to "unknown"
        // (a `?? person.birth` would make the field impossible to blank).
        person.birth = input.birth;
        person.death = input.dead ? input.death : null;
        person.conds = input.condIds.map(
          (cid): ConditionEntry => prevById.get(cid) ?? { id: cid, onset: null, prov: 'self' },
        );
        commit(set, record, `Edited: ${person.name}`);
      },

      updateUnion: (parents, patch) => {
        const record = get().record;
        const target = new Set(parents);
        // Same-members match, order-independent: same count and every parent present.
        const matches = (u: Union): boolean =>
          u.parents.length === target.size && u.parents.every((p) => target.has(p));
        if (!record.unions.some(matches)) return; // no such union — no-op, record left unchanged
        const next = cloneRecord(record);
        const union = next.unions.find(matches);
        if (union) Object.assign(union, patch);
        commit(set, next, 'Updated family union');
      },

      deletePerson: (id) => {
        const state = get();
        // Capture the name BEFORE removal so the history label survives the delete.
        const name = state.record.people.find((p) => p.id === id)?.name ?? '';
        const next = removePerson(state.record, id);
        if (next === state.record) return; // proband delete is a no-op
        commit(set, next, `Deleted: ${name}`, {
          selectedId: null,
          riskRoot: state.riskRoot === id ? next.probandId : state.riskRoot,
          tlPerson: state.tlPerson === id ? next.probandId : state.tlPerson,
        });
      },

      toggleCondition: (personId, condId) => {
        const record = cloneRecord(get().record);
        const person = record.people.find((p) => p.id === personId);
        if (!person) return;
        const removing = person.conds.some((c) => c.id === condId);
        if (removing) {
          person.conds = person.conds.filter((c) => c.id !== condId);
        } else {
          person.conds.push({ id: condId, onset: null, prov: 'self' });
        }
        commit(set, record, `${removing ? 'Removed' : 'Added'} condition on ${person.name}`);
      },

      setConditionField: (personId, condId, field, value) => {
        const record = cloneRecord(get().record);
        const person = record.people.find((p) => p.id === personId);
        const entry = person?.conds.find((c) => c.id === condId);
        if (!person || !entry) return;
        if (field === 'onset') {
          const n = Number.parseInt(value, 10);
          // Preserve a genuine onset of 0 (congenital / at-birth); only '' or a
          // non-numeric value clears it. A plain `|| null` would drop age 0.
          entry.onset = value.trim() === '' || Number.isNaN(n) ? null : n;
        } else {
          entry.prov = value as Provenance;
        }
        commit(set, record, `Edited condition on ${person.name}`);
      },

      toggleOrgan: (personId, organ) => {
        const record = cloneRecord(get().record);
        const person = record.people.find((p) => p.id === personId);
        if (!person) return;
        const cur = organsOf(person);
        person.organs = cur.includes(organ) ? cur.filter((o) => o !== organ) : [...cur, organ];
        commit(set, record, `Updated organs for ${person.name}`);
      },

      registerCondition: (condition) => {
        const { extensions } = get();
        if (
          extensions.some((c) => c.id === condition.id) ||
          CONDITIONS.some((c) => c.id === condition.id)
        )
          return;
        set({ extensions: [...extensions, condition] });
      },

      addEvent: (event) => {
        const record = cloneRecord(get().record);
        record.timeline.push({ ...event, id: newId() });
        commit(set, record, `Added event: ${event.title}`);
      },

      updateEvent: (id, patch) => {
        const record = cloneRecord(get().record);
        const idx = record.timeline.findIndex((e) => e.id === id);
        if (idx === -1) return;
        record.timeline[idx] = { ...record.timeline[idx], ...patch };
        commit(set, record, `Edited event: ${record.timeline[idx].title}`);
      },

      deleteEvent: (id) => {
        // Not-found guard mirrors updateEvent's `if (idx === -1) return;` above — filter() always
        // returns a fresh array even on no match, so without this a delete of an unknown id would
        // record a spurious, content-identical "Deleted event" history entry.
        if (!get().record.timeline.some((e) => e.id === id)) return;
        const record = cloneRecord(get().record);
        record.timeline = record.timeline.filter((e) => e.id !== id);
        commit(set, record, 'Deleted event');
      },

      resetRecord: () => {
        const record = emptyRecord();
        // Route through commit so the reset itself is recorded — history is NOT cleared, so the
        // pre-reset state remains recoverable via the log.
        commit(set, record, 'Reset to empty record', { extensions: [], ...recordUi(record) });
      },

      loadSample: () => {
        const record = seedRecord();
        commit(set, record, 'Loaded sample family', { extensions: [], ...recordUi(record) });
      },

      replaceRecord: (record, extensions, label) => {
        // The first real callers of this action hand it externally-built records (GEDCOM
        // import, native-backup restore, and future FHIR-pull). Validate at this boundary —
        // the same guard the persist layer applies at hydration — so a malformed record can
        // never overwrite good state; an invalid one is ignored rather than swapped in. The
        // extensions are sanitised here too (not just trusted from the caller) so a future
        // producer can't reintroduce the shadow-a-curated-condition / unknown-category risk.
        if (!isValidRecord(record)) return;
        commit(set, cloneRecord(record), label ?? 'Replaced record', {
          extensions: sanitizeExtensions(extensions ?? []),
          ...recordUi(record),
        });
      },
    }),
    {
      name: 'stemma-record',
      version: 1,
      // migrate handles explicit version bumps; merge validates on *every* hydration,
      // so a corrupt same-version blob also falls back to a clean seed.
      migrate: (persisted) => migratePersisted(persisted),
      // Re-point the transient vantage at the hydrated record: spread the fresh defaults
      // (`current`), then the persisted durable data (`migrated`), then clamp selection/roots
      // so they resolve to a person that actually exists in the restored record.
      merge: (persisted, current) => {
        const migrated = migratePersisted(persisted);
        return { ...current, ...migrated, ...reconcileVantage(migrated.record, current) };
      },
      partialize: (s): PersistedState => ({
        record: s.record,
        extensions: s.extensions,
        palette: s.palette,
      }),
    },
  ),
);
