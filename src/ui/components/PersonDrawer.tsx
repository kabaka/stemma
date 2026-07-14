import { useEffect, useId, useMemo, useRef } from 'react';
import { useStore, CURRENT_YEAR, type Relation } from '@/store/useStore';
import { ORGAN_LABELS, ORGANS, genderLabel, organsOf, sabLabel, sabOf } from '@/domain/person';
import { degreeLong, indexPeople, parentsOf } from '@/domain/graph';
import { MAX_PARENTS } from '@/domain/record';
import { useRelations } from '../hooks';
import { ConditionPicker } from './ConditionPicker';
import type { PersonFormState } from './PersonForm';

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
  const relations = useRelations(probandId);
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  const idx = useMemo(() => indexPeople(people, unions), [people, unions]);

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
        </div>

        <ConditionPicker personId={person.id} />

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
