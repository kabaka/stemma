import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, type Relation } from '@/store/useStore';
import { useCatalog, useRelations } from '../hooks';
import { indexPeople, parentsOf } from '@/domain/graph';
import {
  ORGANS,
  ORGAN_LABELS,
  defaultOrgans,
  genderLabel,
  organsOf,
  sabLabel,
  sabOf,
} from '@/domain/person';
import { MAX_PARENTS } from '@/domain/record';
import { categoryColor } from '@/data/categories';
import type { Gender, Organ, Sab } from '@/domain/types';

/** What opened the form: a fresh relative anchored to (and related to) an existing
 * person, or an edit of an existing person. Both the anchor and the relation are
 * editable within the form once open — this is only the default it opens with. */
export type PersonFormState =
  { mode: 'add'; anchor: string; relation: Relation } | { mode: 'edit'; id: string };

// Derive the toggle labels from the domain's own `sabLabel`/`genderLabel` so this form
// speaks the exact vocabulary the rest of the app does — "AFAB"/"AMAB"/"unknown" for sex
// assigned at birth (NOT "Female"/"Male", which would blur the deliberate gap from the
// gender axis and mismatch the drawer this modal opens from) and "Woman"/"Man"/"Nonbinary"
// for gender. Also keeps a bare "?"/"NB" — ambiguous to a screen reader — out of the UI.
const SAB_OPTIONS: { value: Sab; label: string }[] = (['f', 'm', 'u'] as Sab[]).map((value) => ({
  value,
  label: sabLabel(value),
}));

const GENDER_OPTIONS: { value: Gender; label: string }[] = (['woman', 'man', 'nb'] as Gender[]).map(
  (value) => ({ value, label: genderLabel(value) }),
);

const RELATION_OPTIONS: { value: Relation; label: string }[] = [
  { value: 'parent', label: 'Parent ↑' },
  { value: 'partner', label: 'Partner ↔' },
  { value: 'sibling', label: 'Sibling ⇔' },
  { value: 'child', label: 'Child ↓' },
];

/** Parse a string-backed year field: blank or non-numeric clears to "unknown" (`null`)
 * rather than snapping to 0 — mirrors the store's own onset-field parsing. */
function parseYear(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isNaN(n) ? null : n;
}

/** The element focused just before the modal opened — restored on close. Module-level
 * like PersonDrawer's equivalent, since only one PersonForm is ever mounted at a time. */
let lastTriggerEl: HTMLElement | SVGElement | null = null;

function SegButton({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="seg-btn" aria-pressed={pressed} onClick={onClick}>
      {label}
    </button>
  );
}

/**
 * The add/edit modal for a person — the single source of truth for creating a new
 * relative (anchored to + related to an existing person) or editing an existing one.
 * Conditions here are a plain multi-select (chips + catalog search); onset/provenance
 * stay the drawer's `ConditionPicker`'s job — `updatePerson` preserves them for any
 * condition that was already recorded.
 */
export function PersonForm({ state, onClose }: { state: PersonFormState; onClose: () => void }) {
  const record = useStore((s) => s.record);
  const addRelative = useStore((s) => s.addRelative);
  const updatePerson = useStore((s) => s.updatePerson);
  const deletePerson = useStore((s) => s.deletePerson);
  const selectPerson = useStore((s) => s.selectPerson);
  const catalog = useCatalog();
  const palette = useStore((s) => s.palette);
  const relations = useRelations(record.probandId);

  const idx = useMemo(
    () => indexPeople(record.people, record.unions),
    [record.people, record.unions],
  );

  // Lazy initial values — read once at mount (this component is only ever mounted for
  // the lifetime of one open→close cycle; PedigreeView re-mounts it fresh per open).
  const editTarget =
    state.mode === 'edit' ? record.people.find((p) => p.id === state.id) : undefined;

  const [anchor, setAnchor] = useState(state.mode === 'add' ? state.anchor : '');
  const [relation, setRelation] = useState<Relation>(
    state.mode === 'add' ? state.relation : 'child',
  );
  const [name, setName] = useState(editTarget?.name ?? '');
  const [sab, setSabState] = useState<Sab>(() => (editTarget ? sabOf(editTarget) : 'f'));
  const [gender, setGender] = useState<Gender>(editTarget?.gender ?? 'woman');
  const [pronouns, setPronouns] = useState(editTarget?.pronouns ?? '');
  const [organs, setOrgans] = useState<Organ[]>(() =>
    editTarget ? organsOf(editTarget) : defaultOrgans('f'),
  );
  const [dead, setDead] = useState(editTarget?.dead ?? false);
  const [birth, setBirth] = useState(() => (editTarget ? String(editTarget.birth ?? '') : '2000'));
  const [death, setDeath] = useState(() =>
    editTarget?.death != null ? String(editTarget.death) : '',
  );
  const [selectedCondIds, setSelectedCondIds] = useState<string[]>(
    () => editTarget?.conds.map((c) => c.id) ?? [],
  );
  const [query, setQuery] = useState('');

  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const anchorId = useId();
  const relationId = useId();
  const nameId = useId();
  const sabGroupId = useId();
  const statusGroupId = useId();
  const genderGroupId = useId();
  const pronounsId = useId();
  const birthId = useId();
  const deathId = useId();
  const searchId = useId();

  // Move focus into the dialog on open, and hand it back to whatever triggered it on
  // close — same discipline as PersonDrawer.
  useEffect(() => {
    const active = document.activeElement;
    lastTriggerEl = active instanceof HTMLElement || active instanceof SVGElement ? active : null;
    dialogRef.current?.focus();
    return () => {
      lastTriggerEl?.focus();
      lastTriggerEl = null;
    };
  }, []);

  // This is a true blocking modal (unlike the drawer, which leaves the rest of the page
  // reachable) — the backdrop already blocks pointer interaction with the app behind it,
  // but without this, a screen-reader virtual cursor could still read/reach into the
  // sidebar and the view underneath. `inert` removes it from both focus and the
  // accessibility tree; `aria-hidden` is the fallback for the (now vanishingly rare) AT
  // that doesn't yet honour `inert`. `.app` is the app shell's own root — see App.tsx —
  // and is absent in component tests that render PersonForm in isolation, so this is a
  // no-op there.
  useEffect(() => {
    const appRoot = document.querySelector<HTMLElement>('.app');
    appRoot?.setAttribute('inert', '');
    appRoot?.setAttribute('aria-hidden', 'true');
    return () => {
      appRoot?.removeAttribute('inert');
      appRoot?.removeAttribute('aria-hidden');
    };
  }, []);

  // Escape closes; Tab/Shift+Tab is trapped within the dialog. Unlike the drawer (a
  // non-modal side panel the rest of the page stays reachable around), this is a true
  // blocking modal with a backdrop, so letting Tab escape it would leave keyboard users
  // stranded on controls that are visually covered and unreachable by click.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      // Focus isn't on one of the dialog's own focusable controls — it's on the
      // tabIndex=-1 container (initial focus, deliberately excluded from `focusables`, and
      // note a node `contains` itself so a plain containment check wouldn't catch it), or
      // it dropped to <body> after a focused control was removed (e.g. a condition chip's
      // remove button). Native Tab from there would walk into the page behind the backdrop,
      // so pull it to an edge rather than comparing against first/last (never equal here).
      if (!Array.from(focusables).includes(document.activeElement as HTMLElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // The edit target vanished from under an already-open dialog (shouldn't normally
  // happen — the backdrop blocks every other path to a mutation — but guard rather
  // than crash). Hooks above still ran unconditionally, so Escape/backdrop-close keep
  // working even in this state.
  if (state.mode === 'edit' && !editTarget) return null;

  const anchors = record.people.map((p) => ({
    id: p.id,
    label:
      p.id === record.probandId
        ? `${p.name} (you)`
        : `${p.name} · ${relations.get(p.id)?.rel ?? ''}`,
  }));

  // Mirrors the prototype's own save-time guard: a person can only have two genetic
  // parents. The domain layer (linkRelative) doesn't enforce this — it's this form's
  // job not to offer an add that would silently create a third.
  const anchorParentCount = state.mode === 'add' ? parentsOf(idx, anchor).length : 0;
  const tooManyParents =
    state.mode === 'add' && relation === 'parent' && anchorParentCount >= MAX_PARENTS;

  const trimmedName = name.trim();
  const canSubmit = trimmedName !== '' && !tooManyParents;

  // Stable across keystrokes on purpose: it's the dialog's accessible name (via
  // aria-labelledby), so binding it to the live `name` field would make a screen reader
  // re-announce "Edit Rober… Robert… RobertX" as the user types. The record isn't mutated
  // until Save, so `editTarget.name` stays the person you opened for the whole session.
  const title = state.mode === 'edit' ? `Edit ${editTarget?.name || 'relative'}` : 'Add relative';

  const handleSabChange = (next: Sab): void => {
    // Re-derive the organ inventory default on a genuine change only — re-clicking the
    // already-selected option must never clobber a manually customised inventory.
    if (next !== sab) setOrgans(defaultOrgans(next));
    setSabState(next);
  };

  const toggleOrgan = (organ: Organ): void => {
    setOrgans((cur) => (cur.includes(organ) ? cur.filter((o) => o !== organ) : [...cur, organ]));
  };

  const addCond = (id: string): void => setSelectedCondIds((cur) => [...cur, id]);
  const removeCond = (id: string): void => setSelectedCondIds((cur) => cur.filter((c) => c !== id));

  const results = catalog.search(query, new Set(selectedCondIds), 40);

  const submit = (): void => {
    if (!canSubmit) return;
    const input = {
      name,
      sab,
      gender,
      pronouns: pronouns.trim(),
      organs,
      dead,
      birth: parseYear(birth),
      death: dead ? parseYear(death) : null,
      condIds: selectedCondIds,
    };
    if (state.mode === 'edit') {
      updatePerson(state.id, input);
    } else {
      const id = addRelative(anchor, relation, input);
      // addRelative no-ops (returns '') when the link can't be made — a vanished anchor or
      // the two-parent cap. Keep the form open rather than closing on a silent failure that
      // would discard everything the user just entered.
      if (!id) return;
      selectPerson(id);
    }
    onClose();
  };

  const handleDelete = (): void => {
    if (state.mode !== 'edit') return;
    // Removing a person erases their recorded conditions and history with no undo — gate it
    // like the app's other destructive actions (reset record / load example) already do.
    if (!window.confirm(`Remove ${editTarget?.name ?? 'this person'} from the family record?`)) {
      return;
    }
    deletePerson(state.id);
    onClose();
  };

  const canDelete = state.mode === 'edit' && state.id !== record.probandId;

  // Portalled to <body> (rather than rendered in place, deep under PedigreeView) so this
  // true blocking modal is a DOM sibling of `.app`, not a descendant — the inert/aria-hidden
  // effect above hides `.app` in one shot without also hiding the modal that lives inside it.
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 id={titleId} style={{ fontSize: 17, fontWeight: 600 }}>
            {title}
          </h2>
          <button type="button" className="btn btn--sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {state.mode === 'add' && (
          <>
            {/* Subtle grouping (not a redesign) so the form's ~9 field groups read as a
                few sections rather than one undifferentiated column — mirrors the
                overline-caption idiom PersonDrawer already uses for its own subsections. */}
            <h3 className="overline" style={{ marginBottom: 10 }}>
              Family
            </h3>
            <div
              className="row wrap"
              style={{
                gap: 12,
                marginBottom: 20,
                paddingBottom: 16,
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div style={{ flex: 1, minWidth: 160 }}>
                <label className="lbl" htmlFor={anchorId}>
                  Relative of
                </label>
                <select
                  id={anchorId}
                  className="field"
                  value={anchor}
                  onChange={(e) => setAnchor(e.target.value)}
                >
                  {anchors.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label className="lbl" htmlFor={relationId}>
                  Connect as
                </label>
                <select
                  id={relationId}
                  className="field"
                  value={relation}
                  onChange={(e) => setRelation(e.target.value as Relation)}
                >
                  {RELATION_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                {tooManyParents && (
                  <p className="mono-dim" role="status" style={{ margin: '6px 0 0' }}>
                    This person already has two recorded parents.
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        <h3 className="overline" style={{ marginBottom: 10 }}>
          Identity
        </h3>
        <label className="lbl" htmlFor={nameId}>
          Name <span className="mono-dim">· required</span>
        </label>
        <input
          id={nameId}
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          aria-required="true"
          style={{ marginBottom: 16 }}
        />

        <div className="row wrap" style={{ gap: 14, alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <span className="lbl" id={sabGroupId}>
              Sex assigned at birth
            </span>
            <div className="row" role="group" aria-labelledby={sabGroupId} style={{ gap: 6 }}>
              {SAB_OPTIONS.map((o) => (
                <SegButton
                  key={o.value}
                  label={o.label}
                  pressed={sab === o.value}
                  onClick={() => handleSabChange(o.value)}
                />
              ))}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <span className="lbl" id={statusGroupId}>
              Status
            </span>
            <div className="row" role="group" aria-labelledby={statusGroupId} style={{ gap: 6 }}>
              <SegButton label="Living" pressed={!dead} onClick={() => setDead(false)} />
              <SegButton label="Deceased" pressed={dead} onClick={() => setDead(true)} />
            </div>
          </div>
        </div>

        <div className="row wrap" style={{ gap: 14, alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ flex: 1.3, minWidth: 170 }}>
            <span className="lbl" id={genderGroupId}>
              Gender identity
            </span>
            <div className="row" role="group" aria-labelledby={genderGroupId} style={{ gap: 6 }}>
              {GENDER_OPTIONS.map((o) => (
                <SegButton
                  key={o.value}
                  label={o.label}
                  pressed={gender === o.value}
                  onClick={() => setGender(o.value)}
                />
              ))}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label className="lbl" htmlFor={pronounsId}>
              Pronouns
            </label>
            <input
              id={pronounsId}
              className="field"
              value={pronouns}
              onChange={(e) => setPronouns(e.target.value)}
              placeholder="e.g. they/them"
            />
          </div>
        </div>

        {/* Birth/death year sits with the rest of Identity, not Health — mirrors
            PersonDrawer's own identity-grid, which groups Status and Lifespan (the
            drawer's read-only view of these same two fields) with Gender/Kinship, not
            with the organ inventory. */}
        <div className="row wrap" style={{ gap: 14, marginBottom: 20 }}>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label className="lbl" htmlFor={birthId}>
              Birth year
            </label>
            <input
              id={birthId}
              className="field"
              type="number"
              value={birth}
              onChange={(e) => setBirth(e.target.value)}
            />
          </div>
          {dead && (
            <div style={{ flex: 1, minWidth: 120 }}>
              <label className="lbl" htmlFor={deathId}>
                Death year
              </label>
              <input
                id={deathId}
                className="field"
                type="number"
                value={death}
                onChange={(e) => setDeath(e.target.value)}
              />
            </div>
          )}
        </div>

        <h3 className="overline" style={{ marginBottom: 10 }}>
          Health
        </h3>
        <span className="lbl" id={`${nameId}-organs`}>
          Organ inventory{' '}
          <span style={{ textTransform: 'none', letterSpacing: 0 }}>— drives screening</span>
        </span>
        <div
          className="row wrap"
          role="group"
          aria-labelledby={`${nameId}-organs`}
          style={{ gap: 6, marginBottom: 16 }}
        >
          {ORGANS.map((organ) => (
            <button
              key={organ}
              type="button"
              className="chip"
              aria-pressed={organs.includes(organ)}
              onClick={() => toggleOrgan(organ)}
            >
              {ORGAN_LABELS[organ]}
            </button>
          ))}
        </div>

        <span className="lbl" id={`${nameId}-conds`}>
          Conditions
        </span>
        {selectedCondIds.length > 0 && (
          <ul
            className="row wrap"
            role="list"
            aria-labelledby={`${nameId}-conds`}
            style={{ gap: 6, margin: '0 0 9px', padding: 0, listStyle: 'none' }}
          >
            {selectedCondIds.map((id) => {
              const meta = catalog.get(id);
              const color = categoryColor(meta.cat, palette);
              return (
                <li
                  key={id}
                  className="chip"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'default',
                    borderColor: color,
                    background: `${color}22`,
                    color: 'var(--text)',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{ width: 7, height: 7, borderRadius: 2, background: color }}
                  />
                  {meta.name}
                  <button
                    type="button"
                    className="chip-remove"
                    onClick={() => removeCond(id)}
                    aria-label={`Remove ${meta.name}`}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <label className="visually-hidden" htmlFor={searchId}>
          Search conditions to add
        </label>
        <input
          id={searchId}
          className="field"
          placeholder="Search conditions to add…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        <div
          style={{
            maxHeight: 190,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            marginBottom: 22,
          }}
        >
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              className="btn btn--sm"
              style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={() => addCond(r.id)}
            >
              + {r.name}{' '}
              <span className="mono-dim" style={{ marginLeft: 6 }}>
                {r.categoryLabel}
              </span>
            </button>
          ))}
          {query.trim() !== '' && results.length === 0 && (
            <div
              className="mono-dim"
              role="status"
              style={{ fontStyle: 'italic', padding: '4px 2px' }}
            >
              No matching condition.
            </div>
          )}
        </div>

        {/* Sticky, not just a trailing row: PersonForm's content can run well past the
            modal's own max-height (88vh) once conditions/organs pile up, and a Save button
            that scrolls out of view is a real usability cost. Sticking it to the modal's
            own scrollport — with the modal's background so scrolled content doesn't show
            through — keeps Save/Cancel/Delete reachable without hunting for them. */}
        <div
          className="row"
          style={{
            gap: 9,
            alignItems: 'center',
            position: 'sticky',
            bottom: 0,
            marginTop: 8,
            paddingTop: 14,
            background: 'var(--bg-panel)',
            borderTop: '1px solid var(--border)',
          }}
        >
          {canDelete && (
            <button type="button" className="btn btn--danger" onClick={handleDelete}>
              Delete
            </button>
          )}
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={submit}>
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
