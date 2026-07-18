import { useEffect, useId, useState } from 'react';
import type { Relation } from '@/store/useStore';
import { ClinicalBoundary } from './ClinicalBoundary';
import type {
  CcdaMemberOverride,
  CcdaSelections,
  StagedCcdaImport,
  StagedCondition,
  StagedFamilyMember,
} from '@/import';
import type { FamilyRecord, Person } from '@/domain/types';

/** Same relation/icon/label idiom as `RELATIVE_GRID` in PersonDrawer.tsx (kept as a
 * separate local copy — that one is a module-private constant there, and this picker's
 * anchor is a free choice of any existing person rather than "this drawer's person"). */
const RELATION_CHOICES: { relation: Relation; icon: string; label: string }[] = [
  { relation: 'parent', icon: '↑', label: 'Parent' },
  { relation: 'partner', icon: '↔', label: 'Partner' },
  { relation: 'sibling', icon: '⇔', label: 'Sibling' },
  { relation: 'child', icon: '↓', label: 'Child' },
];

/** Badge styling for a non-'new' condition status — text-and-shape first (the label IS
 * the meaning), colour only as a supplementary cue, matching FlagCard's severity badge
 * (never colour-alone, WCAG 1.4.1). `'new'` renders no badge — it's the unmarked default. */
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

function ConditionStatusBadge({ status }: { status: StagedCondition['status'] }) {
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
        <ConditionStatusBadge status={cond.status} />
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

/** Every `parseId` (proband conditions, family members, and their nested conditions)
 * whose `defaultSelected` is true — the staged import's own conservative starting point,
 * before any user interaction. */
function initialSelection(staged: StagedCcdaImport): Set<string> {
  const ids = new Set<string>();
  for (const c of staged.probandConditions) if (c.defaultSelected) ids.add(c.parseId);
  for (const m of staged.familyMembers) {
    if (m.defaultSelected) ids.add(m.parseId);
    for (const c of m.conditions) if (c.defaultSelected) ids.add(c.parseId);
  }
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
}: {
  staged: StagedCcdaImport;
  record: FamilyRecord;
  onConfirm: (selections: CcdaSelections) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => initialSelection(staged));
  const [overrides, setOverrides] = useState<Record<string, CcdaMemberOverride>>({});

  const probandHeadingId = useId();
  const familyHeadingId = useId();

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

  const totalTopLevel = staged.probandConditions.length + staged.familyMembers.length;
  const selectedTopLevel = [...selected].filter(
    (id) =>
      staged.probandConditions.some((c) => c.parseId === id) ||
      staged.familyMembers.some((m) => m.parseId === id),
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
        <h2 id={probandHeadingId} className="overline" style={{ marginBottom: 8 }}>
          Your conditions
        </h2>
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
        <h2 id={familyHeadingId} className="overline" style={{ marginBottom: 8 }}>
          Family members
        </h2>
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
