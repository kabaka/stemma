import { useId, useMemo, useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { useDisclosureFocus, useRelations } from '../hooks';
import { EVENT_META, EVENT_TYPES } from '@/data/events';
import { SCREENING_DEFS } from '@/domain/screening';
import { labTitles } from '@/domain/timeline';
import { CurrentMedications } from '../components/CurrentMedications';
import { LabTrend } from '../components/LabTrend';
import type {
  AllergyInfo,
  AttachmentRef,
  EventType,
  ImmunizationInfo,
  Measurement,
  MedicationInfo,
  TimelineEvent,
} from '@/domain/types';

// crypto.randomUUID with the same graceful fallback as the store's own `newId` (not
// exported from the store, so this is a local twin) — attachment rows need a stable id
// the moment they're added, before the event itself is ever saved. Non-cryptographic:
// a React list key / local identity only, never suitable as a security token (the
// Math.random fallback in particular is not a secure RNG).
const newLocalId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `local-${Math.floor(Math.random() * 1e9).toString(36)}`;

/** The editable fields of a timeline event (everything but its id). */
type EventDraft = Omit<TimelineEvent, 'id'>;

/** One person's medical timeline — every relative keeps their own. */
export function TimelineView() {
  const record = useStore((s) => s.record);
  const tlPerson = useStore((s) => s.tlPerson);
  const setTlPerson = useStore((s) => s.setTlPerson);
  const tlType = useStore((s) => s.tlType);
  const setTlType = useStore((s) => s.setTlType);
  const addEvent = useStore((s) => s.addEvent);
  const updateEvent = useStore((s) => s.updateEvent);
  const deleteEvent = useStore((s) => s.deleteEvent);
  const relations = useRelations(record.probandId);

  const [adding, setAdding] = useState(false);
  // The event currently being edited (its form replaces the row inline), or null.
  const [editingId, setEditingId] = useState<string | null>(null);
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
  // Keyed off the same resolved `person?.id` passed to <CurrentMedications>/<LabTrend>
  // below (falling back to `tlPerson` only because this runs before the `!person` guard
  // and hooks can't follow an early return) — so this gate can never disagree with what
  // those components actually render against.
  const hasLabs = useMemo(
    () => labTitles(record, person?.id ?? tlPerson).length > 0,
    [record, person?.id, tlPerson],
  );

  if (!person) return <div className="scroll">No record loaded.</div>;

  const isProband = person.id === record.probandId;

  // The person picker (shared by add + edit forms): "you" and each relative's relationship.
  const peopleOptions = record.people.map((p) => ({
    id: p.id,
    label: `${p.name}${p.id === record.probandId ? ' (you)' : ` · ${relations.get(p.id)?.rel ?? ''}`}`,
  }));

  const startAdding = () => {
    setEditingId(null);
    setAdding((v) => !v);
  };
  const startEditing = (id: string) => {
    setAdding(false);
    setEditingId(id);
  };

  return (
    <div className="scroll">
      <div className="page-head">
        <h1 className="page-title" tabIndex={-1}>
          {isProband ? 'My Health Timeline' : `${person.name}’s Timeline`}
        </h1>
        <div className="row" style={{ gap: 8 }}>
          {/* Visible label, matching PatternsView's vantage selector treatment (both
              re-root a per-person view; a visually-hidden label here was the odd one out). */}
          <label className="row" style={{ gap: 8 }}>
            <span className="mono-dim">Viewing</span>
            <select
              id={personSelectId}
              className="field"
              style={{ width: 'auto' }}
              value={tlPerson}
              onChange={(e) => setTlPerson(e.target.value)}
              title="Shows this person's own timeline. Overview always shows yours."
            >
              {record.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.id === record.probandId ? ' (you)' : ` · ${relations.get(p.id)?.rel ?? ''}`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            aria-expanded={adding}
            onClick={startAdding}
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

      {/* Two read-model summaries derived from the raw event log below — current
          medications and (when there's at least one) a lab trend. Placed ahead of the
          editable log itself so "what's the state right now" reads before "everything
          that was ever logged". */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 22,
          marginBottom: 22,
        }}
      >
        <CurrentMedications personId={person.id} />
        {hasLabs && <LabTrend personId={person.id} />}
      </div>

      {adding && (
        <EventForm
          people={peopleOptions}
          defaultPersonId={person.id}
          submitLabel="Save event"
          onDone={() => setAdding(false)}
          onSubmit={(draft) => {
            addEvent(draft);
            setAdding(false);
          }}
        />
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
        {shown.map((e) =>
          editingId === e.id ? (
            <li key={e.id}>
              <EventForm
                people={peopleOptions}
                initial={e}
                submitLabel="Save changes"
                onDone={() => setEditingId(null)}
                onSubmit={(draft) => {
                  updateEvent(e.id, draft);
                  setEditingId(null);
                }}
              />
            </li>
          ) : (
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
              <div className="row" style={{ gap: 4 }}>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => startEditing(e.id)}
                  aria-expanded={editingId === e.id}
                  aria-label={`Edit ${e.title}`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => deleteEvent(e.id)}
                  aria-label={`Delete ${e.title}`}
                >
                  ✕
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

interface PersonOption {
  id: string;
  label: string;
}

interface EventFormProps {
  people: PersonOption[];
  /** Pre-filled values when editing an existing event. */
  initial?: TimelineEvent;
  /** Person to attach a *new* event to (ignored when `initial` is set). */
  defaultPersonId?: string;
  submitLabel: string;
  onSubmit: (draft: EventDraft) => void;
  onDone: () => void;
}

function EventForm({
  people,
  initial,
  defaultPersonId,
  submitLabel,
  onSubmit,
  onDone,
}: EventFormProps) {
  // String-backed year so the field can be blanked while editing without snapping to 0.
  const [personId, setPersonId] = useState(
    initial?.person ?? defaultPersonId ?? people[0]?.id ?? '',
  );
  const [year, setYear] = useState(String(initial?.year ?? new Date().getFullYear()));
  const [type, setType] = useState<EventType>(initial?.type ?? 'diagnosis');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [detail, setDetail] = useState(initial?.detail ?? '');
  // Which ScreeningDef this event completes — only meaningful when type === 'screening',
  // but kept around across a type change so re-selecting "screening" restores the pick.
  const [screeningId, setScreeningId] = useState(initial?.screeningId ?? '');

  // Every type-specific sub-object below is kept around across a type change (same
  // rationale as `screeningId` above) so switching to "medication" and back restores
  // what was there, but only the sub-object matching the *current* `type` is ever
  // written on submit — see `submit()`. All number fields are string-backed so an
  // emptied field doesn't silently coerce to 0 (`Number('') === 0`).
  const [dose, setDose] = useState(initial?.med?.dose ?? '');
  const [ongoing, setOngoing] = useState(initial?.med?.ongoing ?? true);
  const [medStopYear, setMedStopYear] = useState(
    initial?.med?.stopYear != null ? String(initial.med.stopYear) : '',
  );
  // `ongoing` is a required (non-optional) MedicationInfo field, so — unlike lab/vital/
  // allergy/immunization, which are naturally gated by an entered value/substance — there
  // is no "nothing was entered" shape to fall back on: `med` would otherwise always build
  // once `type === 'medication'`, fabricating `{ ongoing: true }` onto a legacy medication
  // event (no prior `med`) whose title the user merely edited. Track real interaction with
  // the medication sub-fields explicitly and require it before ever emitting `med` for an
  // event that didn't already carry one.
  const [medTouched, setMedTouched] = useState(false);

  const [labValue, setLabValue] = useState(
    initial?.lab?.value != null ? String(initial.lab.value) : '',
  );
  const [labUnit, setLabUnit] = useState(initial?.lab?.unit ?? '');
  const [labRefLow, setLabRefLow] = useState(
    initial?.lab?.refLow != null ? String(initial.lab.refLow) : '',
  );
  const [labRefHigh, setLabRefHigh] = useState(
    initial?.lab?.refHigh != null ? String(initial.lab.refHigh) : '',
  );

  const [vitalValue, setVitalValue] = useState(
    initial?.vital?.value != null ? String(initial.vital.value) : '',
  );
  const [vitalUnit, setVitalUnit] = useState(initial?.vital?.unit ?? '');
  const [vitalRefLow, setVitalRefLow] = useState(
    initial?.vital?.refLow != null ? String(initial.vital.refLow) : '',
  );
  const [vitalRefHigh, setVitalRefHigh] = useState(
    initial?.vital?.refHigh != null ? String(initial.vital.refHigh) : '',
  );

  const [allergySubstance, setAllergySubstance] = useState(initial?.allergy?.substance ?? '');
  const [allergyReaction, setAllergyReaction] = useState(initial?.allergy?.reaction ?? '');
  const [allergySeverity, setAllergySeverity] = useState<'' | NonNullable<AllergyInfo['severity']>>(
    initial?.allergy?.severity ?? '',
  );

  const [immVaccine, setImmVaccine] = useState(initial?.immunization?.vaccine ?? '');
  const [immDoseLabel, setImmDoseLabel] = useState(initial?.immunization?.doseLabel ?? '');

  // Document *references* (name + note), never bytes — see AttachmentRef. Apply to any
  // event type, so they're not cleared on a type switch the way the other sub-objects are.
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; note: string }>>(
    () => initial?.attachments?.map((a) => ({ id: a.id, name: a.name, note: a.note ?? '' })) ?? [],
  );
  // Where a removed row's focus lands — the "+ add reference" button is the one control
  // in this section guaranteed to still exist after any row disappears (WCAG 2.4.3).
  const addReferenceBtnRef = useRef<HTMLButtonElement>(null);
  const addAttachment = () =>
    setAttachments((prev) => [...prev, { id: newLocalId(), name: '', note: '' }]);
  const updateAttachment = (id: string, patch: Partial<{ name: string; note: string }>) =>
    setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    // The removed row's own controls (including the focused "Remove" button) are gone by
    // next paint, which would otherwise drop focus to <body>. rAF defers to after React
    // commits the unmount so the button is focusable when this runs.
    requestAnimationFrame(() => addReferenceBtnRef.current?.focus());
  };

  const personId_ = useId();
  const yearId = useId();
  const typeId = useId();
  const titleId = useId();
  const detailId = useId();
  const screeningIdId = useId();
  const doseId = useId();
  const ongoingId = useId();
  const medStopYearId = useId();
  const labValueId = useId();
  const labUnitId = useId();
  const labRefLowId = useId();
  const labRefHighId = useId();
  const vitalValueId = useId();
  const vitalUnitId = useId();
  const vitalRefLowId = useId();
  const vitalRefHighId = useId();
  const allergySubstanceId = useId();
  const allergyReactionId = useId();
  const allergySeverityId = useId();
  const immVaccineId = useId();
  const immDoseLabelId = useId();
  const attachmentsLabelId = useId();
  const attachmentsBaseId = useId();
  // Move focus into the form on open (first field), back to the trigger on close.
  const firstFieldRef = useDisclosureFocus<HTMLSelectElement>();

  const submit = () => {
    if (!title.trim()) return;
    const parsedYear = Number.parseInt(year, 10);

    const parsedMedStopYear = Number.parseInt(medStopYear, 10);
    const med: MedicationInfo | undefined =
      // Emit `med` for: a brand-new event (`initial === undefined` — the pre-checked
      // "Ongoing" default IS the fact being recorded, nothing to guard against), an event
      // that already had a structured payload (`initial?.med !== undefined` — preserve/
      // update it), or one where the user actually touched a medication field this
      // session (`medTouched`). The case that must stay excluded: editing a *legacy*
      // medication event (no prior `med`) without touching its medication fields, which
      // would otherwise fabricate `{ ongoing: true }` the user never entered — and
      // wrongly surface it under "Currently taking".
      type === 'medication' && (initial === undefined || initial?.med !== undefined || medTouched)
        ? {
            dose: dose.trim() || undefined,
            ongoing,
            stopYear:
              !ongoing && medStopYear.trim() && !Number.isNaN(parsedMedStopYear)
                ? parsedMedStopYear
                : undefined,
          }
        : undefined;

    const parsedLabValue = Number.parseFloat(labValue);
    const lab: Measurement | undefined =
      type === 'lab' && labValue.trim() && !Number.isNaN(parsedLabValue)
        ? {
            value: parsedLabValue,
            unit: labUnit.trim(),
            refLow: labRefLow.trim() ? Number.parseFloat(labRefLow) : undefined,
            refHigh: labRefHigh.trim() ? Number.parseFloat(labRefHigh) : undefined,
          }
        : undefined;

    const parsedVitalValue = Number.parseFloat(vitalValue);
    const vital: Measurement | undefined =
      type === 'vital' && vitalValue.trim() && !Number.isNaN(parsedVitalValue)
        ? {
            value: parsedVitalValue,
            unit: vitalUnit.trim(),
            refLow: vitalRefLow.trim() ? Number.parseFloat(vitalRefLow) : undefined,
            refHigh: vitalRefHigh.trim() ? Number.parseFloat(vitalRefHigh) : undefined,
          }
        : undefined;

    const allergy: AllergyInfo | undefined =
      type === 'allergy' && allergySubstance.trim()
        ? {
            substance: allergySubstance.trim(),
            reaction: allergyReaction.trim() || undefined,
            severity: allergySeverity || undefined,
          }
        : undefined;

    const immunization: ImmunizationInfo | undefined =
      type === 'immunization' && (immVaccine.trim() || immDoseLabel.trim())
        ? {
            vaccine: immVaccine.trim() || undefined,
            doseLabel: immDoseLabel.trim() || undefined,
          }
        : undefined;

    const cleanedAttachments: AttachmentRef[] = attachments
      .filter((a) => a.name.trim())
      .map((a) => ({ id: a.id, name: a.name.trim(), note: a.note.trim() || undefined }));

    onSubmit({
      person: personId,
      year: Number.isNaN(parsedYear) ? new Date().getFullYear() : parsedYear,
      type,
      title: title.trim(),
      detail: detail.trim(),
      // Every one of these is set explicitly (not a conditional spread) so it can be
      // *cleared*: updateEvent partial-merges, so an omitted key leaves a stale value
      // when the user picks "— none —" or switches the type away. `undefined`
      // overwrites via the spread (see the store's `updateEvent`).
      screeningId: type === 'screening' && screeningId ? screeningId : undefined,
      med,
      lab,
      vital,
      allergy,
      immunization,
      attachments: cleanedAttachments.length > 0 ? cleanedAttachments : undefined,
    });
  };

  return (
    <div className="card" style={{ marginBottom: 18, display: 'grid', gap: 12 }}>
      <div>
        <label className="lbl" htmlFor={personId_}>
          Person
        </label>
        <select
          ref={firstFieldRef}
          id={personId_}
          className="field"
          value={personId}
          onChange={(e) => setPersonId(e.target.value)}
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="row wrap" style={{ gap: 12 }}>
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
      {type === 'screening' && (
        <div>
          <label className="lbl" htmlFor={screeningIdId}>
            Which screening (optional)
          </label>
          <select
            id={screeningIdId}
            className="field"
            value={screeningId}
            onChange={(e) => setScreeningId(e.target.value)}
          >
            <option value="">— none —</option>
            {SCREENING_DEFS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {type === 'medication' && (
        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 140px' }}>
            <label className="lbl" htmlFor={doseId}>
              Dose (optional)
            </label>
            <input
              id={doseId}
              className="field"
              value={dose}
              onChange={(e) => {
                setDose(e.target.value);
                setMedTouched(true);
              }}
              placeholder="e.g. 10mg daily"
            />
          </div>
          <label className="row" style={{ gap: 6, paddingBottom: 8 }} htmlFor={ongoingId}>
            <input
              id={ongoingId}
              type="checkbox"
              checked={ongoing}
              onChange={(e) => {
                setOngoing(e.target.checked);
                setMedTouched(true);
              }}
            />
            Ongoing (currently taking)
          </label>
          {!ongoing && (
            <div style={{ width: 110 }}>
              <label className="lbl" htmlFor={medStopYearId}>
                Stop year
              </label>
              <input
                id={medStopYearId}
                className="field"
                type="number"
                value={medStopYear}
                onChange={(e) => {
                  setMedStopYear(e.target.value);
                  setMedTouched(true);
                }}
              />
            </div>
          )}
        </div>
      )}
      {type === 'lab' && (
        <div className="row wrap" style={{ gap: 12 }}>
          <div style={{ width: 110 }}>
            <label className="lbl" htmlFor={labValueId}>
              Value
            </label>
            <input
              id={labValueId}
              className="field"
              type="number"
              value={labValue}
              onChange={(e) => setLabValue(e.target.value)}
            />
          </div>
          <div style={{ width: 110 }}>
            <label className="lbl" htmlFor={labUnitId}>
              Unit
            </label>
            <input
              id={labUnitId}
              className="field"
              value={labUnit}
              onChange={(e) => setLabUnit(e.target.value)}
              placeholder="e.g. mg/dL"
            />
          </div>
          {/* A real <fieldset>/<legend> group name (WCAG 1.3.1) — a bare <span class="lbl">
              caption above the Low/High pair leaves those two inputs with no programmatic
              relationship, so AT announces just "Low" / "High" with no shared context. */}
          <fieldset style={{ border: 'none', margin: 0, padding: 0, width: '100%' }}>
            <legend className="lbl">Reference range (from your lab report)</legend>
            <div className="row" style={{ gap: 12 }}>
              <div style={{ width: 110 }}>
                <label className="lbl" htmlFor={labRefLowId}>
                  Low
                </label>
                <input
                  id={labRefLowId}
                  className="field"
                  type="number"
                  value={labRefLow}
                  onChange={(e) => setLabRefLow(e.target.value)}
                />
              </div>
              <div style={{ width: 110 }}>
                <label className="lbl" htmlFor={labRefHighId}>
                  High
                </label>
                <input
                  id={labRefHighId}
                  className="field"
                  type="number"
                  value={labRefHigh}
                  onChange={(e) => setLabRefHigh(e.target.value)}
                />
              </div>
            </div>
          </fieldset>
        </div>
      )}
      {type === 'vital' && (
        <div className="row wrap" style={{ gap: 12 }}>
          <div style={{ width: 110 }}>
            <label className="lbl" htmlFor={vitalValueId}>
              Value
            </label>
            <input
              id={vitalValueId}
              className="field"
              type="number"
              value={vitalValue}
              onChange={(e) => setVitalValue(e.target.value)}
            />
          </div>
          <div style={{ width: 110 }}>
            <label className="lbl" htmlFor={vitalUnitId}>
              Unit
            </label>
            <input
              id={vitalUnitId}
              className="field"
              value={vitalUnit}
              onChange={(e) => setVitalUnit(e.target.value)}
              placeholder="e.g. mmHg"
            />
          </div>
          <fieldset style={{ border: 'none', margin: 0, padding: 0, width: '100%' }}>
            <legend className="lbl">Reference range (optional, from your own records)</legend>
            <div className="row" style={{ gap: 12 }}>
              <div style={{ width: 110 }}>
                <label className="lbl" htmlFor={vitalRefLowId}>
                  Low
                </label>
                <input
                  id={vitalRefLowId}
                  className="field"
                  type="number"
                  value={vitalRefLow}
                  onChange={(e) => setVitalRefLow(e.target.value)}
                />
              </div>
              <div style={{ width: 110 }}>
                <label className="lbl" htmlFor={vitalRefHighId}>
                  High
                </label>
                <input
                  id={vitalRefHighId}
                  className="field"
                  type="number"
                  value={vitalRefHigh}
                  onChange={(e) => setVitalRefHigh(e.target.value)}
                />
              </div>
            </div>
          </fieldset>
        </div>
      )}
      {type === 'allergy' && (
        <div className="row wrap" style={{ gap: 12 }}>
          <div style={{ flex: '1 1 160px' }}>
            <label className="lbl" htmlFor={allergySubstanceId}>
              Substance
            </label>
            <input
              id={allergySubstanceId}
              className="field"
              value={allergySubstance}
              onChange={(e) => setAllergySubstance(e.target.value)}
              placeholder="e.g. Penicillin"
            />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label className="lbl" htmlFor={allergyReactionId}>
              Reaction (optional)
            </label>
            <input
              id={allergyReactionId}
              className="field"
              value={allergyReaction}
              onChange={(e) => setAllergyReaction(e.target.value)}
              placeholder="e.g. Hives"
            />
          </div>
          <div style={{ width: 140 }}>
            <label className="lbl" htmlFor={allergySeverityId}>
              Severity
            </label>
            <select
              id={allergySeverityId}
              className="field"
              value={allergySeverity}
              onChange={(e) => setAllergySeverity(e.target.value as typeof allergySeverity)}
            >
              <option value="">— none —</option>
              <option value="mild">Mild</option>
              <option value="moderate">Moderate</option>
              <option value="severe">Severe</option>
            </select>
          </div>
        </div>
      )}
      {type === 'immunization' && (
        <div className="row wrap" style={{ gap: 12 }}>
          <div style={{ flex: '1 1 160px' }}>
            <label className="lbl" htmlFor={immVaccineId}>
              Vaccine (optional)
            </label>
            <input
              id={immVaccineId}
              className="field"
              value={immVaccine}
              onChange={(e) => setImmVaccine(e.target.value)}
              placeholder="e.g. Tdap"
            />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label className="lbl" htmlFor={immDoseLabelId}>
              Dose label (optional)
            </label>
            <input
              id={immDoseLabelId}
              className="field"
              value={immDoseLabel}
              onChange={(e) => setImmDoseLabel(e.target.value)}
              placeholder="e.g. Booster"
            />
          </div>
        </div>
      )}
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
      <div>
        <span className="lbl" id={attachmentsLabelId}>
          Document references (optional)
        </span>
        {/* References, not uploads: Stemma is local-first and does not store file bytes
            (that's a later phase) — just a name and a note pointing at where the real
            document lives. */}
        <p className="mono-dim" style={{ margin: '0 0 8px' }}>
          Name and a note only — no file is uploaded or stored.
        </p>
        {attachments.length > 0 && (
          <ul
            className="plain-list"
            role="list"
            aria-labelledby={attachmentsLabelId}
            style={{ display: 'grid', gap: 8, marginBottom: 8 }}
          >
            {attachments.map((a, i) => {
              const nameFieldId = `${attachmentsBaseId}-${a.id}-name`;
              const noteFieldId = `${attachmentsBaseId}-${a.id}-note`;
              return (
                <li
                  key={a.id}
                  className="row wrap"
                  role="listitem"
                  style={{ gap: 8, alignItems: 'flex-end' }}
                >
                  <div style={{ flex: '1 1 160px' }}>
                    <label className="lbl" htmlFor={nameFieldId}>
                      Reference {i + 1} name
                    </label>
                    <input
                      id={nameFieldId}
                      className="field"
                      value={a.name}
                      onChange={(e) => updateAttachment(a.id, { name: e.target.value })}
                      placeholder="e.g. Pathology report"
                    />
                  </div>
                  <div style={{ flex: '2 1 220px' }}>
                    <label className="lbl" htmlFor={noteFieldId}>
                      Note (optional)
                    </label>
                    <input
                      id={noteFieldId}
                      className="field"
                      value={a.note}
                      onChange={(e) => updateAttachment(a.id, { note: e.target.value })}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => removeAttachment(a.id)}
                    aria-label={`Remove reference ${i + 1}`}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button
          ref={addReferenceBtnRef}
          type="button"
          className="btn btn--sm"
          onClick={addAttachment}
        >
          + add reference
        </button>
      </div>
      <div className="row">
        <button type="button" className="btn btn--primary btn--sm" onClick={submit}>
          {submitLabel}
        </button>
        <button type="button" className="btn btn--sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
