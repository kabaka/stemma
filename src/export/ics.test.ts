import { describe, expect, it } from 'vitest';
import { buildIcsCalendar } from './ics';
import { scheduleFor } from '@/domain/screening';
import { CLINICAL_BOUNDARY_TEXT } from '@/domain/boundary';
import type { FamilyRecord, Person, TimelineEvent } from '@/domain/types';

/** Minimal fixture person — mirrors the other export tests' `mkPerson` helper. */
function mkPerson(id: string, overrides: Partial<Person> = {}): Person {
  return {
    id,
    name: id,
    sab: 'f',
    gender: 'woman',
    gen: 0,
    x: 0,
    dead: false,
    birth: null,
    death: null,
    conds: [],
    ...overrides,
  };
}

let eventSeq = 0;
function mkScreeningEvent(person: string, year: number, screeningId?: string): TimelineEvent {
  return {
    id: `evt-${eventSeq++}`,
    person,
    year,
    type: 'screening',
    title: 'Screening',
    detail: '',
    screeningId,
  };
}

function mkRecord(people: Person[], timeline: TimelineEvent[] = []): FamilyRecord {
  return { people, unions: [], timeline, probandId: people[0].id };
}

/**
 * RFC 5545 §3.1 unfolding: a CRLF immediately followed by a single space is removed,
 * rejoining a continuation with its parent content line. Used to recover logical property
 * values without duplicating `foldLine`'s byte-counting algorithm under test.
 */
function unfoldLines(ics: string): string[] {
  return ics
    .replace(/\r\n /g, '')
    .split('\r\n')
    .filter((l) => l.length > 0);
}

function findVevent(lines: string[], uid: string): string[] {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== 'BEGIN:VEVENT') continue;
    const end = lines.indexOf('END:VEVENT', i);
    const block = lines.slice(i, end + 1);
    if (block.includes(`UID:${uid}`)) return block;
  }
  throw new Error(`no VEVENT with UID ${uid} in:\n${lines.join('\n')}`);
}

// Fixed reference point throughout — never the wall clock (seed convention: 2026).
const ASOF = 2026;
const NOW = '2026-03-10T14:22:00.000Z';

describe('buildIcsCalendar', () => {
  // birth 1982 → age 44 in 2026: mammogram (40–74) and lipids/hba1c (organ-agnostic) apply;
  // colonoscopy (starts 45) is still notYet, so this fixture yields exactly three VEVENTs.
  // organs: ['breasts'] excludes cervical/prostate so only the intended defs are in play.
  const root = mkPerson('p1', { name: 'Ann', birth: 1982, organs: ['breasts'] });
  const record = mkRecord([root], [mkScreeningEvent('p1', 2019, 'mammogram')]);
  const ics = buildIcsCalendar(record, 'p1', { now: NOW, asOfYear: ASOF });
  const lines = unfoldLines(ics);

  it('is byte-stable: calling it twice with identical inputs yields the identical string', () => {
    const again = buildIcsCalendar(record, 'p1', { now: NOW, asOfYear: ASOF });
    expect(again).toBe(ics);
  });

  it('emits exactly one VEVENT per qualifying scheduleFor entry — the documented composition contract', () => {
    const qualifying = scheduleFor(record, 'p1', ASOF).filter(
      (s) => s.nextDueYear !== null && s.scheduleStatus !== 'notYet',
    );
    const veventCount = lines.filter((l) => l === 'BEGIN:VEVENT').length;
    expect(veventCount).toBe(qualifying.length);
    expect(veventCount).toBe(3); // mammogram, lipids, hba1c — sanity on the fixture itself.
    for (const s of qualifying) {
      expect(lines).toContain(`UID:p1.${s.id}.${s.nextDueYear}@stemma.local`);
    }
  });

  it('produces the exact documented content for a specific VEVENT (mammogram)', () => {
    const block = findVevent(lines, 'p1.mammogram.2021@stemma.local');
    const escapedBoundary = CLINICAL_BOUNDARY_TEXT.replace(/,/g, '\\,');
    const expectedDescription =
      'Breast tissue present. ' +
      'From 40\\; annual (ACS/ACR) or biennial (USPSTF). ' +
      'May be due based on typical guideline intervals — worth raising at your next visit. ' +
      'Year due — exact date not tracked\\; schedule with your clinician.' +
      '\\n\\n' +
      escapedBoundary;

    expect(block).toEqual([
      'BEGIN:VEVENT',
      'UID:p1.mammogram.2021@stemma.local',
      'DTSTAMP:20260310T142200Z',
      'DTSTART;VALUE=DATE:20210101',
      'STATUS:TENTATIVE',
      'SUMMARY:Screening due: Mammogram — Ann',
      `DESCRIPTION:${expectedDescription}`,
      'END:VEVENT',
    ]);
  });

  it('opens with BEGIN:VCALENDAR and the fixed calendar headers, and closes with END:VCALENDAR', () => {
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('PRODID:-//Stemma//Care Coordination//EN');
    expect(lines).toContain('CALSCALE:GREGORIAN');
    expect(lines).toContain('METHOD:PUBLISH');
    expect(lines[lines.length - 1]).toBe('END:VCALENDAR');
  });

  it('uses CRLF line endings throughout — no bare LF', () => {
    expect(ics).toContain('\r\n');
    expect(ics).not.toMatch(/(?<!\r)\n/);
  });

  it('folds long content lines to at most 75 octets, with a single leading space on continuations', () => {
    const enc = new TextEncoder();
    const rawLines = ics.split('\r\n');
    // Drop the last element (empty string after the trailing CRLF).
    const contentLines = rawLines.slice(0, -1);
    for (const line of contentLines) {
      expect(enc.encode(line).length).toBeLessThanOrEqual(75);
    }
    // Every property line we emit starts with an uppercase tag or "BEGIN"/"END" — a leading
    // space can therefore only occur on a folded continuation, never on a "real" content line.
    const continuations = contentLines.filter((l) => l.startsWith(' '));
    expect(continuations.length).toBeGreaterThan(0); // the boundary text guarantees folding.
    // Unfolding (stripping exactly the fold's one leading space, per line) must reproduce
    // the untruncated DESCRIPTION content verbatim — proven by the exact-content test above,
    // which compares the unfolded block byte-for-byte against a hand-derived expectation.
  });

  it('includes the shared clinical-boundary text verbatim (escaped) in every DESCRIPTION', () => {
    const escapedBoundary = CLINICAL_BOUNDARY_TEXT.replace(/,/g, '\\,');
    const descriptionLines = lines.filter((l) => l.startsWith('DESCRIPTION:'));
    expect(descriptionLines.length).toBeGreaterThan(0);
    for (const d of descriptionLines) {
      expect(d).toContain(escapedBoundary);
    }
  });
});

describe('buildIcsCalendar — empty and notYet cases', () => {
  it('yields a structurally valid, zero-VEVENT calendar for a root with no qualifying screens — and does not throw', () => {
    const root = mkPerson('young', { birth: 2020 }); // age 6 in 2026 — every cadence is notYet.
    const record = mkRecord([root]);
    expect(() => buildIcsCalendar(record, 'young', { now: NOW, asOfYear: ASOF })).not.toThrow();
    const ics = buildIcsCalendar(record, 'young', { now: NOW, asOfYear: ASOF });
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('emits zero VEVENTs for a deceased root, even with an organ/age that would otherwise schedule several', () => {
    // Mirrors the domain-level `scheduleFor` deceased-root regression test: a schedule
    // projects future dates, and the deceased have none — this composes over `scheduleFor`
    // so the ics exporter must inherit the guard, never re-derive it.
    const root = mkPerson('dead1', { birth: 1970, dead: true, death: 2020, organs: ['breasts'] });
    const record = mkRecord([root]);
    const ics = buildIcsCalendar(record, 'dead1', { now: NOW, asOfYear: ASOF });
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });

  it('omits a notYet screen even when other screens on the same root do qualify', () => {
    const root = mkPerson('mid', { birth: 2004 }); // age 22 in 2026: lipids/cervical apply, mammogram/colonoscopy/hba1c do not yet.
    const record = mkRecord([root]);
    const ics = buildIcsCalendar(record, 'mid', { now: NOW, asOfYear: ASOF });
    expect(ics).toMatch(/UID:mid\.lipids\.\d+@stemma\.local/);
    expect(ics).not.toMatch(/UID:mid\.mammogram\.\d+@stemma\.local/);
    expect(ics).not.toMatch(/UID:mid\.colonoscopy\.\d+@stemma\.local/);
    expect(ics).not.toMatch(/UID:mid\.hba1c\.\d+@stemma\.local/);
  });

  it('never emits a VEVENT for a def without a cadence (prostate, brcapanel), even with a family signal', () => {
    const gp1 = mkPerson('gp1', { sab: 'm', gender: 'man' });
    const gp2 = mkPerson('gp2', { sab: 'f', gender: 'woman' });
    const root = mkPerson('p6', { sab: 'm', gender: 'man', birth: 1970 });
    const sibling = mkPerson('sib', {
      sab: 'm',
      gender: 'man',
      conds: [{ id: 'brca', onset: 50, prov: 'record' }],
    });
    const record: FamilyRecord = {
      people: [gp1, gp2, root, sibling],
      unions: [{ parents: ['gp1', 'gp2'], children: ['p6', 'sib'] }],
      timeline: [],
      probandId: 'p6',
    };
    const ics = buildIcsCalendar(record, 'p6', { now: NOW, asOfYear: ASOF });
    expect(ics).not.toMatch(/\.prostate\.\d+@stemma\.local/);
    expect(ics).not.toMatch(/\.brcapanel\.\d+@stemma\.local/);
    // Sanity: some VEVENT is still present (organ-agnostic cadences), so the test isn't vacuous.
    expect(ics).toContain('BEGIN:VEVENT');
  });
});

describe('buildIcsCalendar — UID identity', () => {
  const root = mkPerson('p9', { birth: 1982, organs: ['breasts'] });

  it('is stable across two identical calls, and changes when the underlying nextDueYear changes', () => {
    const recordA = mkRecord([root], [mkScreeningEvent('p9', 2019, 'mammogram')]);
    const icsA1 = buildIcsCalendar(recordA, 'p9', { now: NOW, asOfYear: ASOF });
    const icsA2 = buildIcsCalendar(recordA, 'p9', { now: NOW, asOfYear: ASOF });
    expect(icsA1).toContain('UID:p9.mammogram.2021@stemma.local');
    expect(icsA2).toContain('UID:p9.mammogram.2021@stemma.local');

    // Move the completion a year later — nextDueYear (and so the UID) must shift with it.
    const recordB = mkRecord([root], [mkScreeningEvent('p9', 2020, 'mammogram')]);
    const icsB = buildIcsCalendar(recordB, 'p9', { now: NOW, asOfYear: ASOF });
    expect(icsB).toContain('UID:p9.mammogram.2022@stemma.local');
    expect(icsB).not.toContain('UID:p9.mammogram.2021@stemma.local');
  });
});

describe('buildIcsCalendar — text escaping', () => {
  it('escapes a comma, semicolon, backslash and newline in a person name within SUMMARY', () => {
    // Raw name contains one each of the four RFC 5545 §3.3.11 reserved constructs.
    const trickyName = 'A,B;C\\D\nE';
    const root = mkPerson('p10', { name: trickyName, birth: 1982, organs: ['breasts'] });
    const record = mkRecord([root], [mkScreeningEvent('p10', 2019, 'mammogram')]);
    const ics = buildIcsCalendar(record, 'p10', { now: NOW, asOfYear: ASOF });
    const lines = unfoldLines(ics);

    // Order matters (backslash escaped first, per icsText): A\,B\;C\\D\nE
    const expectedEscapedName = 'A\\,B\\;C\\\\D\\nE';
    expect(lines).toContain(`SUMMARY:Screening due: Mammogram — ${expectedEscapedName}`);
  });
});
