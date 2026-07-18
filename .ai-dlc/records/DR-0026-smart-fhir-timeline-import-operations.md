<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — SMART-on-FHIR full-timeline import (→ operations / deploy)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0026 |
| `transition`   | `to-operations` |
| `chosen_option`| `approve` |
| `target`       | `deploy` |
| `unit_of_work` | smart-fhir-timeline-import |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-18 |
| `risk_tier`    | high-risk |

## Authorization

The maintainer directed this be delivered through publish ("PR → merge → deploy… everything the app
should ingest MUST be supported"). Merging `smart-fhir-timeline-import` to `main` triggers
`.github/workflows/deploy.yml` (build with `GITHUB_PAGES=true` → GitHub Pages publish to
`https://kabaka.github.io/stemma/`). This record authorizes that release.

## Operational notes

- **No new runtime dependency**, no server, no CSP change (the additional reads are same-origin to the
  user's already-authorized FHIR base). No persisted-schema break — the new fields are additive/optional,
  and old records validate unchanged.
- **New egress** is still opt-in and only to the user's chosen provider endpoint; per-resource failures
  degrade to visible warnings (which no longer leak the patient id).
- **Post-deploy expectation**: a connected patient's problem list, family history, medications, labs,
  vitals, immunizations, allergies, procedures, and (opt-in) visits import through the review UI; exact
  dates display where the source provided them. Real EHRs populate some resources sparsely, and a provider
  may grant fewer scopes than requested (surfaced as a per-resource warning, not a failed sync).
- **Rollback**: revert the merge commit on `main`; the next Pages deploy restores the prior build.

## Verification of record

`npm run check` green (1133 tests); `GITHUB_PAGES=true npm run build` succeeds locally. Deploy success is
confirmed by the `Deploy to GitHub Pages` workflow completing on `main`.
