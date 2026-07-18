<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — SMART-on-FHIR full-timeline import (construction → merge)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0025 |
| `transition`   | `construction-to-merge` |
| `chosen_option`| `approve` |
| `target`       | `main` |
| `unit_of_work` | smart-fhir-timeline-import |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-18 |
| `risk_tier`    | high-risk (externally-sourced clinical timeline into the record; additive domain-model uplift; guardrail #1 measurement/range handling) |

## What merges

The full-timeline SMART-on-FHIR import (DR-0023/DR-0024), built additively over seven waves:

- **W1 Domain**: `PartialDate` (ISO-8601 partial), `Coding`, and additive `TimelineEvent.date/prov/coding`,
  `ConditionEntry.onsetDate`, `Person.birthDate/deathDate`; `src/domain/dates.ts`; validation extended
  (precise date's year-component must equal its coarse sibling). Existing records validate unchanged.
- **W2/W3 Import**: `ParsedEvent`/`StagedEvent` event path through the merge-review engine (deterministic
  `fhir:<Type>:<id>` dedup, `prov:'record'`), and per-resource FHIR mappers (Medication×2, Observation
  lab/vital/genetic, Immunization, AllergyIntolerance, Procedure, Encounter) with Condition-parity status
  gating, absence handling, explicit-date-only, reference-range-from-source-only (never a flag), genetic
  fact-of-test-only. `src/data/fhir-codes.ts`.
- **W4 Gateway**: the full resource search set with `_include` medication resolution and per-search
  resilience (warn, not abort); `BASE_SCOPES` broadened in lockstep so per-resource-scope enforcers (Epic)
  don't reject the reads.
- **W5 UI**: a source-agnostic "Health events" review section grouped by type.
- **W6 UI**: optional exact-date entry (person/condition/event) via `PartialDateFields`.
- **W7 Export**: precise-date emission (FHIR/GEDCOM) when present, else the coarse year.

## Review gate — all clear (after a fix wave)

| Reviewer | Verdict |
| --- | --- |
| `code-reviewer` | **APPROVE** (re-verified all findings fixed, oracle not weakened) |
| `clinical-safety-reviewer` | **CLEAR** (no guardrail violations; reference-range/genetic/absence/date handling verified) |
| `security-privacy-reviewer` | **APPROVE** (patient-id URL leak in `fetchWarnings` closed + regression test; no new egress/deps) |
| `medical-domain-expert` | **APPROVE** (dispositions faithful to the verified value sets) |
| `accessibility-reviewer` | **APPROVE** (the 2.4.3 focus-loss blocker on `PartialDateFields` fixed + tested) |

## Findings fixed before merge

Patient-id/URL leak in `fetchWarnings` → error message sanitized (+regression test); `PartialDateFields`
disclosure focus loss (WCAG 2.4.3) → focus-on-open / return-on-close; `medicationReference` resolved via
`entry.fullUrl`/`urn:uuid` (Epic pattern), not just `Medication.id`; `valueQuantity` with only a UCUM
`code` now imported (code fallback); "missing an identifier" vs "missing a usable date" warnings
separated; **`BASE_SCOPES` broadened** to request every resource the gateway now reads (without which the
import silently fails on strict per-resource-scope servers). Two previously-uncommitted W6 form test files
committed.

## Codes-always invariant — satisfied, recorded (not silently dropped)

DR-0023's "codes always stored" holds: a condition's code lives on the resolved catalog `Condition`
(curated `icd10`/`snomed`) or the `conditionFromCode` long-tail extension — retained end-to-end whether
picked via the in-app ICD-10 search or imported; timeline events carry the new `coding` carrier
(import-populated today). No `ConditionEntry.coding` field is needed.

## Verification

`npm run check` green — **1133 tests** (955 domain/W1 baseline growth + import/gateway/UI/export waves +
33 fix-wave regression tests), deterministic. `GITHUB_PAGES=true npm run build` succeeds. The pure
`src/import/*` mappers and the OAuth/token invariants are independently test-owned.

## Next gate

`to-operations` — release/publish authorization (DR-0026).
