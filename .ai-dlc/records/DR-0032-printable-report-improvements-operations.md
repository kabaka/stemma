<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — printable-report improvements (to operations)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0032 |
| `transition`   | `to-operations` |
| `chosen_option`| `approve` |
| `target`       | `deploy` |
| `unit_of_work` | printable-report-improvements |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-22 |
| `risk_tier`    | standard |

## What ships

The DR-0031 unit, merged to `main`, published to GitHub Pages by the existing
`.github/workflows/deploy.yml` on push to `main`.

## Authorization

The maintainer explicitly authorized implement → PR → merge → deploy in the request
("Address this feedback, PR, merge, and monitor prod Pages deployment").

## Operability

- Local-first static app; no runtime infra, no new network calls, no new dependencies.
- The change is presentation-only (print stylesheet + pure domain read-models). No data
  migration; existing records render unchanged.
- Rollback = revert the merge commit and let Pages redeploy `main`.
- Post-deploy check: confirm the Pages Actions run succeeds and the deployed site loads;
  the print improvements are exercised via the "Print clinical sheets" flow (PDF-verified
  pre-merge at Letter and A4).

## Verification

`npm run check` green (1201 tests); `GITHUB_PAGES=true npm run build` succeeds.
