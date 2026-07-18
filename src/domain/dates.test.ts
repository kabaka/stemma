/**
 * Oracle for `src/domain/dates.ts` (W1 full-timeline import, not yet implemented — see
 * `.ai-dlc` DR-0023/DR-0024 and the timeline-import contract). Test-first: this file is
 * expected to fail on a missing module until the implementer builds `dates.ts`.
 *
 * `PartialDate` is an ISO-8601 partial: "YYYY" | "YYYY-MM" | "YYYY-MM-DD" — exactly the
 * precision the source gave, never a fabricated day/month. `dates.ts` must be pure and
 * TZ-independent: parse the string's own components, never `new Date(str)` (which parses
 * a bare "YYYY-MM-DD" as UTC midnight and rolls back a day under a negative UTC offset).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  dayOfPartialDate,
  formatPartialDate,
  isPartialDate,
  monthOfPartialDate,
  yearOfPartialDate,
} from './dates';

describe('isPartialDate', () => {
  it.each(['2019', '2019-03', '2019-03-15'])('accepts %s', (v) => {
    expect(isPartialDate(v)).toBe(true);
  });

  it.each([
    ['2019-13', 'month 13 is out of the 01-12 range'],
    ['2019-02-30', 'February 2019 (not a leap year) has no 30th'],
    ['19', 'a 2-digit year is not a 4-digit year'],
    ['2019-3-5', 'month/day must be zero-padded to 2 digits'],
    ['', 'the empty string is not a date'],
    ['2019-03-15T10:00', 'a time component is not part of a PartialDate'],
    ['2019-00', 'month 00 is out of the 01-12 range'],
    ['2019-01-00', 'day 00 is out of the 01-31 range'],
    ['2019-01-32', 'day 32 is out of the 01-31 range'],
    ['2019/03/15', 'slashes are not the ISO-8601 separator'],
    ['not-a-date', 'garbage input'],
  ])('rejects %s (%s)', (v) => {
    expect(isPartialDate(v)).toBe(false);
  });

  it.each([null, undefined, 2019, 20190315, {}, [], true, ['2019']])(
    'rejects the non-string %j',
    (v) => {
      expect(isPartialDate(v)).toBe(false);
    },
  );
});

describe('yearOfPartialDate / monthOfPartialDate / dayOfPartialDate', () => {
  it('reads the year component regardless of precision', () => {
    expect(yearOfPartialDate('2019')).toBe(2019);
    expect(yearOfPartialDate('2019-03')).toBe(2019);
    expect(yearOfPartialDate('2019-03-15')).toBe(2019);
  });

  it('month is null for a year-only date, and the numeric month otherwise', () => {
    expect(monthOfPartialDate('2019')).toBeNull();
    expect(monthOfPartialDate('2019-03')).toBe(3);
    expect(monthOfPartialDate('2019-11')).toBe(11);
    expect(monthOfPartialDate('2019-03-15')).toBe(3);
  });

  it('day is null unless the date carries day precision', () => {
    expect(dayOfPartialDate('2019')).toBeNull();
    expect(dayOfPartialDate('2019-03')).toBeNull();
    expect(dayOfPartialDate('2019-03-15')).toBe(15);
    expect(dayOfPartialDate('2019-03-01')).toBe(1); // no leading-zero leakage into the number
  });
});

describe('formatPartialDate', () => {
  it('formats a year-only date as the bare year', () => {
    expect(formatPartialDate('2019')).toBe('2019');
  });

  it('formats a year-month date as "Month YYYY"', () => {
    expect(formatPartialDate('2019-03')).toBe('March 2019');
    expect(formatPartialDate('2019-01')).toBe('January 2019');
    expect(formatPartialDate('2019-12')).toBe('December 2019');
  });

  it('formats a full date as "Month D, YYYY" with no leading zero on the day', () => {
    expect(formatPartialDate('2019-03-01')).toBe('March 1, 2019');
    expect(formatPartialDate('2019-03-09')).toBe('March 9, 2019');
    expect(formatPartialDate('2019-12-25')).toBe('December 25, 2019');
  });

  // --- The UTC-midnight trap ---------------------------------------------------------
  //
  // A `new Date('2019-03-01')` implementation parses the string as UTC midnight. Reading
  // it back with LOCAL getters (getDate/getMonth/toLocaleDateString) rolls the date back
  // to Feb 28 in any negative-UTC-offset timezone. The correct implementation parses the
  // string's own YYYY-MM-DD components and never routes through a `Date` local-time
  // getter, so the formatted output is identical in every timezone. We sweep negative,
  // positive, and zero offsets — a `new Date(str)` implementation fails at least the
  // negative-offset case (Honolulu/Los Angeles) below, since UTC midnight local-converts
  // to the previous day only west of UTC.
  const ORIGINAL_TZ = process.env.TZ;
  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  const TIMEZONES = [
    'Pacific/Honolulu', // UTC-10 — the classic "rolls back a day" trap
    'America/Los_Angeles', // UTC-8/-7 — negative offset, DST-observing
    'UTC',
    'Asia/Kolkata', // UTC+5:30 — positive, non-integer offset
    'Pacific/Kiritimati', // UTC+14 — furthest positive offset that exists
  ];

  it.each(TIMEZONES)('formats the 1st of the month identically under TZ=%s', (tz) => {
    process.env.TZ = tz;
    expect(formatPartialDate('2019-03-01')).toBe('March 1, 2019');
  });

  it.each(TIMEZONES)('formats a year-only date identically under TZ=%s', (tz) => {
    process.env.TZ = tz;
    expect(formatPartialDate('2019')).toBe('2019');
  });

  it.each(TIMEZONES)('formats a year-month date identically under TZ=%s', (tz) => {
    process.env.TZ = tz;
    expect(formatPartialDate('2019-03')).toBe('March 2019');
  });

  it('REGRESSION: the 1st-of-the-month day-of-month is never shifted under a negative UTC offset', () => {
    // The single sharpest instance of the trap: December 1st under Honolulu (UTC-10) is
    // the case a naive `new Date('2019-12-01')` implementation gets wrong most visibly
    // (rolls back to "November 30, 2019").
    process.env.TZ = 'Pacific/Honolulu';
    expect(formatPartialDate('2019-12-01')).toBe('December 1, 2019');
    expect(dayOfPartialDate('2019-12-01')).toBe(1);
    expect(monthOfPartialDate('2019-12-01')).toBe(12);
  });
});
