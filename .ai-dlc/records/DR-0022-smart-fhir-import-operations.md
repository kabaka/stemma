<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — client-side SMART-on-FHIR import (→ operations / deploy)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0022 |
| `transition`   | `to-operations` |
| `chosen_option`| `approve` |
| `target`       | `deploy` |
| `unit_of_work` | smart-fhir-import |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-18 |
| `risk_tier`    | high-risk |

## Authorization

The maintainer directed the full flow through publish ("PR → merge → ensure prod Pages
deployment completes"). Merging `smart-fhir-import` to `main` triggers `.github/workflows/deploy.yml`
(build with `GITHUB_PAGES=true` → GitHub Pages publish to `https://kabaka.github.io/stemma/`). This
record authorizes that release.

## Operational notes

- **No new runtime dependency** and no server: the change is client-only. The single build change
  is the CSP `connect-src 'self' https:` relaxation (DR-0020 risk note, security-reviewer APPROVE).
- **New runtime egress** is opt-in and user-initiated only, to the provider FHIR/token/discovery
  endpoint the user names — no Stemma backend, analytics, or third party. Tokens/PHI stay in the
  browser.
- **Post-deploy expectation:** the connect panel is reachable from the Pedigree view; a real
  end-to-end connection requires the user to register a public app with their provider (see
  `docs/SMART-ON-FHIR.md`) and use the exact redirect URI `https://kabaka.github.io/stemma/`.
- **Rollback:** revert the merge commit on `main`; the next Pages deploy restores the prior build.
  No data migration, no persisted-schema change to the record store (the connection store is a
  separate, additive `stemma-smart` key).

## Verification of record

`npm run check` green (871 tests); `GITHUB_PAGES=true npm run build` succeeds locally. Deploy
success is confirmed by the `Deploy to GitHub Pages` workflow completing on `main`.
