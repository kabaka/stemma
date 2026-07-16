import { describe, expect, it } from 'vitest';
import { seedRecord } from '@/data/seed';
import type { FamilyRecord, Person, TimelineEvent } from './types';
import { calculatorsFor, dueCount, familySignal, scheduleFor, screeningsFor } from './screening';

/** Minimal fixture person for the precise ages/onset scheduleFor's edges need. */
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
/** A `type: 'screening'` timeline event, optionally linked via `screeningId`. */
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

describe('screeningsFor', () => {
  const forMaya = screeningsFor(seedRecord(), 'you');
  const names = forMaya.map((s) => s.name);

  it('recommends a mammogram given breast tissue + family breast-cancer signal', () => {
    const mammogram = forMaya.find((s) => s.id === 'mammogram');
    expect(mammogram).toBeDefined();
    expect(mammogram!.status).toBe('Recommended');
    expect(mammogram!.why).toMatch(/family history/);
  });

  it('offers cervical screening (cervix present) but not prostate (no prostate)', () => {
    expect(names).toContain('Cervical screening (Pap/HPV)');
    expect(names).not.toContain('Prostate (PSA) discussion');
  });

  it('refers the BRCA panel when there is a hereditary-cancer signal', () => {
    const panel = forMaya.find((s) => s.id === 'brcapanel');
    expect(panel).toBeDefined();
    expect(panel!.status).toBe('Referred');
  });

  it('keys screening off the organ inventory, not gender', () => {
    // Ray is gender man, AFAB, with an explicit organ inventory (ovaries/uterus/cervix,
    // no breasts). He should be offered cervical screening but never a mammogram.
    const forRay = screeningsFor(seedRecord(), 'ray').map((s) => s.name);
    expect(forRay).toContain('Cervical screening (Pap/HPV)');
    expect(forRay).not.toContain('Mammogram');
    expect(forRay).not.toContain('Prostate (PSA) discussion');
  });

  it('counts screenings that need action', () => {
    expect(dueCount(forMaya)).toBeGreaterThan(0);
  });

  it('escalates the prostate PSA discussion on a family prostate-cancer signal', () => {
    // Robert (sab m) has a prostate; his brother Tom is a first-degree blood relative.
    // Giving Tom prostate cancer should escalate Robert's PSA discussion to Recommended.
    const record = seedRecord();
    record.people
      .find((p) => p.id === 'tom')!
      .conds.push({ id: 'prostate', onset: 62, prov: 'self' });
    const psa = screeningsFor(record, 'robert').find((s) => s.id === 'prostate');
    expect(psa).toBeDefined();
    expect(psa!.status).toBe('Recommended');
    expect(psa!.why).toMatch(/family history/);
  });

  it('leaves the prostate PSA discussion routine without a family signal', () => {
    // Robert has a prostate but (in the unmodified seed) no prostate-cancer/BRCA signal
    // among his blood relatives, so the screen stays routine.
    const psa = screeningsFor(seedRecord(), 'robert').find((s) => s.id === 'prostate');
    expect(psa).toBeDefined();
    expect(psa!.status).toBe('Routine');
  });
});

describe('familySignal', () => {
  it('collects condition codes across blood relatives', () => {
    const signal = familySignal(seedRecord(), 'you');
    expect(signal.has('brca')).toBe(true);
    expect(signal.has('t2d')).toBe(true);
  });
});

describe('calculatorsFor', () => {
  it('surfaces validated external models seeded by the family history', () => {
    const calcs = calculatorsFor(seedRecord(), 'you');
    const names = calcs.map((c) => c.name);
    expect(names).toContain('CanRisk / BOADICEA');
    expect(calcs[0].summary).toMatch(/affected relative/);
  });
});

describe('scheduleFor', () => {
  // Fixed as-of year throughout — never the wall clock (seed convention: 2026).
  const ASOF = 2026;

  it('reports overdue with the FIRST missed year — never rolled forward through multiple missed intervals', () => {
    const root = mkPerson('p1', { birth: 1970 }); // age 56 in 2026, well within mammogram's 40–74.
    const record = mkRecord([root], [mkScreeningEvent('p1', 2010, 'mammogram')]);
    const mammogram = scheduleFor(record, 'p1', ASOF).find((s) => s.id === 'mammogram')!;
    expect(mammogram.lastDoneYear).toBe(2010);
    // 2-year interval: the first missed due date is 2012, not rolled forward to a recent year.
    expect(mammogram.nextDueYear).toBe(2012);
    expect(mammogram.scheduleStatus).toBe('overdue');
  });

  it('reports due when the next interval lands exactly on asOfYear', () => {
    const root = mkPerson('p2', { sab: 'u', birth: 1970 }); // colonoscopy is organ-agnostic.
    const record = mkRecord([root], [mkScreeningEvent('p2', 2016, 'colonoscopy')]);
    const colonoscopy = scheduleFor(record, 'p2', ASOF).find((s) => s.id === 'colonoscopy')!;
    expect(colonoscopy.nextDueYear).toBe(2026);
    expect(colonoscopy.scheduleStatus).toBe('due');
  });

  it('reports upToDate when the last completion is still inside the interval', () => {
    const root = mkPerson('p3', { sab: 'u', birth: 1970 });
    const record = mkRecord([root], [mkScreeningEvent('p3', 2023, 'lipids')]);
    const lipids = scheduleFor(record, 'p3', ASOF).find((s) => s.id === 'lipids')!;
    expect(lipids.lastDoneYear).toBe(2023);
    expect(lipids.nextDueYear).toBe(2028); // 2023 + 5yr interval, still ahead of 2026.
    expect(lipids.scheduleStatus).toBe('upToDate');
  });

  it('reports notYet with the first-eligible due date when the root is younger than startAge', () => {
    const root = mkPerson('p4', { sab: 'u', birth: 2000 }); // age 26 in 2026; hba1c starts at 35.
    const record = mkRecord([root]);
    const hba1c = scheduleFor(record, 'p4', ASOF).find((s) => s.id === 'hba1c')!;
    expect(hba1c.scheduleStatus).toBe('notYet');
    expect(hba1c.nextDueYear).toBe(2035); // birth (2000) + startAge (35).
    expect(hba1c.lastDoneYear).toBeNull();
  });

  it('marks a screen upToDate with no further due date once the root has aged past stopAge', () => {
    const root = mkPerson('p5', { birth: 1945 }); // age 81 in 2026; mammogram stops at 74.
    const record = mkRecord([root]);
    const mammogram = scheduleFor(record, 'p5', ASOF).find((s) => s.id === 'mammogram')!;
    expect(mammogram.scheduleStatus).toBe('upToDate');
    expect(mammogram.nextDueYear).toBeNull();
  });

  it('excludes defs without a cadence (prostate, brcapanel) even though they are otherwise applicable', () => {
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
    // Sanity: screeningsFor DOES surface both (uncadenced) screens for this root.
    const plain = screeningsFor(record, 'p6').map((s) => s.id);
    expect(plain).toContain('prostate');
    expect(plain).toContain('brcapanel');

    const scheduled = scheduleFor(record, 'p6', ASOF).map((s) => s.id);
    expect(scheduled).not.toContain('prostate');
    expect(scheduled).not.toContain('brcapanel');
  });

  it('excludes a root with no known birth year from the schedule entirely', () => {
    const root = mkPerson('p7', { birth: null });
    const record = mkRecord([root]);
    expect(scheduleFor(record, 'p7', ASOF)).toEqual([]);
  });

  it('does not treat an unlinked legacy screening event as done — falls back to the birth+startAge due date', () => {
    const root = mkPerson('p8', { birth: 1970 }); // age 56 in 2026.
    const legacyEvent: TimelineEvent = {
      id: 'legacy-1',
      person: 'p8',
      year: 2020,
      type: 'screening',
      title: 'Mammogram (free-text, pre-linking)',
      detail: '',
      // No screeningId — predates the link; types.ts documents this stays valid but unlinked.
    };
    const record = mkRecord([root], [legacyEvent]);
    const mammogram = scheduleFor(record, 'p8', ASOF).find((s) => s.id === 'mammogram')!;
    expect(mammogram.lastDoneYear).toBeNull();
    expect(mammogram.nextDueYear).toBe(2010); // birth (1970) + startAge (40) — never "done".
    expect(mammogram.scheduleStatus).toBe('overdue');
  });

  it('applies the cervical youngerBand interval (3yr) below age 30, and the standard interval (5yr) at/after 30', () => {
    const young = mkPerson('py', { birth: 2000 }); // age 26 in 2026.
    const recordYoung = mkRecord([young], [mkScreeningEvent('py', 2023, 'cervical')]);
    const cervicalYoung = scheduleFor(recordYoung, 'py', ASOF).find((s) => s.id === 'cervical')!;
    expect(cervicalYoung.nextDueYear).toBe(2026); // 2023 + 3yr youngerBand interval.

    const older = mkPerson('po', { birth: 1985 }); // age 41 in 2026.
    const recordOlder = mkRecord([older], [mkScreeningEvent('po', 2023, 'cervical')]);
    const cervicalOlder = scheduleFor(recordOlder, 'po', ASOF).find((s) => s.id === 'cervical')!;
    expect(cervicalOlder.nextDueYear).toBe(2028); // 2023 + standard 5yr interval.
  });

  it('returns no schedule entries for a deceased root, even with an organ and cadence that would otherwise qualify', () => {
    // AFAB with breasts, well within mammogram's 40-74 window and with a lapsed lipids
    // interval too — if `dead` weren't checked first this root would otherwise yield
    // several overdue/due entries. A schedule projects *future* dates; the deceased have none.
    const root = mkPerson('deceased1', {
      birth: 1970, // age 56 in 2026.
      dead: true,
      death: 2020,
      organs: ['breasts'],
    });
    const record = mkRecord([root]);
    expect(scheduleFor(record, 'deceased1', ASOF)).toEqual([]);
  });

  it('keys off the organ inventory: no cervix means no cervical entry, no breasts means no mammogram entry', () => {
    // Ray-pattern (see seed.ts): sab f, but an explicit organ inventory without breasts.
    const ray = mkPerson('pray', {
      sab: 'f',
      gender: 'man',
      organs: ['ovaries', 'uterus', 'cervix'],
      birth: 1994,
    });
    const record = mkRecord([ray]);
    const ids = scheduleFor(record, 'pray', ASOF).map((s) => s.id);
    expect(ids).toContain('cervical');
    expect(ids).not.toContain('mammogram');
  });
});
