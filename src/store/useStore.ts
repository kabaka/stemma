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
} from '@/domain/types';
import type { Palette } from '@/data/categories';
import { emptyRecord, seedRecord } from '@/data/seed';
import { CONDITIONS } from '@/data/conditions';
import { organsOf } from '@/domain/person';
import { linkRelative, removePerson, type Relation } from '@/domain/record';

/** The current calendar year, used as the "as of" date for age math. */
export const CURRENT_YEAR = new Date().getFullYear();

export type View = 'overview' | 'tree' | 'patterns' | 'timeline' | 'reports';

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
  replaceRecord: (record: FamilyRecord, extensions?: Condition[]) => void;
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

const cloneRecord = (r: FamilyRecord): FamilyRecord => structuredClone(r);

/**
 * Minimal shape guard for a hydrated record. The persisted record is the durable asset
 * ("a personal health record must outlive the app"), so a corrupt or schema-outdated
 * blob must degrade to a clean seed rather than crash or hydrate garbage into state.
 */
function isValidRecord(r: unknown): r is FamilyRecord {
  if (!r || typeof r !== 'object') return false;
  const rec = r as Partial<FamilyRecord>;
  return (
    Array.isArray(rec.people) &&
    Array.isArray(rec.unions) &&
    Array.isArray(rec.timeline) &&
    typeof rec.probandId === 'string' &&
    rec.people.some((p) => (p as Person | undefined)?.id === rec.probandId)
  );
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
        if (next === record) return ''; // anchor not found
        set({ record: next });
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
        set({ record });
      },

      deletePerson: (id) => {
        const state = get();
        const next = removePerson(state.record, id);
        if (next === state.record) return; // proband delete is a no-op
        set({
          record: next,
          selectedId: null,
          riskRoot: state.riskRoot === id ? next.probandId : state.riskRoot,
          tlPerson: state.tlPerson === id ? next.probandId : state.tlPerson,
        });
      },

      toggleCondition: (personId, condId) => {
        const record = cloneRecord(get().record);
        const person = record.people.find((p) => p.id === personId);
        if (!person) return;
        if (person.conds.some((c) => c.id === condId)) {
          person.conds = person.conds.filter((c) => c.id !== condId);
        } else {
          person.conds.push({ id: condId, onset: null, prov: 'self' });
        }
        set({ record });
      },

      setConditionField: (personId, condId, field, value) => {
        const record = cloneRecord(get().record);
        const person = record.people.find((p) => p.id === personId);
        const entry = person?.conds.find((c) => c.id === condId);
        if (!entry) return;
        if (field === 'onset') {
          const n = Number.parseInt(value, 10);
          // Preserve a genuine onset of 0 (congenital / at-birth); only '' or a
          // non-numeric value clears it. A plain `|| null` would drop age 0.
          entry.onset = value.trim() === '' || Number.isNaN(n) ? null : n;
        } else {
          entry.prov = value as Provenance;
        }
        set({ record });
      },

      toggleOrgan: (personId, organ) => {
        const record = cloneRecord(get().record);
        const person = record.people.find((p) => p.id === personId);
        if (!person) return;
        const cur = organsOf(person);
        person.organs = cur.includes(organ) ? cur.filter((o) => o !== organ) : [...cur, organ];
        set({ record });
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
        set({ record });
      },

      updateEvent: (id, patch) => {
        const record = cloneRecord(get().record);
        const idx = record.timeline.findIndex((e) => e.id === id);
        if (idx === -1) return;
        record.timeline[idx] = { ...record.timeline[idx], ...patch };
        set({ record });
      },

      deleteEvent: (id) => {
        const record = cloneRecord(get().record);
        record.timeline = record.timeline.filter((e) => e.id !== id);
        set({ record });
      },

      resetRecord: () => {
        const record = emptyRecord();
        set({ record, extensions: [], ...recordUi(record) });
      },

      loadSample: () => {
        const record = seedRecord();
        set({ record, extensions: [], ...recordUi(record) });
      },

      replaceRecord: (record, extensions) => {
        set({ record: cloneRecord(record), extensions: extensions ?? [], ...recordUi(record) });
      },
    }),
    {
      name: 'stemma-record',
      version: 1,
      // migrate handles explicit version bumps; merge validates on *every* hydration,
      // so a corrupt same-version blob also falls back to a clean seed.
      migrate: (persisted) => migratePersisted(persisted),
      merge: (persisted, current) => ({ ...current, ...migratePersisted(persisted) }),
      partialize: (s): PersistedState => ({
        record: s.record,
        extensions: s.extensions,
        palette: s.palette,
      }),
    },
  ),
);
