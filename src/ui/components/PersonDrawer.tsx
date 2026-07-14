import { useEffect, useId, useRef } from 'react';
import { useStore, CURRENT_YEAR } from '@/store/useStore';
import {
  ORGAN_LABELS,
  ORGANS,
  genderLabel,
  genderSymbol,
  organsOf,
  sabLabel,
  sabOf,
} from '@/domain/person';
import { ConditionPicker } from './ConditionPicker';

/** The element focused just before the drawer opened (the pedigree node that triggered
 * it, for mouse or keyboard activation) — module-level so focus can return there on
 * close without threading a ref through the store. */
let lastTriggerEl: HTMLElement | SVGElement | null = null;

/** Editing drawer for the selected person. */
export function PersonDrawer({ personId }: { personId: string }) {
  const person = useStore((s) => s.record.people.find((p) => p.id === personId));
  const probandId = useStore((s) => s.record.probandId);
  const selectPerson = useStore((s) => s.selectPerson);
  const toggleOrgan = useStore((s) => s.toggleOrgan);
  const deletePerson = useStore((s) => s.deletePerson);
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

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
      if (e.key === 'Escape') selectPerson(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectPerson]);

  if (!person) return null;
  const organs = organsOf(person);
  const isProband = person.id === probandId;
  const age = person.dead
    ? person.birth != null && person.death != null
      ? person.death - person.birth
      : null
    : person.birth != null
      ? CURRENT_YEAR - person.birth
      : null;

  return (
    <div
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      tabIndex={-1}
      ref={panelRef}
    >
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
              {genderSymbol(person.gender)} {genderLabel(person.gender)} · {sabLabel(sabOf(person))}
              {person.pronouns ? ` · ${person.pronouns}` : ''}
            </div>
            <div className="mono-dim">
              {person.dead
                ? `${person.birth ?? '?'}–${person.death ?? '?'}`
                : `b.${person.birth ?? '?'}`}
              {age != null ? ` · ${age} yrs` : ''}
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

        {!isProband && (
          <button
            type="button"
            className="btn btn--sm btn--danger"
            onClick={() => deletePerson(person.id)}
          >
            Remove {person.name} from the record
          </button>
        )}
      </div>
    </div>
  );
}
