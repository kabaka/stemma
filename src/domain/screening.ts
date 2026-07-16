/**
 * Screening recommendations and external-calculator signals.
 *
 * Screening is keyed off the *organ inventory*, not gender — a trans woman may still
 * need prostate screening, a trans man cervical screening (roadmap §5). Family-history
 * signal escalates a routine screen to "recommended". Calculators point at validated
 * external tools (CanRisk, PREMM5, ASCVD) rather than manufacturing a number.
 */
import type { FamilyRecord, Organ } from './types';
import { ageOf, condIds, organsOf } from './person';
import { indexPeople, personById, relationInfo } from './graph';

/**
 * Guideline-sourced recurrence for an age-bound screen. Present only on the recurring,
 * age-anchored defs; discussion-based (PSA) and one-time criteria-gated (BRCA panel)
 * screens deliberately carry none, so nothing schedules them (guardrail #2).
 */
export interface ScreeningCadence {
  /** Age at which the screen begins. */
  startAge: number;
  /** Age past which the screen stops; absent = no upper bound. */
  stopAge?: number;
  /** Years between screens. `0` = one-time (does not repeat once done). */
  intervalYears: number;
  /** Optional younger-age band with a different interval (cervical 21–29). Used when age < untilAge. */
  youngerBand?: { untilAge: number; intervalYears: number };
}

export interface ScreeningDef {
  id: string;
  name: string;
  /** Organ that must be present, or `null` for everyone. */
  organ: Organ | null;
  /** Condition codes whose presence in the family escalates this screen. */
  flags: string[];
  /** Baseline cadence text. */
  base: string;
  /** Why this screen applies. */
  why: string;
  /** Genetic testing — only surfaced when there is a family signal. */
  genetic?: boolean;
  /**
   * Guideline-sourced recurrence, when this screen is a recurring, age-bound test.
   * Absent for discussion-based (PSA) and one-time criteria-gated (BRCA) screens, which
   * are intentionally never turned into a scheduled item.
   */
  cadence?: ScreeningCadence;
}

export const SCREENING_DEFS: readonly ScreeningDef[] = [
  {
    id: 'mammogram',
    name: 'Mammogram',
    organ: 'breasts',
    flags: ['brca'],
    base: 'From 40; annual (ACS/ACR) or biennial (USPSTF)',
    why: 'Breast tissue present',
    // USPSTF 2024: biennial mammography, ages 40–74.
    cadence: { startAge: 40, stopAge: 74, intervalYears: 2 },
  },
  {
    id: 'cervical',
    name: 'Cervical screening (Pap/HPV)',
    organ: 'cervix',
    flags: [],
    base: 'Every 3–5 yrs, 21–65',
    why: 'Cervix present',
    // USPSTF 2018: cytology every 3 yrs (21–29), every 5 yrs (30–65).
    cadence: {
      startAge: 21,
      stopAge: 65,
      intervalYears: 5,
      youngerBand: { untilAge: 30, intervalYears: 3 },
    },
  },
  {
    id: 'prostate',
    name: 'Prostate (PSA) discussion',
    organ: 'prostate',
    flags: ['prostate', 'brca'],
    base: 'Discuss 55–69 (earlier with family history)',
    why: 'Prostate present',
    // No cadence: PSA is a shared-decision *discussion*, not a scheduled test. Attaching
    // an interval would convert a shared decision into a directive (guardrail #2).
  },
  {
    id: 'colonoscopy',
    name: 'Colonoscopy',
    organ: null,
    flags: ['colon'],
    base: 'From 45, every 10 yrs',
    why: 'Recommended for all adults',
    // USPSTF 2021: colorectal screening, ages 45–75 (colonoscopy every 10 yrs).
    cadence: { startAge: 45, stopAge: 75, intervalYears: 10 },
  },
  {
    id: 'lipids',
    name: 'Lipid panel',
    organ: null,
    flags: ['cad', 'chol', 'stroke'],
    base: 'Every 4–6 yrs',
    why: 'Cardiometabolic baseline',
    // ACC/AHA: lipid assessment from age 20, roughly every 5 yrs; no upper bound.
    cadence: { startAge: 20, intervalYears: 5 },
  },
  {
    id: 'hba1c',
    name: 'HbA1c',
    organ: null,
    flags: ['t2d'],
    base: 'Per risk profile',
    why: 'Diabetes screening',
    // USPSTF 2021: prediabetes/type-2-diabetes screening, ages 35–70, ~every 3 yrs.
    cadence: { startAge: 35, stopAge: 70, intervalYears: 3 },
  },
  {
    id: 'brcapanel',
    name: 'BRCA1/2 genetic panel',
    organ: null,
    flags: ['brca', 'ovarian'],
    base: 'One-time if criteria met',
    why: 'Hereditary-cancer testing',
    genetic: true,
  },
];

export type ScreeningStatus = 'Referred' | 'Recommended' | 'Routine';

export interface Screening {
  id: string;
  name: string;
  why: string;
  freq: string;
  status: ScreeningStatus;
}

/** Set of condition codes carried by `rootId`'s blood relatives. */
export function familySignal(record: FamilyRecord, rootId: string): Set<string> {
  const idx = indexPeople(record.people, record.unions);
  const signal = new Set<string>();
  for (const p of record.people) {
    if (p.id === rootId) continue;
    if (relationInfo(idx, p.id, rootId).degree) for (const c of condIds(p)) signal.add(c);
  }
  return signal;
}

/** Screenings applicable to `rootId`, escalated by family history. */
export function screeningsFor(record: FamilyRecord, rootId: string): Screening[] {
  const idx = indexPeople(record.people, record.unions);
  const root = personById(idx, rootId);
  if (!root) return [];
  const organs = organsOf(root);
  const signalSet = familySignal(record, rootId);

  return SCREENING_DEFS.filter(
    (d) =>
      (d.organ === null || organs.includes(d.organ)) &&
      !(d.genetic && !d.flags.some((c) => signalSet.has(c))),
  ).map((d) => {
    const signal = d.flags.some((c) => signalSet.has(c));
    let status: ScreeningStatus;
    if (d.genetic) status = 'Referred';
    else if (signal) status = 'Recommended';
    else status = 'Routine';
    return {
      id: d.id,
      name: d.name,
      why: d.why + (signal ? ' · family history' : ''),
      freq: d.base,
      status,
    };
  });
}

/** Count of screenings that need action (recommended or referred). */
export function dueCount(screenings: Screening[]): number {
  return screenings.filter((s) => s.status === 'Recommended' || s.status === 'Referred').length;
}

/** Where a schedulable screen sits against its guideline cadence, as of a given year. */
export type ScheduleStatus = 'overdue' | 'due' | 'upToDate' | 'notYet';

/** A {@link Screening} with its guideline-cadence timing resolved as of a given year. */
export interface ScheduledScreening extends Screening {
  scheduleStatus: ScheduleStatus;
  /** First year the screen is next due; `null` = one-time done, or aged past `stopAge`. */
  nextDueYear: number | null;
  /** Most recent linked completion year, or `null` if never recorded. */
  lastDoneYear: number | null;
}

/**
 * Resolve each applicable, schedulable screen against its guideline cadence as of
 * `asOfYear`. Composes over {@link screeningsFor} — organ/family-signal filtering (and
 * guardrail #4, screening-off-organs-not-gender) is reused, never re-derived. Only defs
 * with a {@link ScreeningCadence} and a root with a known birth year are schedulable;
 * everything else still appears in plain `screeningsFor` but is omitted here.
 *
 * Pure and deterministic: `asOfYear` is injected; no wall clock is read. A missed date is
 * reported as the *first* missed year — the cadence is not rolled forward through multiple
 * intervals, so "overdue since 2019" stays honest.
 */
export function scheduleFor(
  record: FamilyRecord,
  rootId: string,
  asOfYear: number,
): ScheduledScreening[] {
  const idx = indexPeople(record.people, record.unions);
  const root = personById(idx, rootId);
  if (!root) return [];
  // A schedule projects *future* screening dates; the deceased have none. `screeningsFor`
  // still lists a dead relative's applicable screens (a historical/vantage view), but
  // computing a "next due / may be due this year" for them would produce nonsensical,
  // insensitive calendar reminders — so no schedule is derived for a deceased root.
  if (root.dead) return [];
  const defById = new Map(SCREENING_DEFS.map((d) => [d.id, d]));

  const out: ScheduledScreening[] = [];
  for (const s of screeningsFor(record, rootId)) {
    const def = defById.get(s.id);
    if (!def?.cadence || root.birth == null) continue;
    const cadence = def.cadence;
    const age = ageOf(root, asOfYear);
    if (age == null) continue; // birth is non-null above; this narrows the type.

    const dones = record.timeline
      .filter((e) => e.person === rootId && e.type === 'screening' && e.screeningId === def.id)
      .map((e) => e.year);
    const lastDoneYear = dones.length ? Math.max(...dones) : null;

    const { startAge, stopAge, intervalYears, youngerBand } = cadence;
    let nextDueYear: number | null;
    let scheduleStatus: ScheduleStatus;

    if (age < startAge) {
      scheduleStatus = 'notYet';
      nextDueYear = root.birth + startAge;
    } else if (stopAge != null && age > stopAge) {
      scheduleStatus = 'upToDate';
      nextDueYear = null; // aged out.
    } else {
      const iv =
        youngerBand && age < youngerBand.untilAge ? youngerBand.intervalYears : intervalYears;
      if (lastDoneYear != null && iv === 0) {
        scheduleStatus = 'upToDate'; // one-time screen already completed.
        nextDueYear = null;
      } else {
        nextDueYear = lastDoneYear != null ? lastDoneYear + iv : root.birth + startAge;
        if (nextDueYear < asOfYear) scheduleStatus = 'overdue';
        else if (nextDueYear === asOfYear) scheduleStatus = 'due';
        else scheduleStatus = 'upToDate';
      }
    }

    out.push({ ...s, scheduleStatus, nextDueYear, lastDoneYear });
  }
  return out;
}

export interface CalculatorDef {
  name: string;
  domain: string;
  /** Condition codes that seed this model. */
  when: string[];
  desc: string;
  note: string;
}

export const CALCULATOR_DEFS: readonly CalculatorDef[] = [
  {
    name: 'CanRisk / BOADICEA',
    domain: 'Breast & ovarian',
    when: ['brca', 'ovarian'],
    desc: 'Validated breast/ovarian risk from pedigree, hormonal and genetic inputs.',
    note: 'External hosted tool (canrisk.org) — requires a licensed web-services key; not wired into the static build.',
  },
  {
    name: 'PREMM5 / Amsterdam II',
    domain: 'Colorectal (Lynch)',
    when: ['colon', 'endometrial', 'gastric', 'ovarian', 'utuc'],
    desc: 'Estimates the likelihood of a Lynch-syndrome mismatch-repair mutation.',
    note: 'External hosted tool — not wired into the static build.',
  },
  {
    name: 'ASCVD / FH criteria',
    domain: 'Cardiovascular',
    when: ['cad', 'chol', 'stroke'],
    desc: '10-year cardiovascular risk and familial-hypercholesterolemia screening.',
    note: 'External calculator — not wired into the static build.',
  },
];

export interface Calculator {
  name: string;
  domain: string;
  desc: string;
  note: string;
  summary: string;
}

/** External calculators whose seeding conditions appear in the family. */
export function calculatorsFor(record: FamilyRecord, rootId: string): Calculator[] {
  const idx = indexPeople(record.people, record.unions);
  const bloodWith = (code: string): number =>
    record.people.filter(
      (p) => p.id !== rootId && relationInfo(idx, p.id, rootId).degree && condIds(p).includes(code),
    ).length;
  const familyCodes = familySignal(record, rootId);

  return CALCULATOR_DEFS.filter((c) => c.when.some((code) => familyCodes.has(code))).map((c) => {
    const n = c.when.reduce((s, code) => s + bloodWith(code), 0);
    return {
      name: c.name,
      domain: c.domain,
      desc: c.desc,
      note: c.note,
      summary: `${n} affected relative${n === 1 ? '' : 's'} would seed this model`,
    };
  });
}
