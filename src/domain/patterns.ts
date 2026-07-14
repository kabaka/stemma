/**
 * The hereditary-pattern engine — Stemma's core value.
 *
 * Rather than manufacturing a relative-risk multiplier (the prototype's earlier
 * approach, retired for the reasons in roadmap §2), this detects published red-flag
 * patterns and states the specific criterion met, e.g. "meets common criteria to
 * discuss BRCA1/2 testing." Everything here is deterministic and pure so it can be
 * unit-tested against known pedigrees — see `patterns.test.ts`.
 *
 * NOTE: These heuristics are decision-support signals, not a diagnosis. See
 * `docs/ARCHITECTURE.md` for the clinical-boundary rationale.
 */
import type { CategoryKey, Condition, Person } from './types';
import { condEntry, condIds, hasCond, sabOf } from './person';
import { indexPeople, personById, relationInfo, type Degree, type RelationInfo } from './graph';
import type { Catalog } from './catalog';
import type { FamilyRecord } from './types';
import { RECS } from '@/data/recommendations';

export type Severity = 'referral' | 'discuss' | 'note';

export interface AffectedRelative {
  person: Person;
  degree: Degree;
  side: string;
  rel: string;
  onset: number | null;
}

export interface PatternFlag {
  severity: Severity;
  cat: CategoryKey | null;
  title: string;
  /** The specific criterion met, cited in reports. */
  criterion: string;
  /** What to do about it — advisory, never diagnostic. */
  rec: string;
  relatives: AffectedRelative[];
}

export const SEVERITY_META: Record<Severity, { color: string; bg: string; label: string }> = {
  referral: { color: '#ff5d5d', bg: 'rgba(255,93,93,0.14)', label: 'Referral criteria' },
  discuss: { color: '#ffb043', bg: 'rgba(255,176,67,0.14)', label: 'Discuss with clinician' },
  note: { color: '#8b94a3', bg: 'rgba(255,255,255,0.05)', label: 'Note' },
};

const SEVERITY_RANK: Record<Severity, number> = { referral: 0, discuss: 1, note: 2 };

/** Relationship of every person to `rootId`, keyed by person id. */
export function relationMap(record: FamilyRecord, rootId: string): Map<string, RelationInfo> {
  const idx = indexPeople(record.people, record.unions);
  const info = new Map<string, RelationInfo>();
  for (const p of record.people) info.set(p.id, relationInfo(idx, p.id, rootId));
  return info;
}

/**
 * Detect published hereditary red-flag patterns from `rootId`'s vantage. Returns
 * flags sorted most-actionable first (referral → discuss → note).
 */
export function detectPatterns(
  record: FamilyRecord,
  catalog: Catalog,
  rootId: string,
  asOfYear: number,
): PatternFlag[] {
  const idx = indexPeople(record.people, record.unions);
  const rootP = personById(idx, rootId);
  if (!rootP) return [];
  const info = relationMap(record, rootId);
  const rootIsProband = rootP.isProband === true;
  const rootAge = rootP.dead ? null : rootP.birth != null ? asOfYear - rootP.birth : null;

  const blood = record.people.filter((p) => p.id !== rootId && info.get(p.id)?.degree);
  const withCond = (code: string): AffectedRelative[] =>
    blood
      .filter((p) => hasCond(p, code))
      .map((p) => {
        const ri = info.get(p.id)!;
        return {
          person: p,
          degree: ri.degree,
          side: ri.side,
          rel: ri.rel,
          onset: condEntry(p, code)?.onset ?? null,
        };
      });

  const flags: PatternFlag[] = [];

  // --- Hereditary breast & ovarian cancer (HBOC) ---
  {
    const breast = withCond('brca');
    const ovarian = withCond('ovarian');
    const reasons: string[] = [];
    if (breast.length >= 2) reasons.push(`${breast.length} relatives with breast cancer`);
    if (ovarian.length >= 1) reasons.push('ovarian cancer in a blood relative');
    const young = breast.filter((b) => b.onset != null && b.onset < 50);
    if (young.length)
      reasons.push(
        `breast cancer before age 50 (${young.map((y) => `${y.rel} at ${y.onset}`).join(', ')})`,
      );
    if (reasons.length)
      flags.push({
        severity: 'referral',
        cat: 'canc',
        title: 'Hereditary breast & ovarian cancer (HBOC) pattern',
        criterion: reasons.join('; '),
        rec: 'Meets common criteria to discuss BRCA1/2 testing and a validated risk model (BOADICEA / CanRisk). Consider a genetics referral; enhanced breast screening (annual mammography ± MRI) may be indicated.',
        relatives: [...breast, ...ovarian],
      });
  }

  // --- Lynch syndrome (hereditary colorectal) ---
  {
    const colo = withCond('colon');
    const endo = withCond('endometrial');
    const gast = withCond('gastric');
    const spectrum = [...colo, ...endo, ...gast];
    const reasons: string[] = [];
    const young = colo.filter((c) => c.onset != null && c.onset < 50);
    if (young.length)
      reasons.push(
        `colorectal cancer before age 50 (${young.map((y) => `${y.rel} at ${y.onset}`).join(', ')})`,
      );
    if (spectrum.length >= 2)
      reasons.push(
        `${spectrum.length} relatives with Lynch-spectrum cancers (colorectal / endometrial / gastric)`,
      );
    if (reasons.length)
      flags.push({
        severity: 'referral',
        cat: 'canc',
        title: 'Lynch syndrome pattern (hereditary colorectal)',
        criterion: reasons.join('; '),
        rec: 'Consistent with Amsterdam II-type criteria. Consider a genetics referral and earlier, more frequent colonoscopy (often from age 20–25, or 10 years before the earliest family diagnosis).',
        relatives: spectrum,
      });
  }

  // --- Premature cardiovascular disease ---
  {
    const cad = withCond('cad');
    const chol = withCond('chol');
    const premature = cad.filter(
      (c) =>
        c.degree === 1 &&
        c.onset != null &&
        ((sabOf(c.person) === 'm' && c.onset < 55) || (sabOf(c.person) === 'f' && c.onset < 65)),
    );
    const reasons: string[] = [];
    if (premature.length)
      reasons.push(
        `premature coronary disease in a first-degree relative (${premature.map((y) => `${y.rel} at ${y.onset}`).join(', ')})`,
      );
    if (chol.length && cad.length)
      reasons.push('high cholesterol clustering with coronary disease');
    if (reasons.length)
      flags.push({
        severity: premature.length ? 'referral' : 'discuss',
        cat: 'card',
        title: 'Premature cardiovascular disease',
        criterion: reasons.join('; '),
        rec: 'Early lipid screening and ASCVD assessment advised; evaluate for familial hypercholesterolemia (FH). Discuss timing with your clinician.',
        relatives: [...cad, ...chol],
      });
  }

  // --- Generic autosomal-dominant vertical transmission ---
  {
    const covered = new Set(['brca', 'ovarian', 'colon', 'endometrial', 'gastric', 'cad', 'chol']);
    const present = new Set<string>();
    for (const p of blood) for (const c of condIds(p)) present.add(c);
    for (const code of present) {
      if (covered.has(code)) continue;
      const meta = catalog.get(code);
      if (!/dominant/i.test(meta.pattern ?? '')) continue;
      const aff = withCond(code);
      if (!aff.length) continue;
      const gens = new Set(aff.map((a) => a.person.gen));
      const firstDeg = aff.some((a) => a.degree === 1);
      if (gens.size >= 2 || firstDeg)
        flags.push({
          severity: firstDeg ? 'referral' : 'discuss',
          cat: meta.cat,
          title: `Autosomal-dominant pattern — ${meta.name}`,
          criterion: `${aff.length} affected relative${aff.length === 1 ? '' : 's'}${gens.size >= 2 ? ` across ${gens.size} generations` : ''}; ${meta.name} shows dominant inheritance`,
          rec: 'Vertical transmission consistent with autosomal-dominant inheritance. Predictive genetic testing and counseling may be appropriate — consider a genetics referral.',
          relatives: aff,
        });
    }
  }

  // --- Age-of-onset proximity alerts ---
  if (rootAge != null) {
    const present = new Set<string>();
    for (const p of blood) for (const c of condIds(p)) present.add(c);
    const prox: PatternFlag[] = [];
    for (const code of present) {
      if (hasCond(rootP, code)) continue;
      const aff = withCond(code).filter((a) => a.onset != null);
      if (!aff.length) continue;
      const earliest = Math.min(...aff.map((a) => a.onset as number));
      if (rootAge >= earliest - 12 && rootAge <= earliest + 5) {
        const who = aff.find((a) => a.onset === earliest)!;
        const meta = catalog.get(code);
        prox.push({
          severity: 'discuss',
          cat: meta.cat,
          title: `Age-of-onset alert — ${meta.name}`,
          criterion: `${who.rel} diagnosed at ${earliest}; ${rootIsProband ? 'you are' : `${rootP.name} is`} ${rootAge}`,
          rec: 'You are approaching the age at which this first appeared in your family. A timely screening conversation is reasonable.',
          relatives: aff,
        });
      }
    }
    for (const f of prox.slice(0, 3)) flags.push(f);
  }

  // --- Limited family history caveat ---
  if (blood.length < 4)
    flags.push({
      severity: 'note',
      cat: null,
      title: 'Limited family history',
      criterion: `only ${blood.length} blood relative${blood.length === 1 ? '' : 's'} on record`,
      rec: 'A small or incomplete pedigree is not reassurance — absence of disease may simply reflect missing information. Add relatives to sharpen the analysis.',
      relatives: [],
    });

  flags.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return flags;
}

// ---------------------------------------------------------------------------
// Per-condition family findings (the "Family Patterns" table)
// ---------------------------------------------------------------------------

export type FindingBand = 'Diagnosed' | 'Clustered' | 'Close family' | 'In family' | '—';

export interface FindingAffected {
  rel: string;
  deg: string;
}

export interface FamilyFinding {
  id: string;
  name: string;
  cat: CategoryKey;
  pattern: string;
  rec: string;
  diagnosed: boolean;
  band: FindingBand;
  affCount: number;
  affected: FindingAffected[];
  earliest: number | null;
}

function genericRec(band: FindingBand): string {
  if (band === 'Diagnosed')
    return 'Already diagnosed — focus on ongoing management and monitoring with your care team.';
  if (band === 'Clustered')
    return 'Multiple affected relatives — discuss earlier or more frequent screening and risk-reduction with your clinician.';
  if (band === 'Close family')
    return 'A first-degree relative is affected — raise this family history at your next visit.';
  if (band === 'In family') return 'A relative is affected — worth mentioning to your clinician.';
  return 'Continue routine, age-appropriate screening.';
}

const degShort = (d: Degree): string => (d === 1 ? '1st' : d === 2 ? '2nd' : d === 3 ? '3rd' : '—');

/** Per-condition summary across the family, ranked by clustering, from a vantage. */
export function familyFindings(
  record: FamilyRecord,
  catalog: Catalog,
  rootId: string,
): FamilyFinding[] {
  const idx = indexPeople(record.people, record.unions);
  const rootP = personById(idx, rootId);
  if (!rootP) return [];
  const info = relationMap(record, rootId);

  const present = new Set<string>();
  for (const p of record.people) for (const c of condIds(p)) present.add(c);
  for (const c of condIds(rootP)) present.add(c);

  const rows: FamilyFinding[] = [...present].map((id) => {
    const meta: Condition = catalog.get(id);
    const aff = record.people.filter(
      (p) => p.id !== rootId && (info.get(p.id)?.degree ?? 0) >= 1 && hasCond(p, id),
    );
    const onsets = aff.map((p) => condEntry(p, id)?.onset).filter((x): x is number => x != null);
    const earliest = onsets.length ? Math.min(...onsets) : null;
    const firstDeg = aff.some((p) => info.get(p.id)?.degree === 1);
    const diagnosed = hasCond(rootP, id);

    let band: FindingBand;
    if (diagnosed) band = 'Diagnosed';
    else if (aff.length >= 2) band = 'Clustered';
    else if (firstDeg) band = 'Close family';
    else if (aff.length >= 1) band = 'In family';
    else band = '—';

    const rec = RECS[id] ?? genericRec(band);
    const affected = aff
      .slice()
      .sort((a, b) => (info.get(a.id)?.degree ?? 0) - (info.get(b.id)?.degree ?? 0))
      .map((p) => ({ rel: info.get(p.id)!.rel, deg: degShort(info.get(p.id)!.degree) }));

    return {
      id,
      name: meta.name,
      cat: meta.cat,
      pattern: meta.pattern,
      rec,
      diagnosed,
      band,
      affCount: aff.length,
      affected,
      earliest,
    };
  });

  const rank = (r: FamilyFinding): number =>
    r.diagnosed
      ? 4
      : r.band === 'Clustered'
        ? 0
        : r.band === 'Close family'
          ? 1
          : r.band === 'In family'
            ? 2
            : 3;
  rows.sort((a, b) => rank(a) - rank(b) || b.affCount - a.affCount);
  return rows;
}
