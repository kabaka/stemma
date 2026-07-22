<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — lab/vital out-of-range marker (→ operations)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0038 |
| `transition`   | `to-operations` |
| `chosen_option`| `approve` |
| `target`       | `deploy` |
| `unit_of_work` | lab-out-of-range-marker |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-22 |
| `risk_tier`    | high-risk (touches clinical-safety guardrail #1) |

## Release authorization

Authorizes publishing the `lab-out-of-range-marker` unit to production via the standard
pipeline: squash-merge of PR #56 to `main` triggers `.github/workflows/deploy.yml`, which
builds with the GitHub Pages base path and publishes the static app to GitHub Pages. No
runtime/infra change accompanies this unit — it is a pure client-side static-app change
(new pure domain function + UI markup + CSS + docs), so the deploy is the ordinary Vite
build → Pages publish with no migration, no new network surface, and no new stored data.

## Pre-publish evidence

- Construction merge gate cleared (DR-0037): `code-reviewer` + `clinical-safety-reviewer`
  APPROVE; `accessibility-reviewer` no blocking failures.
- CI on PR #56 green: "Lint, typecheck, test, build" (build included), CodeQL, and both
  Analyze jobs all succeeded.
- Guardrails re-confirmed in the merged tree: no forbidden interpretation vocabulary,
  `rangePosition` display-only (never imported by `patterns`/`screening`/`recommendations`),
  `timeline.ts` still a pure leaf, clinical boundary + referral-oriented caveat present on
  every affected surface.

## Rollback

Revert the squash-merge commit on `main` and let `deploy.yml` re-publish the prior build —
the app is a stateless static site, so a revert fully restores the previous behaviour with
no data-migration concern.

## Post-publish check

Confirm the `deploy.yml` run for the merge commit completes successfully and the Pages
environment updates. (Recorded at authorization; deploy outcome verified after merge.)
