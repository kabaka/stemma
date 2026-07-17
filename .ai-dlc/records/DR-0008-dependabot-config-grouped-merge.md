<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — Dependabot config modernization (grouped updates) merge

Records the maintainer's authorization to merge a modernized `.github/dependabot.yml` into `main`.
Config-only change; no application code, no dependency versions, no runtime surface.

## Machine fields

| Field | Value |
| --- | --- |
| `decision_id` | DR-0008 |
| `transition` | `construction-to-merge` |
| `chosen_option` | `approve` |
| `target` | `main` |
| `unit_of_work` | dependabot-config-grouped — rewrite `.github/dependabot.yml` to batch version updates into the fewest reviewable PRs via `groups`, keep the weekly cadence, add `versioning-strategy: increase`, `open-pull-requests-limit`, Conventional-Commit prefixes, and labels |
| `rationale` | The prior config produced one-PR-per-package (ten open at once — the backlog #33 just cleared). Grouping collapses routine churn: one PR for all dev tooling, a separate one for runtime deps (react/react-dom/zustand) so shipped-behavior changes stay isolated and reviewable, and one for all GitHub Actions. Validated: `python -c yaml.safe_load` parses, all fields are valid Dependabot v2 schema, `prettier --check` clean. Trivial risk tier (reversible config, no code). |
| `approver` | maintainer (kabaka) — requested the config modernization as the second deliverable |
| `date` | 2026-07-17 |
| `risk_tier` | trivial |

## Recorded scope / design decisions (arbiter-facing, non-silent)

1. **Runtime deps grouped apart from dev tooling.** `react`/`react-dom`/`zustand` land in their own
   `production-dependencies` group PR, so a bump that changes the shipped app is never buried in a
   linter/type-defs batch. All dev tooling batches into one `dev-dependencies` PR (majors included —
   `npm run check` + build verify them as a set in CI).
2. **GitHub Actions batch into a single PR** (`github-actions` group, all update types). Action
   majors are frequent and low-risk here and stay SHA-pinned via the existing workflow convention.
3. **Weekly cadence kept; `applies-to: version-updates` on every group** so security (Dependabot
   alert) updates still surface individually and urgently rather than waiting for the weekly batch.
4. **`versioning-strategy: increase`** so scheduled PRs bump the `package.json` range, not just the
   lockfile — keeping declared deps honest.
