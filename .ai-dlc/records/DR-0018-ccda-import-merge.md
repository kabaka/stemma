<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — C-CDA (CCD) import (construction → merge + operations)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0018 |
| `transition`   | `construction-to-merge` |
| `chosen_option`| `approve` |
| `target`       | `main` |
| `unit_of_work` | ccda-import |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-18 |
| `risk_tier`    | high-risk (externally-sourced clinical data → conditions/family-history/provenance; in-browser XML parsing; first merge-into-live-record import) |

## Rationale

Implements DR-0016 (inception) and DR-0017 (design fork) on branch
`claude/provider-portal-import-mgypqm`. Delivered a pure, client-side **C-CDA (CCD)
file-drop importer** — the ONC 170.315(e)(1) "Download My Record" file every certified
EHR must offer — chosen over a live SMART-on-FHIR pull, which needs a broker/proxy and
would break the local-first guardrail (parked in ROADMAP Phase 5).

- **Core** (`src/import/ccda.ts`): pure/deterministic/never-throw `parseCcda` (DOMParser,
  no new dependency) → `stageCcdaImport` (read-only matching over the live record) →
  `applyCcdaImport` (pure merge → complete new `FamilyRecord`), reusing the validating
  `replaceRecord` boundary (no store changes). Problem Section → proband conditions;
  Family History Section → relatives. Code priority ICD-10-CM → SNOMED → long-tail →
  never crosswalk/fabricate. Conservative relationship auto-placement (biological
  parents/siblings/children + side-specified grandparents-when-parent-exists only;
  everything ambiguous surfaced for manual placement). Domain reverse-index
  `Catalog.byCode` + shared `conditionFromCode` (generalized, no bolt-on).
- **UI** (`CcdaImport` + `CcdaReview`): local `.xml` picker (nothing uploaded) →
  per-item merge-with-review checklist with an ambiguous-relative anchor+relation
  resolver → `replaceRecord(..., 'Imported from health record (C-CDA)')`. Clinical
  boundary first-class. Wired into `PedigreeView` alongside GEDCOM import.
- Imported conditions carry provenance `'record'`; negated/absence and narrative-only
  entries never become positive conditions; no manufactured onset/code/risk number.

## Gates cleared

- **Design grounded:** `software-architect` (layered design, Option A merge) +
  `medical-domain-expert` (verified C-CDA template OIDs, HL7 v3 RoleCode → sab/pedigree
  mapping, code-system priority, negation semantics).
- **Independent oracle:** `test-engineer` — 47 core tests (mutation-checked), catalog
  primitives, and end-to-end UI flow + a11y tests; the UI oracle caught a real
  confirm-button defect (fixed). Implementer never edited the oracle.
- **Review gate (all APPROVE):** `code-reviewer` (correctness/spec-conformance),
  `clinical-safety-reviewer` (guardrails/layering/determinism),
  `security-privacy-reviewer` (XXE/DOCTYPE rejection, no exfiltration, no new dep, no
  prototype-pollution), `accessibility-reviewer` (2 blockers fixed: compounded-opacity
  contrast, heading-level skip), `medical-domain-expert` (mapping fidelity — one
  must-fix, the generic-`CHILD` auto-placement, fixed).
- **Fixes applied + re-reviewed:** `CHILD_CODES` narrowed to biological `{SON,DAU,NCHILD}`;
  same-name collision → ambiguous; negation/absence also scans `value/translation`;
  injectable parse caps (production defaults 5000/2000 unchanged) so truncation is tested
  without slow giant fixtures; ADR-009 + ROADMAP companions; confirm-button gates on
  importable-selection count. `code-reviewer` + `clinical-safety-reviewer` re-review both
  **APPROVE**, no regressions.
- **`npm run check` green — 703 tests**, lint/typecheck/format clean. UI flow verified in
  `npm run dev` (frontend-engineer). ADR-009 recorded in `docs/ARCHITECTURE.md`.

## To-operations authorization

Authorized to publish. On merge to `main`, the GitHub Pages workflow rebuilds and
deploys the static site. `transition: to-operations`, `target: deploy`,
`chosen_option: approve`, approver kabaka, 2026-07-18, high-risk. Pure client-side
feature, no new runtime network call, no secrets/CI changes.

## Deferred follow-ups (non-blocking; surfaced in review)
- Apple Health export ZIP (`export_cda.xml` reuses this C-CDA parser).
- Curated SNOMED→ICD-10 bridge for high-signal hereditary conditions to raise match
  yield on SNOMED-primary problem lists (real-world FH coding is often SNOMED-only).
- Long-tail code → curated-concept alias so an imported ICD-10 long-tail can drive
  detection (existing ROADMAP §7 follow-up; this import is a forcing function).
- Live SMART-on-FHIR pull remains Phase 5 (needs a broker/proxy; CORS reality).
