import { useEffect, useRef, useState } from 'react';
import {
  dayOfPartialDate,
  formatPartialDate,
  isPartialDate,
  monthOfPartialDate,
  yearOfPartialDate,
} from '@/domain/dates';
import type { PartialDate } from '@/domain/types';

const MONTHS: { value: string; label: string }[] = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];
const MONTH_LABEL = new Map(MONTHS.map((m) => [m.value, m.label]));
const DAYS: string[] = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));

const pad4 = (n: number): string => String(n).padStart(4, '0');

interface PartialDateFieldsBase {
  /** Base id this instance's fields derive their own element ids from — must be unique
   * per rendered instance (one per event/birth/death/condition-onset field). */
  idBase: string;
  /** Fieldset legend shown once the refinement is expanded, ending "(optional)". Also
   * used to derive the disclosure trigger's and remove button's accessible names, so
   * several instances on one screen (e.g. birth + death) read distinctly to assistive
   * tech rather than all sharing one generic "+ Add exact date". */
  legend: string;
  /** Seed value, read once at mount — like every other field in these forms (local
   * state, committed on submit or per-keystroke by the caller, never re-derived from a
   * changed prop mid-life). An external reset (the coarse year changed) is done by the
   * caller remounting this component via a changed `key`, not by an effect here. */
  initialValue: PartialDate | undefined;
  onChange: (next: PartialDate | undefined) => void;
}

type PartialDateFieldsProps =
  | ({
      mode: 'locked';
      /** The sibling coarse-year field's current parsed value (`null` when it's blank or
       * not a valid number). The refinement's year is always exactly this — there is no
       * year input here to disagree with it — enforcing `isValidPartialDateFor`'s "year
       * component must equal the coarse value" invariant by construction. */
      lockedYear: number | null;
    } & PartialDateFieldsBase)
  | ({ mode: 'free' } & PartialDateFieldsBase);

/**
 * Optional refinement of a required coarse year into a precise {@link PartialDate} — year,
 * year+month, or year+month+day. A native `<input type="date">` can't express partial
 * precision (it's always a complete calendar date), so this is a disclosed month + day
 * pair instead: collapsed behind an "+ Add exact …" trigger by default (a bare year is
 * already a complete, valid answer — this is optional refinement, not a second required
 * field) but expanded automatically when a value is already present, so editing an
 * existing precise date shows it immediately.
 *
 * `mode: 'locked'` anchors the year to a sibling coarse-year field (an event's date, a
 * birth, a death) — only month/day are chosen here. `mode: 'free'` is for a value with no
 * coarse-year sibling at all (a condition's `onsetDate` — onset is recorded as an age, not
 * a year) and includes its own year input.
 *
 * An invalid day for the chosen month (`isPartialDate` fails — e.g. February 30th) is
 * rejected with an inline, programmatically-associated error message rather than silently
 * accepted; the committed value falls back to the still-valid month-only precision.
 */
export function PartialDateFields(props: PartialDateFieldsProps) {
  const { idBase, legend, initialValue, onChange, mode } = props;
  const [open, setOpen] = useState(initialValue !== undefined);
  const [yearStr, setYearStr] = useState(() =>
    mode === 'free' && initialValue ? String(yearOfPartialDate(initialValue)) : '',
  );
  const [monthStr, setMonthStr] = useState(() => {
    const m = initialValue ? monthOfPartialDate(initialValue) : null;
    return m === null ? '' : String(m).padStart(2, '0');
  });
  const [dayStr, setDayStr] = useState(() => {
    const d = initialValue ? dayOfPartialDate(initialValue) : null;
    return d === null ? '' : String(d).padStart(2, '0');
  });
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState<PartialDate | undefined>(initialValue);

  const yearId = `${idBase}-year`;
  const monthId = `${idBase}-month`;
  const dayId = `${idBase}-day`;
  const errorId = `${idBase}-error`;
  const hintId = `${idBase}-hint`;

  // Focus management for this disclosure (WCAG 2.4.3) — mirrors `useDisclosureFocus`'s
  // move-in/hand-back idiom, but that hook fires once per mount/unmount of its OWN
  // component; here the trigger button and the fieldset are two branches of ONE component
  // instance's render, toggled by `open` state rather than a mount/unmount boundary, so the
  // focus move has to be driven explicitly off that state instead.
  // The first field of the revealed fieldset — the year input in `mode:'free'` (it has no
  // sibling coarse-year field to anchor on), the month select in `mode:'locked'` (year is
  // fixed already). Two separate refs rather than one polymorphic ref: `RefObject<A | B>`
  // doesn't structurally match either element's own `Ref<A>`/`Ref<B>` prop type.
  const yearRef = useRef<HTMLInputElement>(null);
  const monthRef = useRef<HTMLSelectElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Only true immediately after the user clicks "+ Add …" — guards the effect below so an
  // instance that mounts already-open (an existing precise date, expanded from the start)
  // never steals focus from whatever the surrounding form put it on at load.
  const openedByUserRef = useRef(false);

  useEffect(() => {
    if (!openedByUserRef.current) return;
    openedByUserRef.current = false;
    if (mode === 'free') {
      yearRef.current?.focus();
    } else {
      monthRef.current?.focus();
    }
  }, [open, mode]);

  const core = legend.replace(/\s*\(optional\)\s*$/i, '');
  const lowerCore = core.length ? core.charAt(0).toLowerCase() + core.slice(1) : core;
  const toggleLabel = `+ Add ${lowerCore}`;
  const removeLabel = `Remove ${lowerCore}`;

  const parsedFreeYear = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed.length !== 4) return null;
    const n = Number.parseInt(trimmed, 10);
    return Number.isNaN(n) ? null : n;
  };
  const anchorYear = mode === 'locked' ? props.lockedYear : parsedFreeYear(yearStr);
  const disabled = anchorYear === null;

  /** Recompute + commit from the three current text pieces after any one of them
   * changes. Always resolves to SOME valid `onChange` call (an undefined-clearing one, a
   * month-only one, or a full one) — never propagates a malformed string upward. */
  const recompute = (nextYear: number | null, nextMonth: string, nextDay: string): void => {
    if (nextYear === null || nextMonth === '') {
      setError(null);
      setCommitted(undefined);
      onChange(undefined);
      return;
    }
    const monthOnly = `${pad4(nextYear)}-${nextMonth}`;
    if (nextDay === '') {
      setError(null);
      setCommitted(monthOnly);
      onChange(monthOnly);
      return;
    }
    const full = `${monthOnly}-${nextDay}`;
    if (isPartialDate(full)) {
      setError(null);
      setCommitted(full);
      onChange(full);
    } else {
      // Impossible combination (e.g. Feb 30, Apr 31) — surface it inline rather than
      // accept it, and fall back to the month-only precision, which IS valid, so the
      // committed value never disagrees with what's displayed as accepted.
      setError(
        `${MONTH_LABEL.get(nextMonth)} doesn't have a day ${Number.parseInt(nextDay, 10)} — pick a different day, or leave the day blank.`,
      );
      setCommitted(monthOnly);
      onChange(monthOnly);
    }
  };

  const handleYear = (raw: string): void => {
    setYearStr(raw);
    recompute(parsedFreeYear(raw), monthStr, dayStr);
  };
  const handleMonth = (raw: string): void => {
    setMonthStr(raw);
    const nextDay = raw === '' ? '' : dayStr; // no day without a month
    if (raw === '') setDayStr('');
    recompute(anchorYear, raw, nextDay);
  };
  const handleDay = (raw: string): void => {
    setDayStr(raw);
    recompute(anchorYear, monthStr, raw);
  };
  const handleRemove = (): void => {
    setYearStr('');
    setMonthStr('');
    setDayStr('');
    setError(null);
    setCommitted(undefined);
    onChange(undefined);
    setOpen(false);
    // The trigger button doesn't exist yet at this instant — it remounts on the render
    // this `setOpen(false)` triggers. rAF defers to after React commits that render, the
    // same idiom TimelineView's `addReferenceBtnRef` uses for a removed row.
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const handleOpen = (): void => {
    openedByUserRef.current = true;
    setOpen(true);
  };

  if (!open) {
    return (
      <button ref={triggerRef} type="button" className="btn btn--sm" onClick={handleOpen}>
        {toggleLabel}
      </button>
    );
  }

  return (
    <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
      <legend className="lbl">{legend}</legend>
      <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
        {mode === 'free' && (
          <div style={{ width: 90 }}>
            <label className="lbl" htmlFor={yearId}>
              Year
            </label>
            <input
              ref={yearRef}
              id={yearId}
              className="field"
              type="number"
              value={yearStr}
              aria-describedby={disabled ? hintId : undefined}
              onChange={(e) => handleYear(e.target.value)}
            />
          </div>
        )}
        <div style={{ width: 160 }}>
          <label className="lbl" htmlFor={monthId}>
            Month
          </label>
          <select
            ref={monthRef}
            id={monthId}
            className="field"
            value={monthStr}
            disabled={disabled}
            aria-describedby={disabled ? hintId : undefined}
            onChange={(e) => handleMonth(e.target.value)}
          >
            <option value="">— month unknown —</option>
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ width: 130 }}>
          <label className="lbl" htmlFor={dayId}>
            Day
          </label>
          <select
            id={dayId}
            className="field"
            value={dayStr}
            disabled={disabled || monthStr === ''}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : disabled ? hintId : undefined}
            onChange={(e) => handleDay(e.target.value)}
          >
            <option value="">— day unknown —</option>
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {Number(d)}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn--sm" onClick={handleRemove}>
          {removeLabel}
        </button>
      </div>
      {disabled && (
        <p id={hintId} className="mono-dim" style={{ margin: '6px 0 0' }}>
          {mode === 'locked' ? 'Enter a year above first.' : 'Enter a year first.'}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          style={{ color: 'var(--sev-referral)', fontSize: 12, margin: '6px 0 0' }}
        >
          {error}
        </p>
      )}
      {/* Shown alongside an error too (not just when clean): after an invalid day falls
          back to month-only precision, the user should see both WHY it was rejected and
          WHAT is actually recorded now, rather than only one of the two. */}
      {committed && (
        <p className="mono-dim" role="status" style={{ margin: '6px 0 0' }}>
          Recorded as: {formatPartialDate(committed)}
        </p>
      )}
    </fieldset>
  );
}
