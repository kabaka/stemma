/**
 * Pure helpers for {@link import('./types').PartialDate} — an ISO-8601 partial date
 * (`"YYYY"` | `"YYYY-MM"` | `"YYYY-MM-DD"`) carrying exactly the precision the source gave.
 *
 * These are deliberately TZ-independent and clock-free: every function parses the string's
 * OWN components (year/month/day integers) and never routes through `new Date(str)`. A
 * `new Date('2019-03-01')` parses as UTC midnight, and reading it back through a local-time
 * getter (`getDate`/`getMonth`/`toLocaleDateString`) rolls the date back a day in any
 * negative-UTC-offset timezone — so a `Date`-based formatter would render "February 28,
 * 2019" in Honolulu. Building the formatted string from the parsed integers keeps the output
 * identical in every timezone.
 */
import type { PartialDate } from './types';

/** Full month names, indexed 1–12 (index 0 is a placeholder that is never read). */
const MONTHS: readonly string[] = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Structural match: 4-digit year, optional zero-padded `-MM`, optional zero-padded `-DD`. */
const PARTIAL_DATE_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/** Whether `year` is a Gregorian leap year (computed, no `Date`). */
function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Number of days in a given 1-based `month` of `year` (28–31), computed, no `Date`. */
function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1];
}

/**
 * Type guard: `true` iff `v` is a well-formed {@link PartialDate}. Requires the ISO-8601
 * partial shape (a bare 4-digit year, optionally `-MM`, optionally `-DD`, all zero-padded),
 * a real month (01–12), and a day that actually exists in that month/year — leap years
 * included, so `"2019-02-30"` is rejected. Rejects non-strings, the empty string, 2-digit
 * years, unpadded components, slash separators, a time component, and out-of-range values.
 */
export function isPartialDate(v: unknown): v is PartialDate {
  if (typeof v !== 'string') return false;
  const m = PARTIAL_DATE_RE.exec(v);
  if (!m) return false;
  const year = Number(m[1]);
  let month = 0;
  if (m[2] !== undefined) {
    month = Number(m[2]);
    if (month < 1 || month > 12) return false;
  }
  if (m[3] !== undefined) {
    const day = Number(m[3]);
    if (day < 1 || day > daysInMonth(year, month)) return false;
  }
  return true;
}

/** The 4-digit year component as an integer. */
export function yearOfPartialDate(d: PartialDate): number {
  return Number(d.slice(0, 4));
}

/** The month (1–12) when the date carries month precision, else `null`. */
export function monthOfPartialDate(d: PartialDate): number | null {
  const m = PARTIAL_DATE_RE.exec(d);
  if (!m || m[2] === undefined) return null;
  return Number(m[2]);
}

/** The day (1–31) when the date carries day precision, else `null`. */
export function dayOfPartialDate(d: PartialDate): number | null {
  const m = PARTIAL_DATE_RE.exec(d);
  if (!m || m[3] === undefined) return null;
  return Number(m[3]);
}

/**
 * Human-readable rendering, built purely from the parsed integer components (no `Date`):
 * `"2019"` (year only), `"March 2019"` (year-month), `"March 15, 2019"` (full date, no
 * leading zero on the day). Identical in every timezone.
 */
export function formatPartialDate(d: PartialDate): string {
  const year = yearOfPartialDate(d);
  const month = monthOfPartialDate(d);
  if (month === null) return String(year);
  const monthName = MONTHS[month];
  const day = dayOfPartialDate(d);
  if (day === null) return `${monthName} ${year}`;
  return `${monthName} ${day}, ${year}`;
}
