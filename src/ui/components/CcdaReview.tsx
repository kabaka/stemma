import { useEffect, useId, useState } from 'react';
import type { Relation } from '@/store/useStore';
import { ClinicalBoundary } from './ClinicalBoundary';
import type {
  CcdaMemberOverride,
  CcdaSelections,
  StagedCcdaImport,
  StagedCondition,
  StagedEvent,
  StagedFamilyMember,
} from '@/import';
import { formatPartialDate } from '@/domain/dates';
import type { EventType, FamilyRecord, Person } from '@/domain/types';

/** Same relation/icon/label idiom as `RELATIVE_GRID` in PersonDrawer.tsx (kept as a
 * separate local copy — that one is a module-private constant there, and this picker's
 * anchor is a free choice of any existing person rather than "this drawer's person"). */
const RELATION_CHOICES: { relation: Relation; icon: string; label: string }[] = [
  { relation: 'parent', icon: '↑', label: 'Parent' },
  { relation: 'partner', icon: '↔', label: 'Partner' },
  { relation: 'sibling', icon: '⇔', label: 'Sibling' },
  { relation: 'child', icon: '↓', label: 'Child' },
];

/** Badge styling for a non-'new' status — text-and-shape first (the label IS the meaning),
 * colour only as a supplementary cue, matching FlagCard's severity badge (never
 * colour-alone, WCAG 1.4.1). `'new'` renders no badge — it's the unmarked default. Shared
 * by every staged-item row (conditions AND, since Wave 5, health events) since both
 * {@link StagedCondition} and {@link StagedEvent} carry the identical status union. */
const STATUS_BADGE: Record<
  'duplicate' | 'needs-review',
  { color: string; bg: string; label: string }
> = {
  duplicate: { color: 'var(--sev-note)', bg: 'rgba(255,255,255,0.05)', label: 'Already recorded' },
  'needs-review': {
    color: 'var(--sev-discuss)',
    bg: 'rgba(255,176,67,0.14)',
    label: 'Needs review',
  },
};

function StatusBadge({ status }: { status: 'new' | 'duplicate' | 'needs-review' }) {
  if (status === 'new') return null;
  const meta = STATUS_BADGE[status];
  return (
    <span className="badge" style={{ background: meta.bg, color: meta.color }}>
      {meta.label}
    </span>
  );
}

/** One condition checkbox row — shared by the proband's own conditions and each family
 * member's nested list. Disabled (never checkable) for a `'duplicate'` (checking it would
 * be a no-op — {@link applyCcdaImport} dedupes against the target's existing ids anyway)
 * or a narrative-only entry with no code to attach (`suggestedConditionId === null`); a
 * SNOMED-only `'needs-review'` entry stays checkable since it can still be attached as a
 * long-tail extension. */
function ConditionRow({
  cond,
  checked,
  disabled,
  onToggle,
}: {
  cond: StagedCondition;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className="row"
      style={{ gap: 8, alignItems: 'flex-start', padding: '4px 0', opacity: disabled ? 0.6 : 1 }}
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
      <span className="row wrap" style={{ gap: 8 }}>
        <span style={{ fontSize: 13 }}>{cond.displayName}</span>
        {cond.onsetYear != null && <span className="mono-dim">onset {cond.onsetYear}</span>}
        <StatusBadge status={cond.status} />
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Health events (Wave 2/3 full-timeline import) — source-agnostic: staged identically for
// C-CDA (always `events: []`, so this whole section never renders there) and FHIR sync.
// ---------------------------------------------------------------------------

/** Group labels + render order for the "Health events" section — every {@link StagedEvent}
 * type (`Exclude<EventType,'diagnosis'|'screening'>`), pluralised for a section heading.
 * `'genetic'` stays singular ("Genetic") since "a genetic" doesn't pluralise the same way
 * lab/vital/procedure results do. */
const EVENT_GROUPS: { type: Exclude<EventType, 'diagnosis' | 'screening'>; label: string }[] = [
  { type: 'medication', label: 'Medications' },
  { type: 'lab', label: 'Labs' },
  { type: 'vital', label: 'Vitals' },
  { type: 'immunization', label: 'Immunizations' },
  { type: 'allergy', label: 'Allergies' },
  { type: 'procedure', label: 'Procedures' },
  { type: 'visit', label: 'Visits' },
  { type: 'genetic', label: 'Genetic' },
];

/**
 * Type-specific payload text/markup for one staged event, rendered under its title/date row.
 * Guardrail #1 (never manufacture a risk number): a lab/vital's reference range is rendered
 * as plain transcribed text, explicitly attributed to the source record — never compared
 * against the value, and never as an in-range/out-of-range flag or colour. Severity/reaction
 * are plain text too, never colour-alone (WCAG 1.4.1).
 */
function EventPayload({ event }: { event: StagedEvent }) {
  switch (event.type) {
    case 'lab':
    case 'vital': {
      const m = event.type === 'lab' ? event.lab : event.vital;
      if (!m) return null;
      return (
        <span className="mono-dim" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>
            {m.value} {m.unit}
          </span>
          {m.refLow != null && m.refHigh != null && (
            <span>
              Reference range (from this record): {m.refLow}&ndash;{m.refHigh} {m.unit}
            </span>
          )}
        </span>
      );
    }
    case 'medication': {
      if (!event.med) return null;
      const stopText = event.med.ongoing
        ? 'Ongoing'
        : event.med.stopYear != null
          ? `Stopped ${event.med.stopYear}`
          : 'Stopped';
      const parts = [event.med.dose, stopText].filter((p): p is string => Boolean(p));
      return <span className="mono-dim">{parts.join(' · ')}</span>;
    }
    case 'allergy': {
      if (!event.allergy) return null;
      const parts = [
        event.allergy.substance,
        event.allergy.reaction,
        event.allergy.severity,
      ].filter((p): p is string => Boolean(p));
      return <span className="mono-dim">{parts.join(' · ')}</span>;
    }
    case 'immunization': {
      if (!event.immunization) return null;
      const parts = [event.immunization.vaccine, event.immunization.doseLabel].filter(
        (p): p is string => Boolean(p),
      );
      return parts.length ? <span className="mono-dim">{parts.join(' · ')}</span> : null;
    }
    case 'genetic':
    case 'visit':
    case 'procedure':
      return event.detail ? <span className="mono-dim">{event.detail}</span> : null;
  }
}

/** One health-event checkbox row — the same idiom as {@link ConditionRow}: disabled (never
 * checkable) for a `'duplicate'` (re-syncing an already-imported event; checking it would be
 * a no-op — {@link applyHealthRecordImport} dedupes against the timeline's existing ids
 * anyway). Date prefers the precise {@link StagedEvent.date} echo when the source gave one,
 * falling back to the coarse year — never fabricates a precision the source didn't provide. */
function EventRow({
  event,
  checked,
  onToggle,
}: {
  event: StagedEvent;
  checked: boolean;
  onToggle: () => void;
}) {
  const disabled = event.status === 'duplicate';
  return (
    <label
      className="row"
      style={{ gap: 8, alignItems: 'flex-start', padding: '4px 0', opacity: disabled ? 0.6 : 1 }}
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="row wrap" style={{ gap: 8 }}>
          <span style={{ fontSize: 13 }}>{event.title}</span>
          <span className="mono-dim">
            {event.date ? formatPartialDate(event.date) : event.year}
          </span>
          <StatusBadge status={event.status} />
        </span>
        <EventPayload event={event} />
      </span>
    </label>
  );
}

/** Birth/death text alternative for a staged relative, matching PersonDrawer's `years`
 * convention (`b.1958` / `d.2019`) — never fabricated, `''` when nothing is known. */
function memberYears(m: StagedFamilyMember): string {
  if (m.death.dead) return `d.${m.death.year ?? '?'}`;
  if (m.birthYear != null) return `b.${m.birthYear}`;
  return '';
}

/**
 * The manual-resolution control for an `'ambiguous'` relative (no confident auto-
 * placement, or a same-position naming conflict): don't import it, merge it into one of
 * the `candidates`, or attach it as a new person anywhere in the record via an anchor +
 * relation pair (the `RELATION_CHOICES` idiom). A native `<fieldset>`/radio trio so the
 * three mutually exclusive choices are keyboard- and screen-reader-operable without any
 * custom widget semantics. Starts on "don't import" (defaultSelected is false for every
 * ambiguous item) and calls `onResolve` the moment a resolving choice is made — the
 * parent's selection set and override map only change when this fires, never during
 * plain re-renders.
 */
function AmbiguousResolver({
  member,
  people,
  onResolve,
}: {
  member: StagedFamilyMember;
  people: Person[];
  onResolve: (opts: { selected: boolean; override?: CcdaMemberOverride }) => void;
}) {
  const name = useId();
  const [mode, setMode] = useState<'skip' | 'match' | 'attach'>('skip');
  const [candidateId, setCandidateId] = useState(member.candidates[0]?.personId ?? '');
  const [anchorId, setAnchorId] = useState(member.placement?.anchorId ?? people[0]?.id ?? '');
  const [relation, setRelation] = useState<Relation>(member.placement?.relation ?? 'parent');

  const chooseSkip = (): void => {
    setMode('skip');
    onResolve({ selected: false });
  };
  const chooseMatch = (personId: string): void => {
    setMode('match');
    setCandidateId(personId);
    onResolve({ selected: true, override: { matchedPersonId: personId } });
  };
  const chooseAttach = (nextAnchor: string, nextRelation: Relation): void => {
    setMode('attach');
    setAnchorId(nextAnchor);
    setRelation(nextRelation);
    onResolve({
      selected: true,
      override: { placement: { anchorId: nextAnchor, relation: nextRelation } },
    });
  };

  return (
    <fieldset
      style={{
        border: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <legend className="lbl">How should this relative be handled?</legend>

      <label className="row" style={{ gap: 8 }}>
        <input type="radio" name={name} checked={mode === 'skip'} onChange={chooseSkip} />
        Don&rsquo;t import this relative
      </label>

      {member.candidates.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="radio"
              name={name}
              checked={mode === 'match'}
              onChange={() => chooseMatch(candidateId)}
            />
            Merge into an existing person already in my record
          </label>
          {mode === 'match' && (
            <select
              className="field"
              style={{ marginLeft: 26, width: 'auto' }}
              aria-label={`Existing person to merge ${member.relationshipDisplay} into`}
              value={candidateId}
              onChange={(e) => chooseMatch(e.target.value)}
            >
              {member.candidates.map((c) => (
                <option key={c.personId} value={c.personId}>
                  {c.name} ({c.rel})
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label className="row" style={{ gap: 8 }}>
          <input
            type="radio"
            name={name}
            checked={mode === 'attach'}
            onChange={() => chooseAttach(anchorId, relation)}
          />
          Add as a new person, attached to someone in my record
        </label>
        {mode === 'attach' && (
          <div style={{ marginLeft: 26, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <select
              className="field"
              style={{ width: 'auto' }}
              aria-label={`Attach ${member.relationshipDisplay} to`}
              value={anchorId}
              onChange={(e) => chooseAttach(e.target.value, relation)}
            >
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="relative-grid" role="group" aria-label="Relation to selected person">
              {RELATION_CHOICES.map((r) => (
                <button
                  key={r.relation}
                  type="button"
                  className="chip"
                  aria-pressed={relation === r.relation}
                  onClick={() => chooseAttach(anchorId, r.relation)}
                >
                  <span aria-hidden="true">{r.icon}</span> {r.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </fieldset>
  );
}

/** One staged relative: identity + match/placement state (a plain checkbox for a
 * confident auto-placement or match, {@link AmbiguousResolver} otherwise), plus its own
 * nested condition checkboxes — dimmed and disabled while the relative itself isn't
 * selected, since {@link applyCcdaImport} skips a member's conditions entirely when the
 * member's own `parseId` isn't checked. */
function FamilyMemberCard({
  member,
  people,
  selected,
  conditionSelected,
  onToggleSelf,
  onResolveAmbiguous,
  onToggleCondition,
}: {
  member: StagedFamilyMember;
  people: Person[];
  selected: boolean;
  conditionSelected: (parseId: string) => boolean;
  onToggleSelf: () => void;
  onResolveAmbiguous: (opts: { selected: boolean; override?: CcdaMemberOverride }) => void;
  onToggleCondition: (parseId: string) => void;
}) {
  const years = memberYears(member);
  const matchedName =
    member.matchStatus === 'matched-existing'
      ? (people.find((p) => p.id === member.matchedPersonId)?.name ?? 'existing person')
      : null;
  const anchorName = member.placement
    ? (people.find((p) => p.id === member.placement?.anchorId)?.name ?? 'existing person')
    : null;

  return (
    <div
      className="card"
      style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div>
        <div style={{ fontWeight: 600, fontSize: 13 }}>
          {member.name ?? member.relationshipDisplay}
        </div>
        <div className="mono-dim">
          {member.relationshipDisplay}
          {years ? ` · ${years}` : ''}
        </div>
      </div>

      {member.matchStatus === 'ambiguous' ? (
        <AmbiguousResolver member={member} people={people} onResolve={onResolveAmbiguous} />
      ) : (
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={selected} onChange={onToggleSelf} />
          {member.matchStatus === 'matched-existing'
            ? `Merge conditions into existing record: ${matchedName}`
            : `Add as a new person (${member.placement?.relation ?? 'relative'} of ${anchorName ?? 'you'})`}
        </label>
      )}

      {member.conditions.length > 0 && (
        <div style={{ marginLeft: 26 }}>
          <span className="lbl">Conditions for this relative</span>
          {/* No wrapper-level opacity here: ConditionRow's own `disabled`-driven dim
              (below) is the ONLY dimming layer for this list. Stacking a second opacity
              on top of it used to compound (0.55 × 0.6 ≈ 0.33), sinking the condition
              name/onset/badge text to ~1.6–2.7:1 against --bg-panel — well under WCAG
              1.4.3's 4.5:1 — for every unselected relative, the default rendering. A
              single `disabled` control's own dim is the legitimate WCAG exemption
              (matching `.btn:disabled` in components.css); a second, non-disabled
              opacity layered on top of it is not. */}
          <ul className="plain-list" role="list">
            {member.conditions.map((c) => (
              <li key={c.parseId}>
                <ConditionRow
                  cond={c}
                  checked={conditionSelected(c.parseId)}
                  disabled={!selected || c.status === 'duplicate' || c.suggestedConditionId == null}
                  onToggle={() => onToggleCondition(c.parseId)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Every `parseId` (proband conditions, family members, their nested conditions, and health
 * events) whose `defaultSelected` is true — the staged import's own conservative starting
 * point, before any user interaction. */
function initialSelection(staged: StagedCcdaImport): Set<string> {
  const ids = new Set<string>();
  for (const c of staged.probandConditions) if (c.defaultSelected) ids.add(c.parseId);
  for (const m of staged.familyMembers) {
    if (m.defaultSelected) ids.add(m.parseId);
    for (const c of m.conditions) if (c.defaultSelected) ids.add(c.parseId);
  }
  for (const e of staged.events) if (e.defaultSelected) ids.add(e.parseId);
  return ids;
}

/**
 * The review step for a staged C-CDA import (roadmap DR-0016/DR-0017): every parsed
 * problem and relative rendered as an explicit, individually checkable item, so nothing
 * from the health record lands in the pedigree without the user seeing and accepting it —
 * this checklist IS the "review before merge" confirmation the clinical-safety guardrails
 * require for record-sourced data. Purely a selection UI: it builds a {@link CcdaSelections}
 * and hands it to `onConfirm`; the caller ({@link CcdaImport}) owns calling
 * `applyCcdaImport` and the store boundary.
 */
export function CcdaReview({
  staged,
  record,
  onConfirm,
  onCancel,
  headingLevel = 'h2',
}: {
  staged: StagedCcdaImport;
  record: FamilyRecord;
  onConfirm: (selections: CcdaSelections) => void;
  onCancel: () => void;
  /** Heading level for this component's own "Your conditions" / "Family members"
   * sections. Defaults to `'h2'` — CcdaImport's caller wraps this in no heading of its
   * own, so `'h2'` is correct there. SmartFhirConnect wraps it in its OWN `<h2>` ("Review
   * synced health record"), so it passes `'h3'` to keep these subordinate rather than a
   * sibling h2 immediately following another h2 (WCAG 1.3.1/2.4.6 — heading order should
   * reflect the visual nesting, not just increase monotonically). */
  headingLevel?: 'h2' | 'h3';
}) {
  const Heading = headingLevel;
  // One level below `Heading` for the health-events section's per-type sub-headings
  // (WCAG 1.3.1/2.4.6 — nested content gets a nested heading level, never a sibling).
  const SubHeading = headingLevel === 'h2' ? 'h3' : 'h4';
  const [selected, setSelected] = useState<Set<string>>(() => initialSelection(staged));
  const [overrides, setOverrides] = useState<Record<string, CcdaMemberOverride>>({});

  const probandHeadingId = useId();
  const familyHeadingId = useId();
  const eventsHeadingId = useId();

  const toggleParseId = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resolveMember = (
    parseId: string,
    opts: { selected: boolean; override?: CcdaMemberOverride },
  ): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (opts.selected) next.add(parseId);
      else next.delete(parseId);
      return next;
    });
    setOverrides((prev) => {
      if (!opts.override) {
        if (!(parseId in prev)) return prev;
        const rest = { ...prev };
        delete rest[parseId];
        return rest;
      }
      return { ...prev, [parseId]: opts.override };
    });
  };

  const totalTopLevel =
    staged.probandConditions.length + staged.familyMembers.length + staged.events.length;
  const selectedTopLevel = [...selected].filter(
    (id) =>
      staged.probandConditions.some((c) => c.parseId === id) ||
      staged.familyMembers.some((m) => m.parseId === id) ||
      staged.events.some((e) => e.parseId === id),
  ).length;

  const handleConfirmClick = (): void => {
    // Gate on top-level selections (proband conditions + selected relatives), not the raw set:
    // a condition pre-checked under an unselected/ambiguous relative sits in `selected` but is
    // skipped by applyCcdaImport, so it must not make the button read as "something to import".
    if (selectedTopLevel === 0) return;
    onConfirm({ selectedParseIds: selected, overrides });
  };

  // The "N of M selected" status text, committed one tick after the count it describes
  // changes (rather than read directly off selectedTopLevel/totalTopLevel during render).
  // This component mounts already carrying a live selection (initialSelection runs before
  // first paint), so rendering the role="status" region pre-populated on that very first
  // render is the same "inserted into the DOM already populated" bug the persistent
  // regions in GedcomImport/CcdaImport avoid — some screen readers don't announce a live
  // region's initial content, only its subsequent mutations. Starting empty and setting
  // the real text in an effect guarantees a mutation for the first count too.
  const [selectionStatus, setSelectionStatus] = useState('');
  useEffect(() => {
    setSelectionStatus(
      `${selectedTopLevel} of ${totalTopLevel} ${totalTopLevel === 1 ? 'item' : 'items'} selected to import.`,
    );
  }, [selectedTopLevel, totalTopLevel]);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <p className="mono-dim" style={{ margin: 0, lineHeight: 1.5 }}>
        Everything below comes directly from the health record you imported (provenance: record) and
        hasn&rsquo;t been checked against what you&rsquo;ve already entered. Review each item —
        nothing is added unless it&rsquo;s checked.
      </p>

      <ClinicalBoundary />

      {staged.warnings.length > 0 && (
        <div className="disclaimer">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {staged.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <section aria-labelledby={probandHeadingId}>
        <Heading id={probandHeadingId} className="overline" style={{ marginBottom: 8 }}>
          Your conditions
        </Heading>
        {staged.probandConditions.length === 0 ? (
          <p className="mono-dim">No conditions were found in the problem list.</p>
        ) : (
          <ul
            className="plain-list"
            role="list"
            style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            {staged.probandConditions.map((cond) => (
              <li key={cond.parseId}>
                <ConditionRow
                  cond={cond}
                  checked={selected.has(cond.parseId)}
                  disabled={cond.status === 'duplicate' || cond.suggestedConditionId == null}
                  onToggle={() => toggleParseId(cond.parseId)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={familyHeadingId}>
        <Heading id={familyHeadingId} className="overline" style={{ marginBottom: 8 }}>
          Family members
        </Heading>
        {staged.familyMembers.length === 0 ? (
          <p className="mono-dim">No family history section was found in this document.</p>
        ) : (
          <ul
            className="plain-list"
            role="list"
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {staged.familyMembers.map((member) => (
              <li key={member.parseId}>
                <FamilyMemberCard
                  member={member}
                  people={record.people}
                  selected={selected.has(member.parseId)}
                  conditionSelected={(parseId) => selected.has(parseId)}
                  onToggleSelf={() => toggleParseId(member.parseId)}
                  onResolveAmbiguous={(opts) => resolveMember(member.parseId, opts)}
                  onToggleCondition={toggleParseId}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Source-agnostic (Wave 2/3 full-timeline import): C-CDA parses always carry
          `events: []`, so this whole section is absent there — rendered only when a source
          (FHIR sync, today) actually staged health events. */}
      {staged.events.length > 0 && (
        <section aria-labelledby={eventsHeadingId}>
          <Heading id={eventsHeadingId} className="overline" style={{ marginBottom: 8 }}>
            Health events
          </Heading>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {EVENT_GROUPS.map(({ type, label }) => {
              const items = staged.events.filter((e) => e.type === type);
              if (items.length === 0) return null;
              return (
                <div key={type}>
                  <SubHeading className="lbl" style={{ margin: '0 0 4px' }}>
                    {label}
                  </SubHeading>
                  <ul
                    className="plain-list"
                    role="list"
                    style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
                  >
                    {items.map((event) => (
                      <li key={event.parseId}>
                        <EventRow
                          event={event}
                          checked={selected.has(event.parseId)}
                          onToggle={() => toggleParseId(event.parseId)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <p role="status" className="mono-dim" style={{ margin: 0, minHeight: 18 }}>
        {selectionStatus}
      </p>

      <div className="row" style={{ gap: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={handleConfirmClick}
          aria-disabled={selectedTopLevel === 0}
        >
          Import selected items
        </button>
        <button type="button" className="btn btn--sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
