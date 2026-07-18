/**
 * FHIR terminology constants for the SMART-on-FHIR importer — the **data-layer** single source of
 * truth for the code-system URIs and category tokens the pure `import/fhir.ts` parser reads against.
 *
 * Layering: this lives in `src/data/` (importable by both `import/` and `integrations/`), so the
 * gateway (`integrations/smart-fhir/`) and the parser (`import/fhir.ts`) share one definition of the
 * verified systems and search categories rather than each carrying a drifting copy.
 *
 * Every URI is the real one a conformant FHIR R4 / US Core server emits — never invented. Only the
 * five terminologies Stemma's catalog and payloads actually understand are "verified": a coding in
 * any other system is preserved as narrative text, never crosswalked or surfaced as a structured
 * code (guardrail #1 — never manufacture a code).
 */

/** Canonical code-system URIs (FHIR R4 / US Core). */
export const SYS = {
  ICD10CM: 'http://hl7.org/fhir/sid/icd-10-cm',
  SNOMED: 'http://snomed.info/sct',
  RXNORM: 'http://www.nlm.nih.gov/research/umls/rxnorm',
  CVX: 'http://hl7.org/fhir/sid/cvx',
  LOINC: 'http://loinc.org',
  UCUM: 'http://unitsofmeasure.org',
  ICD9CM: 'http://hl7.org/fhir/sid/icd-9-cm',
  CPT: 'http://www.ama-assn.org/go/cpt',
  HCPCS: 'http://www.cms.gov/Medicare/Coding/HCPCSReleaseCodeSets',
  NDC: 'http://hl7.org/fhir/sid/ndc',
  V2_0074: 'http://terminology.hl7.org/CodeSystem/v2-0074',
} as const;

/**
 * The code systems whose codings land verbatim in a {@link import('@/domain/types').Coding}[]. A
 * coding in any other system (CPT / HCPCS / NDC / ICD-9-CM / proprietary) is excluded from the
 * structured code list and routed to narrative — never crosswalked (guardrail #1).
 */
export const VERIFIED_CODE_SYSTEMS: ReadonlySet<string> = new Set([
  SYS.RXNORM,
  SYS.CVX,
  SYS.LOINC,
  SYS.SNOMED,
  SYS.ICD10CM,
]);

/** `Observation.category` tokens (`http://terminology.hl7.org/CodeSystem/observation-category`). */
export const OBS_CATEGORY = {
  LAB: 'laboratory',
  VITAL: 'vital-signs',
  SOCIAL: 'social-history',
} as const;

/**
 * Genetic LOINC concepts that classify an `Observation` as a genomic test-of-record even absent a
 * `v2-0074|GE`/`CG` category tag (no universal `category=genomics` code exists — do not invent one).
 * A genetic Observation is fact-of-test only: its value / interpretation / components are never read.
 */
export const GENETIC_LOINC: ReadonlySet<string> = new Set([
  '69548-6',
  '48004-6',
  '81290-9',
  '81291-7',
  '48013-7',
]);
