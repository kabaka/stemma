/**
 * C-CDA (CCD) import — the patient-record counterpart to {@link parseGedcom} (family tree)
 * and {@link parseNativeBackup} (Stemma backup).
 *
 * A Consolidated CDA Continuity-of-Care Document (CCD) is the XML every certified US EHR must
 * offer for patient self-download (ONC 170.315(e)(1) "View, Download, Transmit"). It uniquely
 * carries Stemma's two data axes — a **Problem list** (the patient's own conditions) and a
 * dedicated **Family History** section (relatives and their conditions) — so it is the chosen
 * file-drop import (DR-0016/DR-0017), parsed 100% client-side with the same trust model as the
 * GEDCOM / native-backup importers: pure, deterministic, no network, no clock, no random ids,
 * funnelled through the validating `replaceRecord` store boundary.
 *
 * Three pure "never-throw" stages mirror the GEDCOM split:
 * - {@link parseCcda} — XML text → a structural {@link ParsedCcda} via `DOMParser`.
 * - {@link stageCcdaImport} — read-only over the live record → per-item {@link StagedCcdaImport}
 *   suggestions (catalog match, dedup status, conservative relative placement).
 * - {@link applyCcdaImport} — a pure immutable merge → a complete new {@link FamilyRecord} plus the
 *   long-tail catalog extensions to register.
 *
 * Clinical-safety commitments carried from DR-0016: never manufacture a code, onset, or risk
 * number; imported facts are attributed `prov: 'record'`; negated / "no known history" and
 * narrative-only entries are surfaced for review, never fabricated into positive conditions;
 * non-genetic relatives (in-law / step / adoptive / foster / spouse) are never auto-attached to
 * genetic parentage. Security (from DR-0017): reject any `<!DOCTYPE>` (closes the XXE /
 * billion-laughs class), size-cap the input, treat a parser error as a structured warning, and
 * flow all CDA text only into plain string fields (never an HTML sink).
 *
 * Layering: this module lives in `src/import/` and imports **only** from `domain` — never from
 * `store`, `ui`, or `integrations`. The long-tail condition shape is the shared
 * {@link conditionFromCode} in `domain/catalog`, so no `import → integrations` dependency is
 * needed.
 */
import type { Condition, ConditionEntry, FamilyRecord, Gender, Person, Sab } from '@/domain/types';
import { conditionFromCode, sanitizeExtensions, type Catalog } from '@/domain/catalog';
import { layoutFromGraph, linkRelative, type Relation } from '@/domain/record';
import {
  childrenOf,
  indexPeople,
  parentsOf,
  personById,
  relationInfo,
  type PeopleIndex,
} from '@/domain/graph';
import { sabOf } from '@/domain/person';

// ---------------------------------------------------------------------------
// Public types — the parse / stage / apply data contract (pinned for the UI + oracle)
// ---------------------------------------------------------------------------

/**
 * One coded (or narrative-only) problem parsed from a CCD. `coded` holds the single preferred
 * (system, code) pair — ICD-10-CM is preferred over SNOMED-CT so the catalog's ICD-10 index
 * (with its 3-character-category fallback) gets first crack; legacy ICD-9-CM and uncoded
 * entries resolve to `system: null` and are surfaced for review, never crosswalked or
 * fabricated. `onsetYear` is the **age at onset in years** (see the module note on onset), or
 * `null` — never invented / defaulted to 0.
 */
export interface CcdaProblemEntry {
  parseId: string;
  coded: { system: 'ICD-10-CM' | 'SNOMED-CT' | null; code: string | null; displayName: string };
  onsetYear: number | null;
}

/** One relative parsed from the Family History section. */
export interface CcdaFamilyMember {
  parseId: string;
  name: string | null;
  /** Sex assigned at birth, from `administrativeGenderCode`, falling back to a sex-specific
   * RoleCode only (never inferred from a sex-neutral role). */
  sab: Sab;
  /** HL7 v3 RoleCode (`@code`), upper-cased, e.g. `'MTH'`. */
  relationshipCode: string;
  relationshipDisplay: string;
  birthYear: number | null;
  death: { year: number | null; dead: boolean | null };
  problems: CcdaProblemEntry[];
}

/** The structural result of parsing a CCD, before reconciliation against the live record. */
export interface ParsedCcda {
  proband: { problems: CcdaProblemEntry[] };
  familyMembers: CcdaFamilyMember[];
  warnings: string[];
}

/** A parsed problem reconciled against the catalog + the target person's existing conditions. */
export interface StagedCondition {
  parseId: string;
  /** Resolved catalog id (curated slug, long-tail ICD-10 code, or SNOMED code), or `null` for a
   * narrative-only entry that has no code to attach. */
  suggestedConditionId: string | null;
  displayName: string;
  onsetYear: number | null;
  /** `'new'` = a fresh coded condition; `'duplicate'` = already on the target person;
   * `'needs-review'` = SNOMED-only-no-curated-match or narrative-only (defaults OFF). */
  status: 'new' | 'duplicate' | 'needs-review';
  defaultSelected: boolean;
}

/** A parsed relative reconciled against the live pedigree. Carries the demographic fields
 * {@link applyCcdaImport} needs to build the {@link Person} (apply does not re-read `parsed`). */
export interface StagedFamilyMember {
  parseId: string;
  relationshipDisplay: string;
  /** `'matched-existing'` = same-position person with an exact (normalised) name → merge
   * conditions; `'new-person'` = confidently placed, no conflict → add; `'ambiguous'` = null
   * placement or same-position candidates needing a manual choice (defaults OFF). */
  matchStatus: 'new-person' | 'matched-existing' | 'ambiguous';
  matchedPersonId: string | null;
  /** Same-position existing people the user may reconcile against (an ambiguous match). */
  candidates: { personId: string; name: string; rel: string }[];
  /** The conservative auto-placement, or `null` when the relationship is ambiguous / the
   * anchoring relative does not yet exist. */
  placement: { anchorId: string; relation: Relation } | null;
  conditions: StagedCondition[];
  defaultSelected: boolean;
  // --- demographics carried through for apply / the review UI ---
  name: string | null;
  sab: Sab;
  birthYear: number | null;
  death: { year: number | null; dead: boolean | null };
}

/** The full staged import: proband conditions + reconciled relatives + carried-through warnings. */
export interface StagedCcdaImport {
  probandConditions: StagedCondition[];
  familyMembers: StagedFamilyMember[];
  warnings: string[];
}

/** Per-relative override the review UI supplies for an ambiguous item. */
export interface CcdaMemberOverride {
  /** Reconcile this relative into an existing person instead of adding a new one. */
  matchedPersonId?: string | null;
  /** Manual placement chosen for an otherwise-unplaced relative. */
  placement?: { anchorId: string; relation: Relation } | null;
}

/** The user's accept/override set: which `parseId`s are checked, plus per-relative overrides. */
export interface CcdaSelections {
  /** `parseId`s the user has checked to import (both condition and family-member ids). */
  selectedParseIds: ReadonlySet<string>;
  /** Placement / match overrides for ambiguous relatives, keyed by member `parseId`. */
  overrides?: Readonly<Record<string, CcdaMemberOverride>>;
}

// ---------------------------------------------------------------------------
// Constants — verified template roots, code-system OIDs, RoleCode maps
// ---------------------------------------------------------------------------

/** Reject inputs larger than this many characters before parsing (a real CCD is well under a
 * couple of MB; the cap bounds an accidental / hostile giant document). */
const MAX_INPUT_CHARS = 16 * 1024 * 1024;

// Section / entry template `@root`s — matched on `@root` only (extensions vary across C-CDA
// R1.1 / R2.0 / R2.1 / Companion Guide; roots are stable). Verified against the C-CDA IG.
const PROBLEM_SECTION_ROOTS = [
  '2.16.840.1.113883.10.20.22.2.5',
  '2.16.840.1.113883.10.20.22.2.5.1',
];
const PROBLEM_OBS_ROOT = '2.16.840.1.113883.10.20.22.4.4';
const FH_SECTION_ROOT = '2.16.840.1.113883.10.20.22.2.15';
const FH_ORGANIZER_ROOT = '2.16.840.1.113883.10.20.22.4.45';
const FH_OBS_ROOT = '2.16.840.1.113883.10.20.22.4.46';
const AGE_OBS_ROOT = '2.16.840.1.113883.10.20.22.4.31';

// Code-system OIDs.
const OID_SNOMED = '2.16.840.1.113883.6.96';
const OID_ICD10CM = '2.16.840.1.113883.6.90';
const OID_ICD9CM = '2.16.840.1.113883.6.103';

/** SNOMED code of the Age Observation ("age at onset"), used as a fallback identifier when the
 * Age Observation template id is absent. */
const AGE_OBS_SNOMED = '445518008';

/** Absence / "no known history" SNOMED concepts that must never become a positive condition,
 * even absent a `negationInd` (e.g. "No family history of ..."). */
const ABSENCE_SNOMED = new Set(['160266009', '160245001']);

// RoleCode → sex assigned at birth, for the sex-SPECIFIC codes only. A sex-neutral code (SIB,
// PRN, CHILD, GRPRN, COUSN, ...) is deliberately absent, so it resolves to 'u' — sab is never
// inferred from a neutral role (guardrail #4).
const CODE_SAB: Record<string, Sab> = {
  MTH: 'f',
  FTH: 'm',
  NMTH: 'f',
  NFTH: 'm',
  BRO: 'm',
  SIS: 'f',
  NBRO: 'm',
  NSIS: 'f',
  TWINBRO: 'm',
  TWINSIS: 'f',
  HBRO: 'm',
  HSIS: 'f',
  SON: 'm',
  DAU: 'f',
  SONC: 'm',
  DAUC: 'f',
  GRMTH: 'f',
  GRFTH: 'm',
  MGRMTH: 'f',
  MGRFTH: 'm',
  PGRMTH: 'f',
  PGRFTH: 'm',
  AUNT: 'f',
  UNCLE: 'm',
  MAUNT: 'f',
  PAUNT: 'f',
  MUNCLE: 'm',
  PUNCLE: 'm',
  NIECE: 'f',
  NEPHEW: 'm',
  MTHINLAW: 'f',
  FTHINLAW: 'm',
  STPMTH: 'f',
  STPFTH: 'm',
  FSTRMTH: 'f',
  FSTRFTH: 'm',
  GGRMTH: 'f',
  GGRFTH: 'm',
  WIFE: 'f',
  HUSB: 'm',
};

// Conservative auto-placement sets (DR-0017). Anything not covered here is surfaced ambiguous.
const PARENT_CODES = new Set(['MTH', 'FTH', 'NMTH', 'NFTH']);
const SIBLING_CODES = new Set(['BRO', 'SIS', 'NBRO', 'NSIS', 'SIB', 'TWINBRO', 'TWINSIS']);
const CHILD_CODES = new Set(['SON', 'DAU', 'CHILD', 'NCHILD']);
/** Side-specified grandparents: parent of the proband's existing mother (`'f'`) or father
 * (`'m'`) — placed only when that linking parent already exists in the record. */
const SIDED_GRANDPARENT: Record<string, Sab> = {
  MGRMTH: 'f',
  MGRFTH: 'f',
  PGRMTH: 'm',
  PGRFTH: 'm',
};

/** Best-effort display fallback when a RoleCode carries no `@displayName`. */
const RELATIONSHIP_LABELS: Record<string, string> = {
  MTH: 'Mother',
  FTH: 'Father',
  NMTH: 'Mother',
  NFTH: 'Father',
  PRN: 'Parent',
  BRO: 'Brother',
  SIS: 'Sister',
  SIB: 'Sibling',
  NBRO: 'Brother',
  NSIS: 'Sister',
  TWINBRO: 'Twin brother',
  TWINSIS: 'Twin sister',
  HBRO: 'Half-brother',
  HSIS: 'Half-sister',
  SON: 'Son',
  DAU: 'Daughter',
  CHILD: 'Child',
  NCHILD: 'Child',
  GRMTH: 'Grandmother',
  GRFTH: 'Grandfather',
  GRPRN: 'Grandparent',
  MGRMTH: 'Maternal grandmother',
  MGRFTH: 'Maternal grandfather',
  PGRMTH: 'Paternal grandmother',
  PGRFTH: 'Paternal grandfather',
  AUNT: 'Aunt',
  UNCLE: 'Uncle',
  NIECE: 'Niece',
  NEPHEW: 'Nephew',
  COUSN: 'Cousin',
};

// ---------------------------------------------------------------------------
// DOM helpers — namespace-agnostic (CDA uses a default ns + the `sdtc:` extension ns)
// ---------------------------------------------------------------------------

/** All descendant elements with the given local name, regardless of namespace/prefix. */
function els(parent: Element | Document, localName: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS('*', localName));
}

/** Direct child elements with the given local name (structural navigation that must not reach
 * into a nested entry). */
function childEls(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter((c) => c.localName === localName);
}

/** First direct child with the given local name, or `undefined`. */
function firstChild(parent: Element | undefined, localName: string): Element | undefined {
  if (!parent) return undefined;
  return Array.from(parent.children).find((c) => c.localName === localName);
}

/** A trimmed attribute value, or `''` when the element or attribute is absent. */
function attr(el: Element | undefined | null, name: string): string {
  return el?.getAttribute(name)?.trim() ?? '';
}

/** Collapse whitespace and trim — the only transform applied to CDA text (kept a plain string,
 * never rendered as HTML). */
function normText(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/** An element identified by a `<content ID="...">`/`ID` reference target, from a pre-built map. */
function referencedText(el: Element | undefined, idMap: Map<string, Element>): string {
  if (!el) return '';
  const ref = els(el, 'reference')
    .map((r) => attr(r, 'value'))
    .find((v) => v.startsWith('#'));
  if (ref) {
    const target = idMap.get(ref.slice(1));
    if (target) return normText(target.textContent);
  }
  return normText(el.textContent);
}

function hasTemplateId(el: Element, root: string): boolean {
  return childEls(el, 'templateId').some((t) => attr(t, 'root') === root);
}

type SystemLabel = 'ICD-10-CM' | 'SNOMED-CT' | 'ICD-9-CM' | 'other';

function systemFromOid(oid: string): SystemLabel {
  return oid === OID_ICD10CM
    ? 'ICD-10-CM'
    : oid === OID_SNOMED
      ? 'SNOMED-CT'
      : oid === OID_ICD9CM
        ? 'ICD-9-CM'
        : 'other';
}

/** Year from a CDA timestamp (`YYYY`, `YYYYMM`, `YYYYMMDD`, ...), or `null`. */
function yearFromTs(value: string): number | null {
  const m = /^(\d{4})/.exec(value.trim());
  if (!m) return null;
  const y = Number.parseInt(m[1], 10);
  return Number.isSafeInteger(y) ? y : null;
}

/** Convert an Age Observation PQ (value + UCUM unit) to whole years, or `null`. An age is
 * already an age — used directly (guardrail #1: never invented). Negative ages are rejected. */
function ageToYears(value: string, unit: string): number | null {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return null;
  const u = unit.trim().toLowerCase();
  let years: number;
  if (u === 'mo' || u === 'month' || u === 'months') years = n / 12;
  else if (u === 'wk' || u === 'week' || u === 'weeks') years = n / 52;
  else if (u === 'd' || u === 'day' || u === 'days') years = n / 365;
  else years = n; // 'a' / 'year' / 'yr' / unknown → years
  const floored = Math.floor(years);
  return floored >= 0 ? floored : null;
}

// ---------------------------------------------------------------------------
// parseCcda
// ---------------------------------------------------------------------------

/**
 * Parse a CCD XML string into its structural {@link ParsedCcda}. Pure, deterministic, never
 * throws — every failure mode (empty, oversized, DOCTYPE, malformed XML, no relevant sections)
 * returns an empty result plus a structured warning, exactly like {@link parseGedcom}.
 *
 * **Onset semantics.** `CcdaProblemEntry.onsetYear` is the **age at onset in years** (the value
 * that becomes {@link ConditionEntry.onset}). For a **relative** it comes straight from the Age
 * Observation. For the **proband** the Problem list carries a diagnosis *date*, not an age, so
 * the age is computed here as `year(effectiveTime/low) − year(patient birthTime)` using the
 * document's own `recordTarget` birth date — and only when both are present and the result is
 * ≥ 0; otherwise `null`. Never defaulted to 0.
 */
export function parseCcda(xmlText: string): ParsedCcda {
  const emptyWith = (warning: string): ParsedCcda => ({
    proband: { problems: [] },
    familyMembers: [],
    warnings: [warning],
  });

  if (typeof xmlText !== 'string' || !xmlText.trim()) {
    return emptyWith('The file was empty.');
  }
  if (xmlText.length > MAX_INPUT_CHARS) {
    return emptyWith('This file is too large to import safely.');
  }
  // Reject any DOCTYPE up front — this closes the XXE / billion-laughs entity-expansion class.
  // A real CCD carries no DOCTYPE, so this rejects only crafted input.
  if (/<!doctype/i.test(xmlText)) {
    return emptyWith(
      'This document declares a DOCTYPE and was rejected for safety (external entities are not processed).',
    );
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  } catch {
    // `DOMParser` absent (non-DOM runtime) or a hard parse failure — never propagate.
    return emptyWith('This file could not be parsed as XML.');
  }
  if (!doc || !doc.documentElement || doc.getElementsByTagNameNS('*', 'parsererror').length > 0) {
    return emptyWith('This file is not well-formed XML and could not be imported.');
  }

  // Content-narrative id map (`<... ID="x">`), for resolving `originalText/reference/@value`.
  const idMap = new Map<string, Element>();
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    const cid = el.getAttribute('ID') ?? el.getAttribute('id');
    if (cid && !idMap.has(cid)) idMap.set(cid, el);
  }

  // Proband (patient) birth year, for the diagnosis-date → age-at-onset computation.
  const recordTarget = els(doc, 'recordTarget')[0];
  const patientBirthYear = recordTarget
    ? yearFromTs(attr(els(recordTarget, 'birthTime')[0], 'value'))
    : null;

  const warnings: string[] = [];
  let negatedCount = 0;

  const sections = els(doc, 'section');
  const problemSections = sections.filter((s) =>
    PROBLEM_SECTION_ROOTS.some((r) => hasTemplateId(s, r)),
  );
  const fhSections = sections.filter((s) => hasTemplateId(s, FH_SECTION_ROOT));

  // --- Problem list → proband conditions ---
  const probandProblems: CcdaProblemEntry[] = [];
  let probIndex = 0;
  for (const section of problemSections) {
    for (const obs of els(section, 'observation')) {
      if (!hasTemplateId(obs, PROBLEM_OBS_ROOT)) continue;
      const valueEl = childEls(obs, 'value')[0];
      if (isNegatedOrAbsent(obs, valueEl)) {
        negatedCount++;
        continue;
      }
      const coded = extractCoded(valueEl, obs, idMap);
      if (coded.system === null && !coded.displayName) continue; // nothing to show
      probandProblems.push({
        parseId: `ccda-prob-${probIndex++}`,
        coded,
        onsetYear: probandOnsetAge(obs, patientBirthYear),
      });
    }
  }

  // --- Family History → relatives + their conditions ---
  const familyMembers: CcdaFamilyMember[] = [];
  let fhIndex = 0;
  for (const section of fhSections) {
    for (const organizer of els(section, 'organizer')) {
      if (!hasTemplateId(organizer, FH_ORGANIZER_ROOT)) continue;
      const relatedSubject = firstChild(firstChild(organizer, 'subject'), 'relatedSubject');
      if (!relatedSubject) continue;

      const relCodeEl = firstChild(relatedSubject, 'code');
      const relationshipCode = attr(relCodeEl, 'code').toUpperCase();
      const relationshipDisplay =
        normText(attr(relCodeEl, 'displayName')) ||
        RELATIONSHIP_LABELS[relationshipCode] ||
        relationshipCode ||
        'Relative';

      const demo = firstChild(relatedSubject, 'subject');
      const genderCode = attr(firstChild(demo, 'administrativeGenderCode'), 'code');
      const sab = sabFrom(genderCode, relationshipCode);

      const nameEl = firstChild(demo, 'name');
      const name = (nameEl ? normText(nameEl.textContent) : '') || null;
      const birthYear = yearFromTs(attr(firstChild(demo, 'birthTime'), 'value'));

      const deceasedIndEl = firstChild(demo, 'deceasedInd');
      const deceasedTimeEl = firstChild(demo, 'deceasedTime');
      let dead: boolean | null = null;
      if (deceasedIndEl) dead = attr(deceasedIndEl, 'value').toLowerCase() === 'true';
      else if (deceasedTimeEl) dead = true;
      const deathYear = yearFromTs(attr(deceasedTimeEl, 'value'));

      const parseId = `ccda-fh-${fhIndex++}`;
      const problems: CcdaProblemEntry[] = [];
      let pk = 0;
      for (const obs of els(organizer, 'observation')) {
        if (!hasTemplateId(obs, FH_OBS_ROOT)) continue;
        const valueEl = childEls(obs, 'value')[0];
        if (isNegatedOrAbsent(obs, valueEl)) {
          negatedCount++;
          continue;
        }
        const coded = extractCoded(valueEl, obs, idMap);
        if (coded.system === null && !coded.displayName) continue;
        problems.push({
          parseId: `${parseId}-prob-${pk++}`,
          coded,
          onsetYear: ageAtOnset(obs),
        });
      }

      familyMembers.push({
        parseId,
        name,
        sab,
        relationshipCode,
        relationshipDisplay,
        birthYear,
        death: { year: deathYear, dead },
        problems,
      });
    }
  }

  if (!problemSections.length && !fhSections.length) {
    warnings.push('No problem list or family history section was found in this document.');
  }
  if (negatedCount) {
    warnings.push(
      `${negatedCount} negated or "no known history" ${
        negatedCount === 1 ? 'entry was' : 'entries were'
      } not imported as a condition.`,
    );
  }

  return { proband: { problems: probandProblems }, familyMembers, warnings };
}

/** Whether a problem/FH observation is a negation or an "absence" assertion (must never become
 * a positive condition). */
function isNegatedOrAbsent(obs: Element, valueEl: Element | undefined): boolean {
  if (attr(obs, 'negationInd').toLowerCase() === 'true') return true;
  if (valueEl && ABSENCE_SNOMED.has(attr(valueEl, 'code'))) return true;
  return false;
}

/**
 * Resolve an observation's coded diagnosis. Collects every (code, system) pair from `value`
 * and its `translation`s, prefers an ICD-10-CM coding, then SNOMED-CT; ICD-9-CM (legacy) and
 * uncoded values yield `system: null` (surfaced, not crosswalked). `displayName` comes from the
 * chosen coding's `@displayName`, then the referenced narrative text, then the code itself.
 */
function extractCoded(
  valueEl: Element | undefined,
  obs: Element,
  idMap: Map<string, Element>,
): CcdaProblemEntry['coded'] {
  const pairs: { system: SystemLabel; code: string; display: string }[] = [];
  const collect = (el: Element | undefined): void => {
    if (!el) return;
    const code = attr(el, 'code');
    if (!code) return;
    pairs.push({
      system: systemFromOid(attr(el, 'codeSystem')),
      code,
      display: normText(attr(el, 'displayName')),
    });
  };
  collect(valueEl);
  if (valueEl) for (const tr of childEls(valueEl, 'translation')) collect(tr);

  const chosen =
    pairs.find((p) => p.system === 'ICD-10-CM') ?? pairs.find((p) => p.system === 'SNOMED-CT');
  if (chosen) {
    const displayName =
      chosen.display ||
      referencedText(valueEl, idMap) ||
      referencedText(firstChild(obs, 'text'), idMap) ||
      chosen.code;
    return { system: chosen.system as 'ICD-10-CM' | 'SNOMED-CT', code: chosen.code, displayName };
  }
  // No usable code (uncoded, ICD-9-only, or other terminology) → narrative-only, surfaced verbatim.
  const displayName =
    referencedText(valueEl, idMap) ||
    referencedText(firstChild(obs, 'text'), idMap) ||
    normText(attr(valueEl, 'displayName'));
  return { system: null, code: null, displayName };
}

/** Age at onset for a Family History observation, from its nested Age Observation. */
function ageAtOnset(obs: Element): number | null {
  for (const inner of els(obs, 'observation')) {
    const isAge =
      hasTemplateId(inner, AGE_OBS_ROOT) ||
      childEls(inner, 'code').some((c) => attr(c, 'code') === AGE_OBS_SNOMED);
    if (!isAge) continue;
    const val = childEls(inner, 'value')[0];
    if (!val) continue;
    const years = ageToYears(attr(val, 'value'), attr(val, 'unit'));
    if (years != null) return years;
  }
  return null;
}

/** Proband age at onset = diagnosis year (`effectiveTime/low`) − patient birth year, when both
 * known and the result is ≥ 0; else `null`. Never invented. */
function probandOnsetAge(obs: Element, patientBirthYear: number | null): number | null {
  const eff = childEls(obs, 'effectiveTime')[0];
  if (!eff) return null;
  const low = childEls(eff, 'low')[0];
  const dxYear = yearFromTs(low ? attr(low, 'value') : attr(eff, 'value'));
  if (dxYear == null || patientBirthYear == null) return null;
  const age = dxYear - patientBirthYear;
  return age >= 0 ? age : null;
}

/** Sex assigned at birth: `administrativeGenderCode` M/F wins; otherwise a sex-SPECIFIC RoleCode
 * only; a sex-neutral role → `'u'` (never inferred). */
function sabFrom(genderCode: string, relationshipCode: string): Sab {
  const g = genderCode.trim().toUpperCase();
  if (g === 'M') return 'm';
  if (g === 'F') return 'f';
  return CODE_SAB[relationshipCode] ?? 'u';
}

// ---------------------------------------------------------------------------
// stageCcdaImport
// ---------------------------------------------------------------------------

/**
 * Reconcile a {@link ParsedCcda} against the live record and catalog: resolve each problem to a
 * catalog id (or a long-tail / needs-review suggestion), flag proband-condition duplicates, and
 * assign each relative a conservative placement + match status. Read-only over the record — it
 * mutates nothing and returns the suggestions the review UI renders. Pure and deterministic.
 */
export function stageCcdaImport(
  parsed: ParsedCcda,
  record: FamilyRecord,
  catalog: Catalog,
): StagedCcdaImport {
  const idx = indexPeople(record.people, record.unions);
  const proband = record.people.find((p) => p.id === record.probandId);
  const probandCondIds = new Set((proband?.conds ?? []).map((c) => c.id));

  const probandConditions = parsed.proband.problems.map((e) =>
    stageCondition(e, catalog, probandCondIds),
  );
  const familyMembers = parsed.familyMembers.map((m) => stageFamilyMember(m, record, idx, catalog));

  return { probandConditions, familyMembers, warnings: [...parsed.warnings] };
}

/** Resolve one parsed problem against the catalog + a target person's existing condition ids. */
function stageCondition(
  e: CcdaProblemEntry,
  catalog: Catalog,
  existingIds: Set<string>,
): StagedCondition {
  const { system, code, displayName } = e.coded;
  let suggestedConditionId: string | null = null;
  let status: StagedCondition['status'] = 'needs-review';

  if (system === 'ICD-10-CM' && code) {
    // Curated ICD-10 (exact or 3-char category) → curated id; otherwise a real ICD-10 code is a
    // valid long-tail suggestion in its own right.
    const hit = catalog.byCode('ICD-10-CM', code);
    suggestedConditionId = hit ? hit.id : code;
    status = 'new';
  } else if (system === 'SNOMED-CT' && code) {
    const hit = catalog.byCode('SNOMED-CT', code);
    if (hit) {
      suggestedConditionId = hit.id;
      status = 'new';
    } else {
      // Preserve the SNOMED code + name verbatim; never fabricate an ICD-10 code for it.
      suggestedConditionId = code;
      status = 'needs-review';
    }
  } else {
    // Narrative-only (uncoded / ICD-9 / other terminology) — nothing to attach automatically.
    suggestedConditionId = null;
    status = 'needs-review';
  }

  if (suggestedConditionId && existingIds.has(suggestedConditionId)) status = 'duplicate';

  return {
    parseId: e.parseId,
    suggestedConditionId,
    displayName,
    onsetYear: e.onsetYear,
    status,
    defaultSelected: status === 'new',
  };
}

function stageFamilyMember(
  m: CcdaFamilyMember,
  record: FamilyRecord,
  idx: PeopleIndex,
  catalog: Catalog,
): StagedFamilyMember {
  const probandId = record.probandId;
  const placement = autoPlacement(m.relationshipCode, probandId, idx);

  let matchStatus: StagedFamilyMember['matchStatus'];
  let matchedPersonId: string | null = null;
  let candidates: { personId: string; name: string; rel: string }[] = [];

  if (placement) {
    const samePos = personsAtPosition(idx, placement);
    const norm = normName(m.name);
    const exact = norm ? samePos.find((p) => normName(p.name) === norm) : undefined;
    if (exact) {
      matchStatus = 'matched-existing';
      matchedPersonId = exact.id;
    } else if (samePos.length) {
      // Same-position people exist but none is a confident name match — reconcile manually.
      matchStatus = 'ambiguous';
      candidates = samePos.map((p) => ({
        personId: p.id,
        name: p.name,
        rel: relationInfo(idx, p.id, probandId).rel,
      }));
    } else {
      matchStatus = 'new-person';
    }
  } else {
    // Ambiguous / non-genetic / side-unknown relationship — never auto-attached.
    matchStatus = 'ambiguous';
  }

  const targetCondIds = new Set(
    matchedPersonId ? (personById(idx, matchedPersonId)?.conds ?? []).map((c) => c.id) : [],
  );
  const conditions = m.problems.map((e) => stageCondition(e, catalog, targetCondIds));

  return {
    parseId: m.parseId,
    relationshipDisplay: m.relationshipDisplay,
    matchStatus,
    matchedPersonId,
    candidates,
    placement,
    conditions,
    defaultSelected: matchStatus !== 'ambiguous',
    name: m.name,
    sab: m.sab,
    birthYear: m.birthYear,
    death: m.death,
  };
}

/** The conservative auto-placement for a RoleCode, or `null` when ambiguous / not yet linkable. */
function autoPlacement(
  code: string,
  probandId: string,
  idx: PeopleIndex,
): { anchorId: string; relation: Relation } | null {
  if (PARENT_CODES.has(code)) return { anchorId: probandId, relation: 'parent' };
  if (SIBLING_CODES.has(code)) return { anchorId: probandId, relation: 'sibling' };
  if (CHILD_CODES.has(code)) return { anchorId: probandId, relation: 'child' };
  const linkingSab = SIDED_GRANDPARENT[code];
  if (linkingSab) {
    const parent = parentsOf(idx, probandId)
      .map((pid) => personById(idx, pid))
      .find((p) => p && sabOf(p) === linkingSab);
    if (parent) return { anchorId: parent.id, relation: 'parent' };
  }
  return null;
}

/** Existing people occupying the same graph position an auto-placement targets. */
function personsAtPosition(
  idx: PeopleIndex,
  placement: { anchorId: string; relation: Relation },
): Person[] {
  const ids =
    placement.relation === 'parent'
      ? parentsOf(idx, placement.anchorId)
      : placement.relation === 'child'
        ? childrenOf(idx, placement.anchorId)
        : placement.relation === 'sibling'
          ? siblingsOf(idx, placement.anchorId)
          : [];
  return ids.map((id) => personById(idx, id)).filter((p): p is Person => p != null);
}

function siblingsOf(idx: PeopleIndex, id: string): string[] {
  const out = new Set<string>();
  for (const u of idx.unions) {
    if (u.children.includes(id)) for (const c of u.children) if (c !== id) out.add(c);
  }
  return [...out];
}

/** Normalise a name for a case/whitespace-insensitive EXACT comparison (no fuzzy matching). */
function normName(n: string | null | undefined): string {
  return (n ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// applyCcdaImport
// ---------------------------------------------------------------------------

/**
 * Merge the user-accepted subset of a {@link StagedCcdaImport} into `record`, returning a
 * complete new {@link FamilyRecord} (built via {@link linkRelative} + {@link layoutFromGraph},
 * like the GEDCOM importer) and the long-tail {@link Condition} extensions to register through
 * the store's `sanitizeExtensions` boundary. Pure — the input record is never mutated. Only
 * checked items apply; ambiguous relatives apply only when the UI supplied a placement/match
 * override, and are otherwise skipped. Conditions attach with `prov: 'record'`, dedup-safe;
 * onset is taken verbatim from staging (never invented).
 */
export function applyCcdaImport(
  record: FamilyRecord,
  staged: StagedCcdaImport,
  selections: CcdaSelections,
  catalog: Catalog,
): { record: FamilyRecord; extensions: Condition[] } {
  const selected = selections.selectedParseIds;
  const overrides = selections.overrides ?? {};
  let next: FamilyRecord = structuredClone(record);

  // Track condition ids actually attached this run, and their display names, so only genuinely
  // merged long-tail codes are registered as extensions (a pre-existing long-tail id on the
  // record is already registered elsewhere).
  const newlyAttached = new Set<string>();
  const displayById = new Map<string, string>();
  const rememberDisplay = (c: StagedCondition): void => {
    if (c.suggestedConditionId && !displayById.has(c.suggestedConditionId)) {
      displayById.set(c.suggestedConditionId, c.displayName);
    }
  };
  staged.probandConditions.forEach(rememberDisplay);
  staged.familyMembers.forEach((m) => m.conditions.forEach(rememberDisplay));

  /** Build the {@link ConditionEntry}s for the selected, non-duplicate, coded conditions,
   * deduping against a target person's `existing` id set (mutated as ids are consumed). */
  const buildEntries = (conds: StagedCondition[], existing: Set<string>): ConditionEntry[] => {
    const out: ConditionEntry[] = [];
    for (const c of conds) {
      if (!selected.has(c.parseId)) continue;
      const id = c.suggestedConditionId;
      if (!id || existing.has(id)) continue; // narrative-only or already present
      existing.add(id);
      out.push({ id, onset: c.onsetYear, prov: 'record' });
    }
    return out;
  };
  const commit = (entries: ConditionEntry[]): void => {
    for (const e of entries) newlyAttached.add(e.id);
  };

  // --- Proband conditions ---
  const probandPerson = next.people.find((p) => p.id === next.probandId);
  if (probandPerson) {
    const existing = new Set(probandPerson.conds.map((c) => c.id));
    const entries = buildEntries(staged.probandConditions, existing);
    probandPerson.conds = [...probandPerson.conds, ...entries];
    commit(entries);
  }

  // --- Family members ---
  const usedIds = new Set(next.people.map((p) => p.id));
  for (const m of staged.familyMembers) {
    if (!selected.has(m.parseId)) continue;
    const ov = overrides[m.parseId] ?? {};
    const matchedPersonId =
      ov.matchedPersonId !== undefined ? ov.matchedPersonId : m.matchedPersonId;
    const placement = ov.placement !== undefined ? ov.placement : m.placement;

    if (matchedPersonId) {
      // Reconcile into an existing person: merge conditions only, add no new node.
      const person = next.people.find((p) => p.id === matchedPersonId);
      if (!person) continue;
      const existing = new Set(person.conds.map((c) => c.id));
      const entries = buildEntries(m.conditions, existing);
      person.conds = [...person.conds, ...entries];
      commit(entries);
      continue;
    }
    if (!placement) continue; // unplaced ambiguous relative with no override — skip.

    const personId = uniqueId(m.parseId, usedIds);
    const entries = buildEntries(m.conditions, new Set<string>());
    const person: Person = {
      id: personId,
      name: m.name ?? '(unknown)',
      sab: m.sab,
      gender: genderFromSab(m.sab),
      gen: 0,
      x: 0,
      dead: m.death.dead ?? false,
      birth: m.birthYear,
      death: m.death.year,
      conds: entries,
    };
    const linked = linkRelative(next, placement.anchorId, placement.relation, person);
    if (linked === next) continue; // anchor missing or parent slot full — no-op, discard.
    next = linked;
    usedIds.add(personId);
    commit(entries);
  }

  // Recompute generations + seed layout from the merged union graph (as the GEDCOM importer does).
  const merged = layoutFromGraph(next);

  // Register the newly-attached long-tail codes (those with no curated catalog metadata).
  const extensions: Condition[] = [];
  for (const id of newlyAttached) {
    if (catalog.has(id)) continue;
    const system = /^\d+$/.test(id) ? 'SNOMED-CT' : 'ICD-10-CM';
    extensions.push(conditionFromCode(system, id, displayById.get(id) ?? id));
  }

  return { record: merged, extensions: sanitizeExtensions(extensions) };
}

/** Deterministic collision-free id from a preferred base (the parse id) and the in-use set. */
function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/** Display gender defaulted from sex assigned at birth (editable after import), matching the
 * GEDCOM importer's fallback. */
function genderFromSab(sab: Sab): Gender {
  return sab === 'm' ? 'man' : sab === 'f' ? 'woman' : 'nb';
}
