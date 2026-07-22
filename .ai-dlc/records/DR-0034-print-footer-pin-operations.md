<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — pin clinical-boundary print footer (to operations)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0034 |
| `transition`   | `to-operations` |
| `chosen_option`| `approve` |
| `target`       | `deploy` |
| `unit_of_work` | print-footer-pin |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-22 |
| `risk_tier`    | standard |

## What ships

The DR-0033 unit, merged to `main`, published to GitHub Pages by the existing
`.github/workflows/deploy.yml` on push to `main`.

## Authorization

The maintainer explicitly authorized the fix through deploy in the request
("Fix, PR, merge, monitor deployment as before").

## Operability

- Presentation-only change (print stylesheet + JSX structure); no runtime infra, network,
  storage, dependency, or domain change. Existing records render unchanged.
- Rollback = revert the merge commit and let Pages redeploy `main`.
- Post-deploy check: confirm the Pages Actions run succeeds and the deployed site loads;
  the print footer is exercised via the "Print clinical sheets" flow (PDF-verified pre-merge
  at Letter and A4).

## Verification

`npm run check` green (1234 tests); production build succeeds under the deploy workflow.
