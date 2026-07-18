<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — SMART-on-FHIR full-timeline import (inception → construction)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0023 |
| `transition`   | `inception-to-construction` |
| `chosen_option`| `approve` |
| `target`       | `construction` |
| `unit_of_work` | smart-fhir-timeline-import |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-18 |
| `risk_tier`    | high-risk (externally-sourced clinical facts → the record's timeline; new domain fields on `TimelineEvent`; touches guardrail #1 on measurements/reference ranges and guardrail #3 boundary) |

## Problem

The shipped SMART-on-FHIR import (DR-0019..DR-0022) ingests only Patient/Condition/
FamilyMemberHistory. The maintainer directs that **everything the app's data model can hold
MUST be ingested — no deferral, no stub**. Stemma's `TimelineEvent` model holds medications,
labs, vitals, immunizations, allergies, procedures, visits, and genetic events; none of these are
imported today. The parse→stage→apply→review pipeline is **conditions-and-relatives only** — so
timeline import is a net-new capability end to end.

## Scope approved (maintainer) — ingest every EventType that has a domain home

- **Medications** (`MedicationStatement` + `MedicationRequest`) → `medication` events.
- **Labs** (`Observation` category `laboratory`) → `lab` events + `Measurement`.
- **Vitals** (`Observation` category `vital-signs`) → `vital` events + `Measurement`.
- **Immunizations** (`Immunization`) → `immunization` events.
- **Allergies** (`AllergyIntolerance`) → `allergy` events.
- **Procedures** (`Procedure`) → `procedure` events.
- **Visits** (`Encounter`) → `visit` events — **supported, but default-OFF (needs-review)** in the
  merge review, because a full encounter history is high-noise; the capability exists (nothing is
  skipped), the user opts in per item.
- **Genetic** (genomic `Observation`) → `genetic` event recording **only that a test occurred**
  (needs-review). A variant pathogenicity call / classification / risk is **never** imported as a
  structured fact (guardrail #1).

### Two additive domain changes (required, gating)

1. **`TimelineEvent` gains provenance** so imported events carry `prov: 'record'` and are
   distinguishable from user-entered ones (today only `ConditionEntry` has `prov`). Existing events
   are treated as `'self'`. Additive/optional — backward compatible.
2. **`TimelineEvent` gains a source-agnostic coding carrier** (`{ system; code; display? }[]`, the
   `ProblemEntry.coded`/`FhirCoding` precedent) so RxNorm/CVX/LOINC/SNOMED/UCUM codes are preserved
   verbatim rather than dropped or crammed into free text. Additive/optional.

The `software-architect` finalizes the exact type shape; both are validated in `isValidEvent`.

### Two further scope additions (maintainer, mid-inception)

3. **Exact dates, not just year.** Date fields must support a full date (Y-M-D), not only a bare
   year — precise dates arrive via the import paths and the UI needs entry. Delivered **additively**:
   the coarse `year` (and `Person.birth`/`death`, `ConditionEntry.onset`) stays as the always-present
   value existing consumers read unchanged; an optional `PartialDate` (ISO-8601 that may be year,
   year-month, or full date — source precision preserved, never fabricated to a false day) is added
   alongside on `TimelineEvent`, `ConditionEntry.onset`, and `Person.birth`/`death`. Imports populate
   it when the source carries a date; exports emit it when present; UI gains date entry. Helpers derive
   `year` and format for display. Backward-compatible.
4. **Codes always stored, every entry path.** The coding carrier is populated not only by FHIR import
   but whenever the user picks a code via the in-app ICD-10 / vocabulary search — the true code is an
   invariant: always available once chosen.

### Clinical rules carried into Construction (from medical-domain-expert)

- **Reference ranges**: import `Observation.referenceRange.low/high` **only** when exactly one range
  applies and its unit matches the value's unit; take numeric bounds verbatim; **never** ship a
  Stemma default range, synthesize a missing bound, unit-convert, or emit an in/out-of-range flag
  (DR-0004 holds). Only `valueQuantity` populates the numeric `Measurement`; other `value[x]` →
  narrative.
- **Status gating mirrors the Condition stance**: settled (`final`/`completed`/`confirmed`) → import;
  interim/unverified → needs-review default OFF; `entered-in-error` → dropped silently, never counted;
  absence/not-done/not-taken/`refuted` → surfaced/counted, never a positive event.
- **Explicit-date-only year**: `TimelineEvent.year` derived solely from an explicit source date;
  no wall clock, no default year — no date ⇒ needs-review or drop.
- `medication.ongoing` from status (not date presence); allergy severity from `reaction[].severity`
  (not `criticality`); genomic interpretation never imported.

## Non-goals (this unit)

`Observation` social-history (no matching `EventType` — no domain home); importing a genetic
variant interpretation/pathogenicity/risk; attachment BYTES (only `AttachmentRef` metadata, per the
existing contract); a curated medication/lab catalog (codes preserved verbatim, two-layer model
deferred); FHIR *export* of timeline resources; write-back.

## Guardrail commitments

Guardrail #1 (no manufactured fact/number/range/flag), #3 (clinical-boundary on the new review
surface), #5 (the egress is unchanged — same opt-in SMART call, just more resource types fetched
from the user's own endpoint). Imported timeline facts carry `prov: 'record'`. Pure/deterministic
parser (no clock/network/random; deterministic event ids). `code-reviewer` +
`clinical-safety-reviewer` + `security-privacy-reviewer` + `medical-domain-expert` +
`accessibility-reviewer` all clear before merge.

## Next gate

`design-fork` — architect + planner design and sequence approved (DR-0024).
