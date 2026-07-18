<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — SMART-on-FHIR full-timeline import architecture (design fork)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0024 |
| `transition`   | `design-fork` |
| `chosen_option`| `approve` |
| `target`       | `construction` |
| `unit_of_work` | smart-fhir-timeline-import |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-18 |
| `risk_tier`    | high-risk (new domain fields; externally-sourced timeline facts; guardrail #1 measurement/range handling; broad blast radius across types/validation/import/export/UI) |

## Approved design (software-architect)

- **Domain (additive, backward-compatible)** in `src/domain/types.ts`: `Coding {system;code;display?}`;
  `PartialDate` = ISO-8601 partial string (`"YYYY"`|`"YYYY-MM"`|`"YYYY-MM-DD"`); `TimelineEvent`
  gains `date?`, `prov?`, `coding?`; `ConditionEntry` gains `onsetDate?`; `Person` gains
  `birthDate?`/`deathDate?`. New pure `src/domain/dates.ts` (`isPartialDate`, `yearOfPartialDate`,
  `formatPartialDate` — parse components, never `new Date(str)`, to avoid the TZ off-by-a-day trap).
  `record.ts` validation extended additively; a precise date's year-component MUST equal its coarse
  sibling (`year`/`birth`/`death`); `onsetDate` is shape-only (onset is an age). `eventProv()` reads
  the `undefined→'self'` default in one place. Existing persisted records + the 871 tests validate
  unchanged.
- **Pipeline (net-new event path)**: `ParsedEvent`/`StagedEvent` + `ParsedHealthRecord.proband.events`
  / `StagedHealthRecordImport.events` in `src/import/health-record.ts`; deterministic
  `parseId = "fhir:<ResourceType>:<id>"` (identity dedup, re-sync safe; a resource with no `id` is
  dropped + warned, never randomly id'd); `stageEvent` (new/duplicate/needs-review, default-OFF for
  needs-review + duplicate); `applyHealthRecordImport` writes selected events into `record.timeline`
  with `prov:'record'`, deduped by id. `ccda.ts` sets `proband.events: []` (TS-enforced).
- **Parsers** `src/import/fhir.ts`: per-resource mappers (MedicationStatement/Request→medication,
  Observation lab/vital→lab/vital, Observation genomic→genetic fact-of-test-only, Immunization,
  AllergyIntolerance, Procedure, Encounter→visit), reusing status-gating/absence/explicit-date
  patterns. Verified-system codings only (`RXNORM/CVX/LOINC/SNOMED/ICD10CM`) into `coding[]`;
  CPT/HCPCS/NDC display-only narrative. New shared `src/data/fhir-codes.ts` constants (data layer,
  importable by both `import/` and `integrations/`).
- **Gateway** `src/integrations/smart-fhir/gateway.ts`: expand to the full resource set; per-search
  `try/catch` + `Promise.all` so one failing search degrades to a `fetchWarnings` entry instead of
  aborting the whole sync (reusing the same-origin-guarded pagination verbatim). `handleSync`
  "nothing found" gate counts events.
- **Review UI** `src/ui/components/CcdaReview.tsx`: a source-agnostic "Health events" section grouped
  by type, per-event checkboxes, `StatusBadge` generalized; imported reference range shown verbatim
  as "Reference range (from this record): …" — **never** an in/out-of-range flag (guardrail #1 /
  DR-0004). `initialSelection`/`selectedTopLevel`/`totalTopLevel` extended so an events-only import
  can be confirmed. Single `ClinicalBoundary` covers the surface.

## Arbiter decisions on the surfaced residuals

- **Partial-failure resilience — APPROVE.** One failing resource search must warn, not abort the
  whole sync; this deliberately also changes the pre-existing Condition/FamilyMemberHistory behavior.
  A decision-support tool must not silently lose everything because one endpoint is unavailable.
- **`medicationReference` — RESOLVE, do NOT drop.** The design proposed dropping meds that use
  `medicationReference` instead of `medicationCodeableConcept`. That fails the "ingest everything"
  directive. Instead: the medication searches request `_include=MedicationRequest:medication` /
  `_include=MedicationStatement:medication` so the referenced `Medication` resources come back in the
  same bundle, and the parser resolves the reference **within the bundle** (included/contained) — no
  extra round-trip. Only a genuinely unresolvable reference → narrative/needs-review, never silent drop.
- **No-date resources — drop with a counted warning** (`TimelineEvent.year` is required; no
  unknown-year representation). Confirmed as the "or drop" branch DR-0023 permitted.
- **Genetic/genomic Observations** — imported as fact-of-test-only `genetic` events (needs-review);
  the parser never reads `value[x]`/`interpretation`/`component` (no pathogenicity/risk). The exact
  category/LOINC identification is delegated to `medical-coder` verification before coding.
- **Exact-date UI entry + export emission are IN SCOPE for this unit** (the maintainer's "everything,
  no deferral" + "the UI needs it anyway"): sequenced after the core import/model, but delivered in
  this same effort — read-only display first, then editable entry in the person/condition/event
  forms, then precise-date emission in the FHIR/GEDCOM/ICS exporters (additive: prefer precise, fall
  back to coarse).
- **GEDCOM *import* date-precision — deferred (recorded scope cut).** GEDCOM's `ABT/BEF/AFT`/range
  date grammar doesn't reduce cleanly to `PartialDate`; conflating it with the clean ISO/HL7-v3
  sources is scope-creep. GEDCOM export of precise dates is still in scope.

## Guardrail commitments

No manufactured value/range/flag; imported reference ranges are the source lab's own numbers,
verbatim, attributed `prov:'record'`, never a Stemma default or a computed in/out-of-range flag.
Genomic interpretation never imported. Pure/deterministic parser. Clinical boundary on the review
surface. Full review gate (`code` + `clinical-safety` + `security-privacy` + `medical-domain` +
`accessibility`) before merge.

## Next gate

`construction-to-merge` (DR-0025).
