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
import type { CategoryKey, Condition, Person, Provenance } from './types';
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
  /** Provenance of this relative's condition record — clinicians weight by source. */
  prov: Provenance;
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
        const e = condEntry(p, code);
        return {
          person: p,
          degree: ri.degree,
          side: ri.side,
          rel: ri.rel,
          onset: e?.onset ?? null,
          prov: e?.prov ?? 'self',
        };
      });

  const flags: PatternFlag[] = [];
  // Codes owned by a specific pattern block below; the generic autosomal-dominant
  // sweep skips them so a condition is never double-flagged. Each block registers what
  // it consumes, so adding a new specific pattern can't silently fall through here.
  const handled = new Set<string>();

  // --- Hereditary breast & ovarian cancer (HBOC) ---
  {
    const breast = withCond('brca');
    const ovarian = withCond('ovarian');
    const panc = withCond('panc');
    // Male breast cancer keys on sex-assigned-at-birth, never gender (guardrail #4:
    // genetics follows sab). It is a subset of the breast cases already gathered.
    const maleBreast = breast.filter((b) => sabOf(b.person) === 'm');
    handled.add('brca').add('ovarian').add('panc');
    // NCCN Genetic/Familial High-Risk Assessment (Breast/Ovarian/Pancreatic) criteria are
    // assessed PER LINEAGE: a BRCA1/2 variant descends through one side of the family, so
    // two breast cancers on *opposite* sides are two independent lineages, not one signal.
    // Ovarian (any age) and breast cancer < 50 stay side-independent referral triggers.
    const kM = breast.filter((b) => b.side === 'Maternal').length;
    const kP = breast.filter((b) => b.side === 'Paternal').length;
    // Full siblings and the proband's own children share BOTH parental lineages, so
    // relationInfo gives them side '—'. A shared first-degree relative can support either
    // lineage, but is ONE person — credit them to a single cluster, never double-booked
    // into both sides (that would overstate the family history the report cites).
    const fd = breast.filter((b) => b.side === '—' && b.degree === 1).length;

    const referralReasons: string[] = [];
    const discussReasons: string[] = [];
    const clusters: string[] = [];
    if (kM >= 2 && kP >= 2) {
      // Two genuinely independent clusters, each anchored by grandparent-lineage cases on
      // its own (no shared relative needed) — cite both.
      clusters.push(`${kM} breast cancers on the maternal lineage`);
      clusters.push(`${kP} breast cancers on the paternal lineage`);
    } else {
      // Otherwise report at most ONE lineage cluster, crediting the shared first-degree
      // relatives to the stronger anchored side (they can't seed two clusters at once).
      const maternalTally = kM + fd;
      const paternalTally = kP + fd;
      if (maternalTally >= 2 || paternalTally >= 2) {
        if (kM === 0 && kP === 0)
          // Pure first-degree cluster (e.g. two affected siblings): one lineage, no
          // maternal/paternal distinction to draw between them — still a referral.
          clusters.push(`${fd} first-degree relatives with breast cancer`);
        else {
          const side = maternalTally >= paternalTally ? 'maternal' : 'paternal';
          clusters.push(
            `${Math.max(maternalTally, paternalTally)} breast cancers on the ${side} lineage`,
          );
        }
      }
    }
    if (clusters.length) referralReasons.push(clusters.join('; '));
    else if (breast.length >= 2)
      // Two+ breast cancers that fall on different sides (or an undetermined side): keep the
      // signal (don't silently drop it) but downgrade to "discuss" — it doesn't point at one
      // hereditary lineage.
      discussReasons.push(
        'two or more breast cancers, but not clustered on one lineage (different sides of the family, or a side not determined)',
      );
    if (ovarian.length >= 1) referralReasons.push('ovarian cancer in a blood relative');
    // Pancreatic cancer and male breast cancer are each any-age, single-case,
    // side-independent testing indications (NCCN BOP). Guardrail #1: describe the family
    // finding (relative + onset) — never a probability, multiplier, or risk number. Use
    // `onset != null` so a recorded onset of 0 is preserved (not dropped by truthiness).
    if (panc.length >= 1)
      referralReasons.push(
        `pancreatic cancer in a blood relative (${panc.map((y) => `${y.rel}${y.onset != null ? ` at ${y.onset}` : ''}`).join(', ')})`,
      );
    if (maleBreast.length >= 1)
      referralReasons.push(
        `male breast cancer in a blood relative (${maleBreast.map((y) => `${y.rel}${y.onset != null ? ` at ${y.onset}` : ''}`).join(', ')})`,
      );
    const young = breast.filter((b) => b.onset != null && b.onset < 50);
    if (young.length)
      referralReasons.push(
        `breast cancer before age 50 (${young.map((y) => `${y.rel} at ${y.onset}`).join(', ')})`,
      );

    const reasons = [...referralReasons, ...discussReasons];
    if (reasons.length) {
      const isReferral = referralReasons.length > 0;
      flags.push({
        severity: isReferral ? 'referral' : 'discuss',
        cat: 'canc',
        title: 'Hereditary breast, ovarian & pancreatic cancer (HBOC/BRCA) pattern',
        criterion: reasons.join('; '),
        // Severity-aware wording (guardrail #1: never overstate). Only the referral path — a
        // cluster on one lineage, ovarian at any age, breast < 50, or pancreatic / male breast
        // at any age — may say criteria are met. The discuss path (two breast cancers split
        // across lineages, nothing else) specifically does NOT meet per-lineage NCCN testing
        // criteria, so it must not claim it does; it surfaces the finding and routes to a
        // clinician + validated model. Guardrail #2: the rec stays an advisory referral
        // prompt, and pancreatic surveillance is not overstated (specialist programs only).
        rec: isReferral
          ? 'Meets common criteria to discuss BRCA1/2 (and related genes, e.g. PALB2) genetic counseling/testing and a validated risk model (BOADICEA / CanRisk). Hereditary-cancer criteria are assessed per lineage; a single pancreatic or male-breast cancer at any age is a strong indication on its own to raise with a clinician — most strongly for a first-degree relative or when the affected relative can be tested. Consider a genetics referral; a clinician can advise on risk-appropriate screening. Pancreatic surveillance is offered only to confirmed high-risk individuals within specialist programs.'
          : 'Two or more breast cancers are present but not clustered on one lineage, so per-lineage BRCA1/2 testing criteria are not met. Still worth raising with a clinician, who can take a fuller history and run a validated risk model (Tyrer-Cuzick / CanRisk).',
        relatives: [...breast, ...ovarian, ...panc],
      });
    }
  }

  // --- Lynch syndrome (hereditary colorectal & spectrum) ---
  {
    const colo = withCond('colon');
    const endo = withCond('endometrial');
    const gast = withCond('gastric');
    const ovar = withCond('ovarian');
    const utuc = withCond('utuc');
    handled.add('colon').add('endometrial').add('gastric').add('ovarian').add('utuc');
    // Lynch/HNPCC spectrum per revised Bethesda (Umar 2004, PMID 14970275): colorectal,
    // endometrial, gastric, ovarian, and upper urinary tract (ureter / renal pelvis
    // urothelial) — NOT renal-cell (kidneyca) or bladder, which are not classically Lynch.
    // Ovarian is shared with the HBOC spectrum: one ovarian case legitimately seeds both
    // referrals (BRCA vs mismatch-repair are different genes), which genetics disambiguates.
    const spectrum = [...colo, ...endo, ...gast, ...ovar, ...utuc];
    const reasons: string[] = [];
    const young = colo.filter((c) => c.onset != null && c.onset < 50);
    if (young.length)
      reasons.push(
        `colorectal cancer before age 50 (${young.map((y) => `${y.rel} at ${y.onset}`).join(', ')})`,
      );
    if (spectrum.length >= 2)
      reasons.push(
        `${spectrum.length} relatives with Lynch-spectrum cancers (colorectal / endometrial / gastric / ovarian / upper urinary tract)`,
      );
    if (reasons.length) {
      const dualPathway = ovar.length
        ? ' Ovarian cancer belongs to both the Lynch (mismatch-repair) and BRCA/HBOC spectra; a genetics evaluation can determine which testing pathway fits.'
        : '';
      flags.push({
        severity: 'referral',
        cat: 'canc',
        title: 'Lynch syndrome pattern (hereditary colorectal & spectrum)',
        criterion: reasons.join('; '),
        rec:
          'Suggestive of a hereditary (Lynch) pattern — a revised-Bethesda-type threshold, more sensitive than the stricter Amsterdam II criteria. Consider a genetics referral and earlier, more frequent colonoscopy (often from age 20–25, or 10 years before the earliest family diagnosis).' +
          dualPathway,
        relatives: spectrum,
      });
    }
  }

  // --- Premature cardiovascular disease ---
  {
    const cad = withCond('cad');
    const chol = withCond('chol');
    handled.add('cad').add('chol');
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
    const present = new Set<string>();
    for (const p of blood) for (const c of condIds(p)) present.add(c);
    for (const code of present) {
      if (handled.has(code)) continue;
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
  onset: number | null;
  /** Provenance of this relative's condition record. */
  prov: Provenance;
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
      .map((p) => {
        const e = condEntry(p, id);
        return {
          rel: info.get(p.id)!.rel,
          deg: degShort(info.get(p.id)!.degree),
          onset: e?.onset ?? null,
          prov: e?.prov ?? 'self',
        };
      });

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
