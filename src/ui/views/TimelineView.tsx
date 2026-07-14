import { useId, useMemo, useState } from 'react';
import { useStore } from '@/store/useStore';
import { useRelations } from '../hooks';
import { EVENT_META, EVENT_TYPES } from '@/data/events';
import type { EventType } from '@/domain/types';

/** One person's medical timeline — every relative keeps their own. */
export function TimelineView() {
  const record = useStore((s) => s.record);
  const tlPerson = useStore((s) => s.tlPerson);
  const setTlPerson = useStore((s) => s.setTlPerson);
  const tlType = useStore((s) => s.tlType);
  const setTlType = useStore((s) => s.setTlType);
  const addEvent = useStore((s) => s.addEvent);
  const deleteEvent = useStore((s) => s.deleteEvent);
  const relations = useRelations(record.probandId);

  const [adding, setAdding] = useState(false);
  const personSelectId = useId();

  // Fall back gracefully rather than assert: a replaced/imported record whose probandId
  // matches nobody must not crash the view.
  const person =
    record.people.find((p) => p.id === tlPerson) ??
    record.people.find((p) => p.isProband) ??
    record.people[0];
  const events = useMemo(
    () => record.timeline.filter((e) => e.person === tlPerson).sort((a, b) => b.year - a.year),
    [record.timeline, tlPerson],
  );
  const shown = tlType === 'all' ? events : events.filter((e) => e.type === tlType);
  const presentTypes = EVENT_TYPES.filter((t) => events.some((e) => e.type === t));

  if (!person) return <div className="scroll">No record loaded.</div>;

  const isProband = person.id === record.probandId;

  return (
    <div className="scroll">
      <div className="page-head">
        <h1 className="page-title">
          {isProband ? 'My Health Timeline' : `${person.name}’s Timeline`}
        </h1>
        <div className="row" style={{ gap: 8 }}>
          <label className="visually-hidden" htmlFor={personSelectId}>
            Select person
          </label>
          <select
            id={personSelectId}
            className="field"
            style={{ width: 'auto' }}
            value={tlPerson}
            onChange={(e) => setTlPerson(e.target.value)}
          >
            {record.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.id === record.probandId ? ' (you)' : ` · ${relations.get(p.id)?.rel ?? ''}`}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            aria-expanded={adding}
            onClick={() => setAdding((v) => !v)}
          >
            {adding ? '✕ close' : '+ log event'}
          </button>
        </div>
      </div>
      <p className="lede">
        {isProband
          ? 'Personal record — diagnoses, medications, procedures, labs, screenings and immunizations.'
          : `Health record for ${person.name} · ${relations.get(person.id)?.rel ?? ''}. Every relative keeps their own timeline.`}
      </p>

      {adding && (
        <EventForm personId={person.id} onDone={() => setAdding(false)} onSave={addEvent} />
      )}

      <div className="row wrap" style={{ gap: 7, margin: '4px 0 18px' }}>
        <button
          type="button"
          className="chip"
          aria-pressed={tlType === 'all'}
          onClick={() => setTlType('all')}
        >
          all
        </button>
        {presentTypes.map((t) => (
          <button
            key={t}
            type="button"
            className="chip"
            aria-pressed={tlType === t}
            onClick={() => setTlType(t)}
          >
            {EVENT_META[t].label}
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <div className="card" style={{ color: 'var(--text-dim)' }}>
          No events recorded.
        </div>
      )}
      <ul className="timeline-list">
        {shown.map((e) => (
          <li className="timeline-item" key={e.id}>
            <span className="mono-dim" style={{ paddingTop: 2 }}>
              {e.year}
            </span>
            <div>
              <div className="row" style={{ gap: 8 }}>
                <span
                  className="badge"
                  style={{
                    background: `${EVENT_META[e.type].color}22`,
                    color: EVENT_META[e.type].color,
                  }}
                >
                  {EVENT_META[e.type].label}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{e.title}</span>
              </div>
              {e.detail && (
                <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 4 }}>
                  {e.detail}
                </div>
              )}
            </div>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => deleteEvent(e.id)}
              aria-label={`Delete ${e.title}`}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface EventFormProps {
  personId: string;
  onSave: (e: {
    person: string;
    year: number;
    type: EventType;
    title: string;
    detail: string;
  }) => void;
  onDone: () => void;
}

function EventForm({ personId, onSave, onDone }: EventFormProps) {
  // String-backed so the field can be blanked while editing without snapping to 0.
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [type, setType] = useState<EventType>('diagnosis');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');

  const yearId = useId();
  const typeId = useId();
  const titleId = useId();
  const detailId = useId();

  const submit = () => {
    if (!title.trim()) return;
    const parsedYear = Number.parseInt(year, 10);
    onSave({
      person: personId,
      year: Number.isNaN(parsedYear) ? new Date().getFullYear() : parsedYear,
      type,
      title: title.trim(),
      detail: detail.trim(),
    });
    onDone();
  };

  return (
    <div className="card" style={{ marginBottom: 18, display: 'grid', gap: 12 }}>
      <div className="row" style={{ gap: 12 }}>
        <div style={{ width: 110 }}>
          <label className="lbl" htmlFor={yearId}>
            Year
          </label>
          <input
            id={yearId}
            className="field"
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="lbl" htmlFor={typeId}>
            Type
          </label>
          <select
            id={typeId}
            className="field"
            value={type}
            onChange={(e) => setType(e.target.value as EventType)}
          >
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EVENT_META[t].label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="lbl" htmlFor={titleId}>
          Title
        </label>
        <input
          id={titleId}
          className="field"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Screening colonoscopy"
        />
      </div>
      <div>
        <label className="lbl" htmlFor={detailId}>
          Detail (optional)
        </label>
        <input
          id={detailId}
          className="field"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
        />
      </div>
      <div className="row">
        <button type="button" className="btn btn--primary btn--sm" onClick={submit}>
          Save event
        </button>
        <button type="button" className="btn btn--sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
