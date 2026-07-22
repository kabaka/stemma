<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — Multi-vendor provider directory: Epic + Oracle Health/Cerner (→ operations / deploy)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0032 |
| `transition`   | `to-operations` |
| `chosen_option`| `approve` |
| `target`       | `deploy` |
| `unit_of_work` | cerner-endpoint-directory · per-vendor-client-id-seam · unified-provider-picker · cerner-docs |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-22 |
| `risk_tier`    | standard |

## Authorization

Authorizes publishing the Oracle Health/Cerner multi-vendor extension (DR-0030 design,
DR-0031 merge) to production via the existing GitHub Pages deploy
(`.github/workflows/deploy.yml`, on push to `main`). PR #52 merged to `main`.

### Pre-publish state
- CI green on the merge commit: "Lint, typecheck, test, build" (`npm run check` + build)
  and CodeQL analysis all succeeded.
- Review gate cleared (DR-0031): clinical-safety + security APPROVE; code-review + a11y
  findings resolved and re-verified. `npm run check` green (1204 tests).
- Static, local-first app — no runtime infra/migrations/secrets. The provider directory is
  built-in data; the only runtime egress remains the user-chosen FHIR host's OAuth/FHIR.

### Operational notes / rollback
- **Rollback** = redeploy the prior `main` (revert the merge commit or re-run Pages on the
  previous good commit); no data migration.
- **Backward compatibility (verified & fixed at review):** a deploy that only set the legacy
  `SMART_CLIENT_ID` Variable keeps working for Epic unchanged — the empty-string-Variable
  regression the code review caught is fixed. This deploy changes no runtime behavior for
  existing Epic users until the maintainer adds a `CERNER_CLIENT_ID` Variable.
- **Cerner activation is decoupled from this deploy.** The unified picker + labels are live
  immediately; live Cerner OAuth additionally needs (1) `CERNER_CLIENT_ID` set as a repo
  Actions Variable and (2) `https://kabaka.github.io/stemma/` registered as a redirect URI on
  the Oracle Health app. Until then, picking a Cerner provider reveals the manual Client-ID
  fallback — no breakage.
- **Directory freshness:** manual `npm run gen:endpoints` (now pulls both Epic + Oracle Health);
  watch `oracle-samples/ignite-endpoints` git history for updates.

Post-deploy verification: confirm the Pages workflow succeeds and the published site serves the
new build (the picker chunk references Oracle Health / `fhir-myrecord.cerner.com`).
