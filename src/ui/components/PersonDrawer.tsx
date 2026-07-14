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

/** Editing drawer for the selected person. */
export function PersonDrawer({ personId }: { personId: string }) {
  const person = useStore((s) => s.record.people.find((p) => p.id === personId));
  const probandId = useStore((s) => s.record.probandId);
  const selectPerson = useStore((s) => s.selectPerson);
  const toggleOrgan = useStore((s) => s.toggleOrgan);
  const deletePerson = useStore((s) => s.deletePerson);

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
    <div className="drawer">
      <div className="drawer__body">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600 }}>
              {person.name}{' '}
              {isProband && (
                <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>(you)</span>
              )}
            </div>
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
          <div className="overline" style={{ marginBottom: 8 }}>
            Organ inventory · drives screening
          </div>
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
            className="btn btn--sm"
            style={{ color: 'var(--sev-referral)', borderColor: 'rgba(255,93,93,0.4)' }}
            onClick={() => deletePerson(person.id)}
          >
            Remove {person.name} from the record
          </button>
        )}
      </div>
    </div>
  );
}
