/**
 * Health-record reconciliation & merge engine — the **source-agnostic** core shared by every
 * patient-record importer (C-CDA today via {@link parseCcda}; FHIR next). It takes a already-parsed,
 * structural {@link ParsedHealthRecord} — problems for the proband plus a family-history list of
 * relatives and their problems — and reconciles it against the live record and the condition
 * catalog, then merges the user-accepted subset.
 *
 * Two pure "never-throw" stages (the parse stage is source-specific and lives in each importer):
 * - {@link stageHealthRecordImport} — read-only over the live record → per-item
 *   {@link StagedHealthRecordImport} suggestions (catalog match, dedup status, conservative
 *   relative placement).
 * - {@link applyHealthRecordImport} — a pure immutable merge → a complete new {@link FamilyRecord}
 *   plus the long-tail catalog extensions to register.
 *
 * Clinical-safety commitments carried from DR-0016 (and honoured identically for every source):
 * never manufacture a code, onset, or risk number; imported facts are attributed `prov: 'record'`;
 * negated / "no known history" and narrative-only entries are surfaced for review, never fabricated
 * into positive conditions; non-genetic relatives (in-law / step / adoptive / foster / spouse) are
 * never auto-attached to genetic parentage.
 *
 * Layering: this module lives in `src/import/` and imports **only** from `domain` — never from
 * `store`, `ui`, or `integrations`. The long-tail condition shape is the shared
 * {@link conditionFromCode} in `domain/catalog`, so no `import → integrations` dependency is needed.
 */
import type {
  AllergyInfo,
  Coding,
  Condition,
  ConditionEntry,
  EventType,
  FamilyRecord,
  Gender,
  ImmunizationInfo,
  Measurement,
  MedicationInfo,
  PartialDate,
  Person,
  Sab,
} from '@/domain/types';
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
 * One coded (or narrative-only) problem parsed from a health record. `coded` holds the single
 * preferred (system, code) pair — ICD-10-CM is preferred over SNOMED-CT so the catalog's ICD-10
 * index (with its 3-character-category fallback) gets first crack; legacy / unsupported systems and
 * uncoded entries resolve to `system: null` and are surfaced for review, never crosswalked or
 * fabricated. `onsetYear` is the **age at onset in years**, or `null` — never invented / defaulted
 * to 0.
 */
export interface ProblemEntry {
  parseId: string;
  coded: { system: 'ICD-10-CM' | 'SNOMED-CT' | null; code: string | null; displayName: string };
  onsetYear: number | null;
}

/** One relative parsed from the family-history portion of a health record. */
export interface RelativeEntry {
  parseId: string;
  name: string | null;
  /** Sex assigned at birth — never inferred from a sex-neutral relationship code (guardrail #4). */
  sab: Sab;
  /** Relationship as an HL7 v3 RoleCode (upper-cased, e.g. `'MTH'`) — the vocabulary the
   * conservative auto-placement matches against. */
  relationshipCode: string;
  relationshipDisplay: string;
  birthYear: number | null;
  death: { year: number | null; dead: boolean | null };
  problems: ProblemEntry[];
}

/**
 * One dated, non-diagnosis health event parsed from a record (Wave 2/3 full-timeline import) — a
 * medication, lab, vital, genetic test-of-record, immunization, allergy, procedure, or visit. The
 * source-agnostic engine stages and applies these identically for every importer; the per-source
 * parser (FHIR today) owns the mapping into this shape. A resource with no usable date is DROPPED at
 * parse and never reaches here (`year` is required, never fabricated — guardrail #1).
 */
export interface ParsedEvent {
  /** Deterministic dedup identity, e.g. `"fhir:MedicationStatement:<id>"`. */
  parseId: string;
  type: Exclude<EventType, 'diagnosis' | 'screening'>;
  year: number;
  /** Higher-precision echo of `year` when the source gave one; its year component equals `year`. */
  date?: PartialDate;
  title: string;
  detail: string;
  /** Verified-system codings only, verbatim; `[]` when none (normalized to `undefined` on apply). */
  coding: Coding[];
  med?: MedicationInfo;
  lab?: Measurement;
  vital?: Measurement;
  allergy?: AllergyInfo;
  immunization?: ImmunizationInfo;
  /** Interim status OR a blanket-default-off type (Encounter, genetic) → surfaced needs-review. */
  needsReview: boolean;
}

/** A parsed event reconciled against the live timeline (dedup by `parseId`). */
export interface StagedEvent {
  parseId: string;
  type: Exclude<EventType, 'diagnosis' | 'screening'>;
  year: number;
  date?: PartialDate;
  title: string;
  detail: string;
  coding: Coding[];
  med?: MedicationInfo;
  lab?: Measurement;
  vital?: Measurement;
  allergy?: AllergyInfo;
  immunization?: ImmunizationInfo;
  /** `'new'` = not already on the timeline & importable; `'duplicate'` = already imported (by id);
   * `'needs-review'` = interim/blanket-default-off (defaults OFF). */
  status: 'new' | 'duplicate' | 'needs-review';
  defaultSelected: boolean;
}

/** The structural result of parsing a health record, before reconciliation against the live record. */
export interface ParsedHealthRecord {
  proband: { problems: ProblemEntry[]; events: ParsedEvent[] };
  familyMembers: RelativeEntry[];
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
 * {@link applyHealthRecordImport} needs to build the {@link Person} (apply does not re-read `parsed`). */
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

/** The full staged import: proband conditions + reconciled relatives + timeline events + warnings. */
export interface StagedHealthRecordImport {
  probandConditions: StagedCondition[];
  familyMembers: StagedFamilyMember[];
  events: StagedEvent[];
  warnings: string[];
}

/** Per-relative override the review UI supplies for an ambiguous item. */
export interface MemberOverride {
  /** Reconcile this relative into an existing person instead of adding a new one. */
  matchedPersonId?: string | null;
  /** Manual placement chosen for an otherwise-unplaced relative. */
  placement?: { anchorId: string; relation: Relation } | null;
}

/** The user's accept/override set: which `parseId`s are checked, plus per-relative overrides. */
export interface HealthRecordSelections {
  /** `parseId`s the user has checked to import (both condition and family-member ids). */
  selectedParseIds: ReadonlySet<string>;
  /** Placement / match overrides for ambiguous relatives, keyed by member `parseId`. */
  overrides?: Readonly<Record<string, MemberOverride>>;
}

// ---------------------------------------------------------------------------
// Conservative auto-placement sets (DR-0017). Anything not covered here is surfaced ambiguous.
// ---------------------------------------------------------------------------

const PARENT_CODES = new Set(['MTH', 'FTH', 'NMTH', 'NFTH']);
const SIBLING_CODES = new Set(['BRO', 'SIS', 'NBRO', 'NSIS', 'SIB', 'TWINBRO', 'TWINSIS']);
// Biological/natural children only — SON, DAU (natural son/daughter) and NCHILD (natural child)
// carry genetic offspring geometry. The generic HL7 codes CHILD, SONC, and DAUC subsume adopted,
// foster, and step children, so auto-placing them into genetic parentage could corrupt the
// inheritance geometry; they fall through to `ambiguous` and are surfaced for a manual choice.
// (Parents and siblings intentionally keep their generic MTH/FTH/BRO/SIS per the Family History
// section convention that a listed parent/sibling is the genetic one — that asymmetry is on
// purpose: a generic "child" is far likelier to be non-genetic than a generic "mother".)
const CHILD_CODES = new Set(['SON', 'DAU', 'NCHILD']);
/** Side-specified grandparents: parent of the proband's existing mother (`'f'`) or father
 * (`'m'`) — placed only when that linking parent already exists in the record. */
const SIDED_GRANDPARENT: Record<string, Sab> = {
  MGRMTH: 'f',
  MGRFTH: 'f',
  PGRMTH: 'm',
  PGRFTH: 'm',
};

// ---------------------------------------------------------------------------
// Shared terminology constants + helpers (source-agnostic; consumed by every importer).
//
// Hoisted here from `ccda.ts` (DR-0020) so the C-CDA and FHIR importers read from one definition
// rather than each maintaining a drifting copy. Behaviour is identical to the prior C-CDA-local
// definitions; only the location changed.
// ---------------------------------------------------------------------------

/**
 * Absence / "no known history" SNOMED CT concepts that must NEVER become a positive condition
 * (guardrail #1), even absent an explicit negation flag — e.g. "No family history of ...". A code
 * asserting absence is excluded from positive facts and counted, never staged.
 */
export const ABSENCE_SNOMED = new Set(['160266009', '160245001']);

/**
 * HL7 v3 RoleCode → sex assigned at birth, for the sex-SPECIFIC codes ONLY. A sex-neutral code
 * (SIB, PRN, CHILD, GRPRN, COUSN, ...) is deliberately absent, so it resolves to `'u'` — sab is
 * never inferred from a neutral role (guardrail #4).
 */
export const CODE_SAB: Record<string, Sab> = {
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

/** Best-effort display fallback when a relationship code carries no `displayName`. */
export const RELATIONSHIP_LABELS: Record<string, string> = {
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
  SONC: 'Son',
  DAUC: 'Daughter',
  CHILD: 'Child',
  NCHILD: 'Child',
  GRMTH: 'Grandmother',
  GRFTH: 'Grandfather',
  GRPRN: 'Grandparent',
  MGRMTH: 'Maternal grandmother',
  MGRFTH: 'Maternal grandfather',
  PGRMTH: 'Paternal grandmother',
  PGRFTH: 'Paternal grandfather',
  GGRMTH: 'Great-grandmother',
  GGRFTH: 'Great-grandfather',
  AUNT: 'Aunt',
  UNCLE: 'Uncle',
  MAUNT: 'Maternal aunt',
  PAUNT: 'Paternal aunt',
  MUNCLE: 'Maternal uncle',
  PUNCLE: 'Paternal uncle',
  NIECE: 'Niece',
  NEPHEW: 'Nephew',
  COUSN: 'Cousin',
  MTHINLAW: 'Mother-in-law',
  FTHINLAW: 'Father-in-law',
  STPMTH: 'Stepmother',
  STPFTH: 'Stepfather',
  FSTRMTH: 'Foster mother',
  FSTRFTH: 'Foster father',
  WIFE: 'Wife',
  HUSB: 'Husband',
};

/** Year from a timestamp/date string (CDA `YYYY`/`YYYYMMDD…` or FHIR ISO `YYYY-MM-DD`), or `null`. */
export function yearFromTs(value: string): number | null {
  const m = /^(\d{4})/.exec(value.trim());
  if (!m) return null;
  const y = Number.parseInt(m[1], 10);
  return Number.isSafeInteger(y) ? y : null;
}

/**
 * Convert an age value + UCUM unit to whole years, or `null`. An age is already an age — used
 * directly (guardrail #1: never invented). Negative ages are rejected.
 */
export function ageToYears(value: string, unit: string): number | null {
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
// stageHealthRecordImport
// ---------------------------------------------------------------------------

/**
 * Input to {@link stageHealthRecordImport}. Structurally a {@link ParsedHealthRecord} except that
 * `proband.events` is OPTIONAL here: the C-CDA importer (and any family-history-only parse) has no
 * timeline events and may omit the field entirely — it defaults to none. {@link parseFhirImport}
 * always supplies it. Keeping the engine's input tolerant is what makes the Wave 2/3 `events`
 * addition backward-compatible for every pre-existing caller (guardrail: additive, never breaking).
 */
export type ParsedHealthRecordInput = Omit<ParsedHealthRecord, 'proband'> & {
  proband: { problems: ProblemEntry[]; events?: ParsedEvent[] };
};

/**
 * Reconcile a {@link ParsedHealthRecord} against the live record and catalog: resolve each problem
 * to a catalog id (or a long-tail / needs-review suggestion), flag proband-condition duplicates, and
 * assign each relative a conservative placement + match status. Read-only over the record — it
 * mutates nothing and returns the suggestions the review UI renders. Pure and deterministic.
 */
export function stageHealthRecordImport(
  parsed: ParsedHealthRecordInput,
  record: FamilyRecord,
  catalog: Catalog,
): StagedHealthRecordImport {
  const idx = indexPeople(record.people, record.unions);
  const proband = record.people.find((p) => p.id === record.probandId);
  const probandCondIds = new Set((proband?.conds ?? []).map((c) => c.id));

  const probandConditions = parsed.proband.problems.map((e) =>
    stageCondition(e, catalog, probandCondIds),
  );
  const familyMembers = parsed.familyMembers.map((m) => stageFamilyMember(m, record, idx, catalog));

  const timelineIds = new Set(record.timeline.map((t) => t.id));
  const events = (parsed.proband.events ?? []).map((e) => stageEvent(e, timelineIds));

  return { probandConditions, familyMembers, events, warnings: [...parsed.warnings] };
}

/**
 * Reconcile one parsed event against the ids already on the timeline: a matching `parseId` is a
 * `'duplicate'` (re-sync of a prior import); otherwise a `needsReview` event is `'needs-review'`
 * (interim / blanket-default-off) and everything else is `'new'`. Only `'new'` defaults selected.
 */
function stageEvent(e: ParsedEvent, timelineIds: ReadonlySet<string>): StagedEvent {
  const status: StagedEvent['status'] = timelineIds.has(e.parseId)
    ? 'duplicate'
    : e.needsReview
      ? 'needs-review'
      : 'new';
  return {
    parseId: e.parseId,
    type: e.type,
    year: e.year,
    date: e.date,
    title: e.title,
    detail: e.detail,
    coding: e.coding,
    med: e.med,
    lab: e.lab,
    vital: e.vital,
    allergy: e.allergy,
    immunization: e.immunization,
    status,
    defaultSelected: status === 'new',
  };
}

/** Resolve one parsed problem against the catalog + a target person's existing condition ids. */
function stageCondition(
  e: ProblemEntry,
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
    // Narrative-only (uncoded / legacy / other terminology) — nothing to attach automatically.
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
  m: RelativeEntry,
  record: FamilyRecord,
  idx: PeopleIndex,
  catalog: Catalog,
): StagedFamilyMember {
  const probandId = record.probandId;
  const placement = autoPlacement(m.relationshipCode, probandId, idx);

  let matchStatus: StagedFamilyMember['matchStatus'];
  let matchedPersonId: string | null = null;
  let candidates: { personId: string; name: string; rel: string }[] = [];

  const asCandidate = (p: Person): { personId: string; name: string; rel: string } => ({
    personId: p.id,
    name: p.name,
    rel: relationInfo(idx, p.id, probandId).rel,
  });

  if (placement) {
    const samePos = personsAtPosition(idx, placement);
    const norm = normName(m.name);
    const sameName = norm ? samePos.filter((p) => normName(p.name) === norm) : [];
    if (sameName.length === 1) {
      // Exactly one same-position person shares this name — an unambiguous merge target.
      matchStatus = 'matched-existing';
      matchedPersonId = sameName[0].id;
    } else if (sameName.length > 1) {
      // Two or more same-position people share the identical normalised name — never silently
      // attach to whichever appears first in traversal order; surface all of them to reconcile.
      matchStatus = 'ambiguous';
      candidates = sameName.map(asCandidate);
    } else if (samePos.length) {
      // Same-position people exist but none is a confident name match — reconcile manually.
      matchStatus = 'ambiguous';
      candidates = samePos.map(asCandidate);
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
// applyHealthRecordImport
// ---------------------------------------------------------------------------

/**
 * Merge the user-accepted subset of a {@link StagedHealthRecordImport} into `record`, returning a
 * complete new {@link FamilyRecord} (built via {@link linkRelative} + {@link layoutFromGraph},
 * like the GEDCOM importer) and the long-tail {@link Condition} extensions to register through
 * the store's `sanitizeExtensions` boundary. Pure — the input record is never mutated. Only
 * checked items apply; ambiguous relatives apply only when the UI supplied a placement/match
 * override, and are otherwise skipped. Conditions attach with `prov: 'record'`, dedup-safe;
 * onset is taken verbatim from staging (never invented).
 */
export function applyHealthRecordImport(
  record: FamilyRecord,
  staged: StagedHealthRecordImport,
  selections: HealthRecordSelections,
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

  // --- Proband timeline events (Wave 2/3) ---
  // Push each selected, non-duplicate staged event onto the record timeline, attributed to the
  // record (`prov: 'record'`) and the proband. Deduped by id even if the UI passed a duplicate, and
  // applied ONLY when the proband Person actually resolves (the events belong to the proband).
  const probandForEvents = next.people.find((p) => p.id === next.probandId);
  if (probandForEvents) {
    const existingEventIds = new Set(next.timeline.map((e) => e.id));
    for (const ev of staged.events) {
      if (!selected.has(ev.parseId)) continue;
      if (ev.status === 'duplicate') continue;
      if (existingEventIds.has(ev.parseId)) continue;
      existingEventIds.add(ev.parseId);
      next.timeline.push({
        id: ev.parseId,
        person: next.probandId,
        year: ev.year,
        date: ev.date,
        type: ev.type,
        title: ev.title,
        detail: ev.detail,
        coding: ev.coding.length ? ev.coding : undefined,
        med: ev.med,
        lab: ev.lab,
        vital: ev.vital,
        allergy: ev.allergy,
        immunization: ev.immunization,
        prov: 'record',
      });
    }
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
