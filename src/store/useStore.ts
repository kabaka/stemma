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
import { seedRecord } from '@/data/seed';
import { CONDITIONS, COMMON_CONDITIONS } from '@/data/conditions';
import { CATEGORY_LABELS } from '@/data/categories';
import { createCatalog, type Catalog } from '@/domain/catalog';
import { organsOf } from '@/domain/person';

/** The current calendar year, used as the "as of" date for age math. */
export const CURRENT_YEAR = new Date().getFullYear();

export type View = 'overview' | 'tree' | 'patterns' | 'timeline' | 'reports';

export type Relation = 'partner' | 'child' | 'sibling' | 'parent';

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

  resetRecord: () => void;
  replaceRecord: (record: FamilyRecord, extensions?: Condition[]) => void;
}

export type Store = PersistedState & UiState & Actions;

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.floor(Math.random() * 1e9).toString(36)}`;

function initialUi(record: FamilyRecord): UiState {
  return {
    view: 'overview',
    selectedId: null,
    riskRoot: record.probandId,
    tlPerson: record.probandId,
    tlType: 'all',
  };
}

const cloneRecord = (r: FamilyRecord): FamilyRecord => structuredClone(r);

const seed = seedRecord();

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      record: seed,
      extensions: [],
      palette: 'default',
      ...initialUi(seed),

      setView: (view) => set({ view }),
      setPalette: (palette) => set({ palette }),
      selectPerson: (selectedId) => set({ selectedId }),
      setRiskRoot: (riskRoot) => set({ riskRoot }),
      setTlPerson: (tlPerson) => set({ tlPerson, tlType: 'all' }),
      setTlType: (tlType) => set({ tlType }),

      addRelative: (anchorId, relation, input) => {
        const record = cloneRecord(get().record);
        const anchor =
          record.people.find((p) => p.id === anchorId) ?? record.people.find((p) => p.isProband);
        if (!anchor) return '';
        const id = newId();
        const person: Person = {
          id,
          name: input.name.trim(),
          sab: input.sab,
          gender: input.gender,
          pronouns: input.pronouns,
          organs: input.organs,
          gen: anchor.gen,
          x: anchor.x + 84,
          dead: input.dead,
          birth: input.birth,
          death: input.dead ? input.death : null,
          conds: input.condIds.map((cid) => ({ id: cid, onset: null, prov: 'self' as Provenance })),
        };

        if (relation === 'partner') {
          record.unions.push({ parents: [anchor.id, id], children: [] });
        } else if (relation === 'child') {
          let u = record.unions.find((x) => x.parents.includes(anchor.id));
          if (!u) {
            u = { parents: [anchor.id], children: [] };
            record.unions.push(u);
          }
          u.children.push(id);
          person.gen = anchor.gen + 1;
          const px = u.parents.map((pid) => record.people.find((p) => p.id === pid)?.x ?? anchor.x);
          person.x = px.reduce((s, v) => s + v, 0) / px.length;
        } else if (relation === 'sibling') {
          let u = record.unions.find((x) => x.children.includes(anchor.id));
          if (!u) {
            u = { parents: [], children: [anchor.id] };
            record.unions.push(u);
          }
          u.children.push(id);
          person.gen = anchor.gen;
        } else {
          // parent
          let u = record.unions.find((x) => x.children.includes(anchor.id));
          if (!u) {
            u = { parents: [], children: [anchor.id] };
            record.unions.push(u);
          }
          u.parents.push(id);
          person.gen = anchor.gen - 1;
        }

        record.people.push(person);
        set({ record });
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
        person.birth = input.birth ?? person.birth;
        person.death = input.dead ? input.death : null;
        person.conds = input.condIds.map(
          (cid): ConditionEntry => prevById.get(cid) ?? { id: cid, onset: null, prov: 'self' },
        );
        set({ record });
      },

      deletePerson: (id) => {
        const state = get();
        if (id === state.record.probandId) return;
        const record = cloneRecord(state.record);
        record.people = record.people.filter((p) => p.id !== id);
        record.unions = record.unions
          .map((u) => ({
            ...u,
            parents: u.parents.filter((x) => x !== id),
            children: u.children.filter((x) => x !== id),
          }))
          .filter((u) => u.parents.length + u.children.length > 1);
        set({
          record,
          selectedId: null,
          riskRoot: state.riskRoot === id ? record.probandId : state.riskRoot,
          tlPerson: state.tlPerson === id ? record.probandId : state.tlPerson,
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
          entry.onset = value === '' ? null : Number.parseInt(value, 10) || null;
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
        const record = seedRecord();
        set({ record, extensions: [], ...initialUi(record) });
      },

      replaceRecord: (record, extensions) => {
        set({ record: cloneRecord(record), extensions: extensions ?? [], ...initialUi(record) });
      },
    }),
    {
      name: 'stemma-record',
      version: 1,
      partialize: (s): PersistedState => ({
        record: s.record,
        extensions: s.extensions,
        palette: s.palette,
      }),
    },
  ),
);

/** Build the merged catalog (curated + user extensions). */
export function buildCatalog(extensions: Condition[]): Catalog {
  return createCatalog([...CONDITIONS, ...extensions], [...COMMON_CONDITIONS], CATEGORY_LABELS);
}
