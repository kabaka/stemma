<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — One-click re-authentication for an expired SMART connection (→ operations / deploy)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0035 |
| `transition`   | `to-operations` |
| `chosen_option`| `approve` |
| `target`       | `deploy` |
| `unit_of_work` | reconnect-in-place · reconnect-button-and-copy |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-22 |
| `risk_tier`    | standard |

## Authorization

Authorizes publishing the SMART "Sign in again" re-authentication feature (DR-0033
design, DR-0034 merge) to production via the existing GitHub Pages deploy
(`.github/workflows/deploy.yml`, on push to `main`). PR #54 merged to `main`.

### Pre-publish state
- CI green on the merge commit: "Lint, typecheck, test, build" (`npm run check` + build)
  and CodeQL all succeeded.
- Review gate cleared (DR-0034): clinical-safety + accessibility APPROVE; the
  code-review/security stale-refresh-token BLOCK is fixed and independently re-verified
  as RESOLVED. `npm run check` green (1244 tests).
- Static, local-first app — no runtime infra/migrations/secrets.

### Operational notes / rollback
- **Rollback** = redeploy the prior `main` (revert the merge commit or re-run Pages on
  the previous good commit); no data migration.
- **Behavior change:** the OAuth callback now updates an existing connection in place
  (matched by normalized `fhirBaseUrl`) instead of appending a duplicate card — improves
  the general connect flow too. Security-relevant fix included: an opt-out reconnect now
  always clears any stored refresh token (private-by-default).
- No new secrets/Variables required to ship this; it works for both Epic and Cerner
  connections created via the existing flows.

Post-deploy verification: confirm the Pages workflow succeeds and the published site
serves the new build (the bundle contains the "Sign in again" reconnect UI).
