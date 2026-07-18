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
 * - {@link parseCcda} — XML text → a structural {@link ParsedCcda} via `DOMParser`. **This is the
 *   only C-CDA-specific stage.**
 * - {@link stageCcdaImport} / {@link applyCcdaImport} — the source-agnostic reconciliation & merge
 *   engine, hoisted to {@link file://./health-record.ts} so a forthcoming FHIR importer can reuse
 *   it (DR-0020). They are re-exported here under their established C-CDA names so nothing
 *   downstream changes.
 *
 * Clinical-safety commitments carried from DR-0016: never manufacture a code, onset, or risk
 * number; imported facts are attributed `prov: 'record'`; negated / "no known history" and
 * narrative-only entries are surfaced for review, never fabricated into positive conditions;
 * non-genetic relatives (in-law / step / adoptive / foster / spouse) are never auto-attached to
 * genetic parentage. Security (from DR-0017): reject any `<!DOCTYPE>` (closes the XXE /
 * billion-laughs class), size-cap the input, treat a parser error as a structured warning, and
 * flow all CDA text only into plain string fields (never an HTML sink).
 *
 * Layering: this module lives in `src/import/` and imports **only** from `domain` (and the
 * sibling `health-record` engine) — never from `store`, `ui`, or `integrations`.
 */
import type { Sab } from '@/domain/types';
import type { ProblemEntry, RelativeEntry, ParsedHealthRecord } from './health-record';
// Source-agnostic terminology constants/helpers, shared with the FHIR importer (DR-0020). Hoisted
// to `health-record.ts` so both importers read one definition; behaviour is unchanged.
import {
  ABSENCE_SNOMED,
  CODE_SAB,
  RELATIONSHIP_LABELS,
  ageToYears,
  yearFromTs,
} from './health-record';

// ---------------------------------------------------------------------------
// Public types — the parse data contract (pinned for the UI + oracle)
//
// The parsed shapes are the source-neutral engine types, re-exported under their established
// C-CDA names so `parseCcda`'s output still satisfies `stageCcdaImport` and every downstream
// consumer keeps working unchanged.
// ---------------------------------------------------------------------------

/** One coded (or narrative-only) problem parsed from a CCD. See {@link ProblemEntry}: `coded`
 * holds the single preferred (system, code) pair — ICD-10-CM is preferred over SNOMED-CT so the
 * catalog's ICD-10 index (with its 3-character-category fallback) gets first crack; legacy
 * ICD-9-CM and uncoded entries resolve to `system: null` and are surfaced for review, never
 * crosswalked or fabricated. `onsetYear` is the **age at onset in years** (see the module note on
 * onset), or `null` — never invented / defaulted to 0. */
export type CcdaProblemEntry = ProblemEntry;

/** One relative parsed from the Family History section. See {@link RelativeEntry}. `sab` is the
 * sex assigned at birth, from `administrativeGenderCode`, falling back to a sex-specific RoleCode
 * only (never inferred from a sex-neutral role); `relationshipCode` is the HL7 v3 RoleCode
 * (`@code`), upper-cased, e.g. `'MTH'`. */
export type CcdaFamilyMember = RelativeEntry;

/** The structural result of parsing a CCD, before reconciliation against the live record. */
export type ParsedCcda = ParsedHealthRecord;

// The source-agnostic reconciliation engine, re-exported under its established C-CDA names.
export {
  stageHealthRecordImport as stageCcdaImport,
  applyHealthRecordImport as applyCcdaImport,
} from './health-record';
export type {
  StagedCondition,
  StagedFamilyMember,
  StagedHealthRecordImport as StagedCcdaImport,
  HealthRecordSelections as CcdaSelections,
  MemberOverride as CcdaMemberOverride,
} from './health-record';

// ---------------------------------------------------------------------------
// Constants — verified template roots, code-system OIDs, RoleCode maps
// ---------------------------------------------------------------------------

/** Reject inputs larger than this many characters before parsing (a real CCD is well under a
 * couple of MB; the cap bounds an accidental / hostile giant document). */
const MAX_INPUT_CHARS = 16 * 1024 * 1024;

/** Upper bounds on the number of items materialised from a single document. The input-size cap
 * ({@link MAX_INPUT_CHARS}) bounds the raw bytes, but a pathological in-bounds document (many tiny
 * observations / organizers) could still expand into an unbounded staging structure; these caps
 * keep the parsed result bounded. Well above any realistic CCD, so real documents are unaffected;
 * anything beyond is truncated deterministically (document order) with a warning naming the drop. */
const MAX_PARSED_PROBLEMS = 5000;
const MAX_PARSED_FAMILY_MEMBERS = 2000;

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
/**
 * Parse a C-CDA (CCD) document. The optional `limits` only lower the item-count caps for tests —
 * production callers omit it and get the generous {@link MAX_PARSED_PROBLEMS} /
 * {@link MAX_PARSED_FAMILY_MEMBERS} defaults. (Exercising the caps with tiny fixtures keeps the
 * suite fast; the real defaults are far beyond any genuine record.)
 */
export function parseCcda(
  xmlText: string,
  limits?: { maxProblems?: number; maxFamilyMembers?: number },
): ParsedCcda {
  const maxProblems = limits?.maxProblems ?? MAX_PARSED_PROBLEMS;
  const maxFamilyMembers = limits?.maxFamilyMembers ?? MAX_PARSED_FAMILY_MEMBERS;
  const emptyWith = (warning: string): ParsedCcda => ({
    proband: { problems: [], events: [] },
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
  // Item-count caps (see MAX_PARSED_* above). `problemCount` spans the proband problem list AND
  // every relative's conditions (the whole staging structure), so one shared budget bounds them.
  let problemCount = 0;
  let problemsTruncated = false;
  let familyTruncated = false;

  const sections = els(doc, 'section');
  const problemSections = sections.filter((s) =>
    PROBLEM_SECTION_ROOTS.some((r) => hasTemplateId(s, r)),
  );
  const fhSections = sections.filter((s) => hasTemplateId(s, FH_SECTION_ROOT));

  // --- Problem list → proband conditions ---
  const probandProblems: CcdaProblemEntry[] = [];
  let probIndex = 0;
  for (const section of problemSections) {
    if (problemsTruncated) break;
    for (const obs of els(section, 'observation')) {
      if (!hasTemplateId(obs, PROBLEM_OBS_ROOT)) continue;
      const valueEl = childEls(obs, 'value')[0];
      if (isNegatedOrAbsent(obs, valueEl)) {
        negatedCount++;
        continue;
      }
      const coded = extractCoded(valueEl, obs, idMap);
      if (coded.system === null && !coded.displayName) continue; // nothing to show
      if (problemCount >= maxProblems) {
        problemsTruncated = true;
        break;
      }
      probandProblems.push({
        parseId: `ccda-prob-${probIndex++}`,
        coded,
        onsetYear: probandOnsetAge(obs, patientBirthYear),
      });
      problemCount++;
    }
  }

  // --- Family History → relatives + their conditions ---
  const familyMembers: CcdaFamilyMember[] = [];
  let fhIndex = 0;
  for (const section of fhSections) {
    if (familyTruncated) break;
    for (const organizer of els(section, 'organizer')) {
      if (!hasTemplateId(organizer, FH_ORGANIZER_ROOT)) continue;
      const relatedSubject = firstChild(firstChild(organizer, 'subject'), 'relatedSubject');
      if (!relatedSubject) continue;
      if (familyMembers.length >= maxFamilyMembers) {
        familyTruncated = true;
        break;
      }

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
        if (problemCount >= maxProblems) {
          problemsTruncated = true;
          break;
        }
        problems.push({
          parseId: `${parseId}-prob-${pk++}`,
          coded,
          onsetYear: ageAtOnset(obs),
        });
        problemCount++;
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
  if (problemsTruncated) {
    warnings.push(
      `This document listed more than ${maxProblems} conditions; the additional conditions beyond that limit were not imported.`,
    );
  }
  if (familyTruncated) {
    warnings.push(
      `This document listed more than ${maxFamilyMembers} family members; the additional relatives beyond that limit were not imported.`,
    );
  }

  // C-CDA import carries no full-timeline events (Wave 2/3 events are FHIR-only today); the
  // source-agnostic engine still requires the field, so it is always the empty list here.
  return { proband: { problems: probandProblems, events: [] }, familyMembers, warnings };
}

/** Whether a problem/FH observation is a negation or an "absence" assertion (must never become
 * a positive condition). */
function isNegatedOrAbsent(obs: Element, valueEl: Element | undefined): boolean {
  if (attr(obs, 'negationInd').toLowerCase() === 'true') return true;
  if (valueEl) {
    // Check the primary coding AND every translation for an "absence" concept — a CCD may carry
    // the "no known family history" SNOMED code only in a `value/translation` (e.g. a primary
    // ICD-10 coding with a SNOMED translation), and that must still read as an absence assertion.
    if (ABSENCE_SNOMED.has(attr(valueEl, 'code'))) return true;
    for (const tr of childEls(valueEl, 'translation')) {
      if (ABSENCE_SNOMED.has(attr(tr, 'code'))) return true;
    }
  }
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
