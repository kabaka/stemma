/**
 * Screening recommendations and external-calculator signals.
 *
 * Screening is keyed off the *organ inventory*, not gender — a trans woman may still
 * need prostate screening, a trans man cervical screening (roadmap §5). Family-history
 * signal escalates a routine screen to "recommended". Calculators point at validated
 * external tools (CanRisk, PREMM5, ASCVD) rather than manufacturing a number.
 */
import type { FamilyRecord, Organ } from './types';
import { condIds, organsOf } from './person';
import { indexPeople, personById, relationInfo } from './graph';

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
}

export const SCREENING_DEFS: readonly ScreeningDef[] = [
  {
    id: 'mammogram',
    name: 'Mammogram',
    organ: 'breasts',
    flags: ['brca'],
    base: 'Annual from 40',
    why: 'Breast tissue present',
  },
  {
    id: 'cervical',
    name: 'Cervical screening (Pap/HPV)',
    organ: 'cervix',
    flags: [],
    base: 'Every 3–5 yrs, 21–65',
    why: 'Cervix present',
  },
  {
    id: 'prostate',
    name: 'Prostate (PSA) discussion',
    organ: 'prostate',
    flags: [],
    base: 'Discuss from 50',
    why: 'Prostate present',
  },
  {
    id: 'colonoscopy',
    name: 'Colonoscopy',
    organ: null,
    flags: ['colon'],
    base: 'From 45, every 10 yrs',
    why: 'Recommended for all adults',
  },
  {
    id: 'lipids',
    name: 'Lipid panel',
    organ: null,
    flags: ['cad', 'chol', 'stroke'],
    base: 'Every 4–6 yrs',
    why: 'Cardiometabolic baseline',
  },
  {
    id: 'hba1c',
    name: 'HbA1c',
    organ: null,
    flags: ['t2d'],
    base: 'Per risk profile',
    why: 'Diabetes screening',
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
    when: ['colon', 'endometrial', 'gastric'],
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
