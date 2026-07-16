import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useStore, CURRENT_YEAR, type Relation } from '@/store/useStore';
import { ORGAN_LABELS, ORGANS, genderLabel, organsOf, sabLabel, sabOf } from '@/domain/person';
import { degreeLong, indexPeople, parentsOf } from '@/domain/graph';
import { MAX_PARENTS } from '@/domain/record';
import { useRelations } from '../hooks';
import { ConditionPicker } from './ConditionPicker';
import type { PersonFormState } from './PersonForm';
import type { Person, TwinSet, Union } from '@/domain/types';

/** The element focused just before the drawer opened (the pedigree node that triggered
 * it, for mouse or keyboard activation) — module-level so focus can return there on
 * close without threading a ref through the store. */
let lastTriggerEl: HTMLElement | SVGElement | null = null;

const RELATIVE_GRID: { relation: Relation; icon: string; label: string }[] = [
  { relation: 'parent', icon: '↑', label: 'Parent' },
  { relation: 'partner', icon: '↔', label: 'Partner' },
  { relation: 'sibling', icon: '⇔', label: 'Sibling' },
  { relation: 'child', icon: '↓', label: 'Child' },
];

function IdentityTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="identity-tile">
      <div className="identity-tile__label">{label}</div>
      <div className="identity-tile__value">{value}</div>
    </div>
  );
}

/** Editing drawer for the selected person: identity summary, organ inventory,
 * conditions, quick-add for a connected relative, and edit/delete. */
export function PersonDrawer({
  personId,
  onOpenForm,
}: {
  personId: string;
  onOpenForm: (state: PersonFormState) => void;
}) {
  const person = useStore((s) => s.record.people.find((p) => p.id === personId));
  const people = useStore((s) => s.record.people);
  const unions = useStore((s) => s.record.unions);
  const probandId = useStore((s) => s.record.probandId);
  const selectPerson = useStore((s) => s.selectPerson);
  const toggleOrgan = useStore((s) => s.toggleOrgan);
  const deletePerson = useStore((s) => s.deletePerson);
  const updateUnion = useStore((s) => s.updateUnion);
  const relations = useRelations(probandId);
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  const idx = useMemo(() => indexPeople(people, unions), [people, unions]);
  // Unions this person co-parents with exactly one other parent — the union-level
  // pedigree-structure facts (consanguinity, twin sets) only make sense for a two-parent
  // union, and there's no UI anywhere else to set them. Guarded for `personId` possibly
  // not resolving to a live `person` yet (this runs before the early-return below).
  const personUnions = useMemo(
    () => unions.filter((u) => u.parents.length === 2 && u.parents.includes(personId)),
    [unions, personId],
  );

  // Move focus into the dialog on open, and hand it back to whatever triggered it
  // (typically a pedigree node) on close, so keyboard/screen-reader focus is never
  // silently dropped back to <body>.
  useEffect(() => {
    const active = document.activeElement;
    lastTriggerEl = active instanceof HTMLElement || active instanceof SVGElement ? active : null;
    panelRef.current?.focus();
    return () => {
      lastTriggerEl?.focus();
      lastTriggerEl = null;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Let the topmost layer win: when the add/edit modal is open on top of this drawer
      // (opened from "Edit details" or a quick-add), its own Escape handler closes it —
      // the drawer must not also deselect on the same keypress. Both listen on `document`,
      // so backdrop/z-index can't arbitrate keyboard events; presence of the modal does.
      if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) selectPerson(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectPerson]);

  if (!person) return null;
  const organs = organsOf(person);
  const isProband = person.id === probandId;
  const info = relations.get(person.id);
  const age = person.dead
    ? person.birth != null && person.death != null
      ? person.death - person.birth
      : null
    : person.birth != null
      ? CURRENT_YEAR - person.birth
      : null;
  const years = person.dead
    ? `${person.birth ?? '?'}–${person.death ?? '?'}`
    : person.birth != null
      ? `b.${person.birth}`
      : 'b. unknown';
  // A person can have up to two genetic parents; offer the quick-add until they do
  // (same MAX_PARENTS cap the domain enforces and PersonForm's save-guard mirrors).
  const canAddParent = parentsOf(idx, person.id).length < MAX_PARENTS;

  return (
    <div className="drawer" role="dialog" aria-labelledby={headingId} tabIndex={-1} ref={panelRef}>
      <div className="drawer__body">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 id={headingId} style={{ fontSize: 17, fontWeight: 600 }}>
              {person.name}{' '}
              {isProband && (
                <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>(you)</span>
              )}
            </h2>
            <div className="mono-dim" style={{ marginTop: 3 }}>
              {info?.rel ?? (isProband ? 'You' : 'Relative')}
              {person.pronouns ? ` · ${person.pronouns}` : ''}
            </div>
          </div>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => selectPerson(null)}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="identity-grid" role="group" aria-label={`${person.name}'s details`}>
          <IdentityTile label="Status" value={person.dead ? 'Deceased' : 'Living'} />
          <IdentityTile label="Lifespan" value={age != null ? `${years} · ${age} yrs` : years} />
          <IdentityTile label="Kinship" value={degreeLong(info?.degree ?? null)} />
          <IdentityTile label="Lineage" value={info?.side ?? '—'} />
          <IdentityTile label="Gender" value={genderLabel(person.gender)} />
          <IdentityTile label="Sex at birth" value={sabLabel(sabOf(person))} />
        </div>

        <div>
          <h3 className="overline" style={{ marginBottom: 8 }}>
            Organ inventory · drives screening
          </h3>
          <div className="row wrap" style={{ gap: 6 }}>
            {ORGANS.map((organ) => (
              <button
                key={organ}
                type="button"
                className="chip"
                aria-pressed={organs.includes(organ)}
                onClick={() => toggleOrgan(person.id, organ)}
              >
                {ORGAN_LABELS[organ]}
              </button>
            ))}
          </div>
          {/* Guardrail #4: screening is keyed off the organ inventory, never off gender —
              stated explicitly here so the axis separation is visible at the point of edit. */}
          <p className="mono-dim" style={{ marginTop: 8, lineHeight: 1.4 }}>
            Screening keys off organs present, not gender.
          </p>
        </div>

        <ConditionPicker personId={person.id} />

        {personUnions.length > 0 && (
          <UnionDetails
            unions={personUnions}
            people={people}
            personId={person.id}
            updateUnion={updateUnion}
          />
        )}

        <div>
          <h3 className="overline" style={{ marginBottom: 9 }}>
            Add connected relative
          </h3>
          <div className="relative-grid">
            {RELATIVE_GRID.filter((r) => r.relation !== 'parent' || canAddParent).map((r) => (
              <button
                key={r.relation}
                type="button"
                className="btn btn--sm"
                aria-haspopup="dialog"
                aria-label={`Add ${r.label.toLowerCase()} for ${person.name}`}
                onClick={() => onOpenForm({ mode: 'add', anchor: person.id, relation: r.relation })}
              >
                <span aria-hidden="true">{r.icon}</span> {r.label}
              </button>
            ))}
          </div>
        </div>

        <div
          className="row"
          style={{ gap: 8, paddingTop: 16, borderTop: '1px solid var(--border)' }}
        >
          <button
            type="button"
            className="btn"
            style={{ flex: 1 }}
            // Contains the visible "Edit details" text (WCAG 2.5.3 Label in Name), so voice
            // control can match it, while still naming the person for screen readers.
            aria-label={`Edit details for ${person.name}`}
            aria-haspopup="dialog"
            onClick={() => onOpenForm({ mode: 'edit', id: person.id })}
          >
            Edit details
          </button>
          {!isProband && (
            <button
              type="button"
              className="btn btn--danger"
              aria-label={`Delete ${person.name}`}
              onClick={() => {
                // No undo — confirm like the app's other destructive actions.
                if (window.confirm(`Remove ${person.name} from the family record?`)) {
                  deletePerson(person.id);
                }
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The store's `updateUnion` action signature, named here so `UnionDetails`/`UnionCard`
 * don't have to import `useStore` just to spell out the prop type. */
type UpdateUnion = (
  parents: string[],
  patch: Partial<Pick<Union, 'consanguineous' | 'twins'>>,
) => void;

/**
 * Union-level pedigree-structure facts (consanguinity, twin/multiple-birth grouping) for
 * every two-parent union the drawer's person co-parents. There's no other UI surface for
 * these — unlike the per-person facts (organs, conditions) the sections above cover — so
 * this only appears when at least one qualifying union exists (see `personUnions` above).
 * One {@link UnionCard} per union: a person with more than one union (e.g. remarriage,
 * or a second union recorded after a prior partner) gets one card each.
 */
function UnionDetails({
  unions,
  people,
  personId,
  updateUnion,
}: {
  unions: Union[];
  people: Person[];
  personId: string;
  updateUnion: UpdateUnion;
}) {
  return (
    <div>
      <h3 className="overline" style={{ marginBottom: 8 }}>
        Union details
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {unions.map((u) => (
          <UnionCard
            // Sorted parents *and* children, not parents alone: `updateUnion` itself
            // matches a union by its parents set only (see the doc comment on `UnionCard`
            // below), so two distinct unions that happen to share the same two parents
            // but different children — e.g. malformed/duplicate-FAM GEDCOM import data;
            // the app's own record-mutating actions never produce this — would otherwise
            // collide onto one React key here too, on top of `updateUnion` itself patching
            // whichever of the two it finds first. Folding in `children` fixes the *key*
            // collision (so each such union still gets its own `UnionCard` instance and
            // local twin-selection state); the `updateUnion` match itself stays a known,
            // documented limitation pending a stable `Union.id` (a domain/store change,
            // out of scope here).
            key={`${u.parents.slice().sort().join(',')}|${u.children.slice().sort().join(',')}`}
            union={u}
            people={people}
            personId={personId}
            updateUnion={updateUnion}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One union's consanguinity checkbox and twin-set editor, styled like the drawer's other
 * card-based sections (organ inventory / conditions): `.card` wrapper, `.chip` pills,
 * `.lbl`/`.row`/`.btn` for structure and controls.
 *
 * Twin-set membership is local, uncommitted selection state — nothing is written to the
 * record until "Mark as twins" is pressed, and it lives here (not lifted to the drawer)
 * so it resets per-union automatically: `UnionDetails` keys each card by the union's own
 * parent set, so switching between a multi-union person's cards can never leak a
 * half-made selection from one union into another.
 */
function UnionCard({
  union,
  people,
  personId,
  updateUnion,
}: {
  union: Union;
  people: Person[];
  personId: string;
  updateUnion: UpdateUnion;
}) {
  const baseId = useId();
  const coParentId = union.parents.find((id) => id !== personId);
  const coParent = people.find((p) => p.id === coParentId);
  const children = union.children
    .map((id) => people.find((p) => p.id === id))
    .filter((p): p is Person => p != null);
  const twins = union.twins ?? [];
  // A child already recorded in a twin set can't join a second one — the domain validator
  // enforces "member of at most one TwinSet"; disabling it here just keeps the UI from
  // ever offering the invalid choice in the first place.
  const alreadyTwinned = new Set(twins.flatMap((t) => t.members));

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zygosity, setZygosity] = useState<TwinSet['zygosity']>('di');

  // Every `updateUnion(union.parents, …)` call below (the consanguineous checkbox, and
  // `markTwins`/`removeTwinSet` further down) identifies its target union purely by an
  // order-independent match on `parents` — there's no `Union.id` yet. That's exact for
  // every union this app's own actions can produce (a person has at most one union per
  // co-parent). It's only ambiguous for two distinct unions sharing the same parents pair
  // but different children, which only malformed/duplicate-FAM GEDCOM import data could
  // produce today; `updateUnion` would then patch whichever union it finds first. A
  // stable `Union.id` (domain/store change) is the real fix and is out of scope here —
  // this comment, plus the key fix on `UnionDetails` above, address the two symptoms a
  // UI-only pass can reach.
  const toggleChild = (id: string): void => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const markTwins = (): void => {
    if (selected.size < 2) return; // guarded again below (disabled button); belt and braces
    updateUnion(union.parents, { twins: [...twins, { members: [...selected], zygosity }] });
    setSelected(new Set());
  };

  const removeTwinSet = (i: number): void => {
    updateUnion(union.parents, { twins: twins.filter((_, idx) => idx !== i) });
  };

  const nameOf = (id: string): string => people.find((p) => p.id === id)?.name ?? 'Unknown';

  return (
    <div
      className="card"
      style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div style={{ fontSize: 13, fontWeight: 600 }}>
        With {coParent?.name ?? 'unknown partner'}
      </div>

      <label className="row" style={{ gap: 8, fontSize: 12.5 }}>
        <input
          type="checkbox"
          checked={union.consanguineous === true}
          onChange={(e) => updateUnion(union.parents, { consanguineous: e.target.checked })}
        />
        Consanguineous union (blood-related partners)
      </label>

      {/* A twin set needs ≥2 children to group, so the whole editor is pointless (and
          would just show a single disabled checkbox) below that. */}
      {children.length >= 2 && (
        <div>
          <span className="lbl" id={`${baseId}-twin-label`}>
            Twin / multiple-birth grouping
          </span>

          {twins.length > 0 && (
            <ul
              className="plain-list"
              style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}
            >
              {twins.map((ts, i) => {
                const label = `${ts.members.map(nameOf).join(' & ')} · ${
                  ts.zygosity === 'mono' ? 'identical' : 'fraternal'
                }`;
                return (
                  <li key={i} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <span className="chip" style={{ cursor: 'default' }}>
                      {label}
                    </span>
                    <button
                      type="button"
                      className="chip-remove"
                      aria-label={`Remove twin set: ${label}`}
                      onClick={() => removeTwinSet(i)}
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div
            role="group"
            aria-labelledby={`${baseId}-twin-label`}
            className="row wrap"
            style={{ gap: 6, marginBottom: 8 }}
          >
            {children.map((child) => {
              const disabled = alreadyTwinned.has(child.id);
              const checked = selected.has(child.id);
              return (
                <label
                  key={child.id}
                  className="chip"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    opacity: disabled ? 0.5 : 1,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    borderColor: checked ? 'var(--accent)' : undefined,
                    color: checked ? 'var(--accent)' : undefined,
                  }}
                >
                  <input
                    type="checkbox"
                    style={{ margin: 0 }}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleChild(child.id)}
                  />
                  {child.name}
                </label>
              );
            })}
          </div>

          <div className="row wrap" style={{ gap: 12 }}>
            <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', gap: 10 }}>
              <legend className="visually-hidden">Zygosity</legend>
              <label className="row" style={{ gap: 4, fontSize: 12 }}>
                <input
                  type="radio"
                  name={`${baseId}-zygosity`}
                  checked={zygosity === 'di'}
                  onChange={() => setZygosity('di')}
                />
                Fraternal (dizygotic)
              </label>
              <label className="row" style={{ gap: 4, fontSize: 12 }}>
                <input
                  type="radio"
                  name={`${baseId}-zygosity`}
                  checked={zygosity === 'mono'}
                  onChange={() => setZygosity('mono')}
                />
                Identical (monozygotic)
              </label>
            </fieldset>
            <button
              type="button"
              className="btn btn--sm"
              disabled={selected.size < 2}
              onClick={markTwins}
            >
              Mark as twins
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
