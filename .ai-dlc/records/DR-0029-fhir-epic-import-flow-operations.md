<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — FHIR/Epic import flow redesign (→ operations / deploy)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0029 |
| `transition`   | `to-operations` |
| `chosen_option`| `approve` |
| `target`       | `deploy` |
| `unit_of_work` | client-id-config-seam · remove-redirect-uri · provider-picker+endpoints-generator · callback-success-autosync · persistent-sync-chip · needs-review-guidance · review-panel-scroll-fix |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-22 |
| `risk_tier`    | high-risk |

## Authorization

Authorizes publishing the FHIR/Epic import redesign (DR-0027 design, DR-0028 merge)
to production via the existing GitHub Pages deploy (`.github/workflows/deploy.yml`,
which runs on push to `main`). PR #50 merged to `main`.

### Pre-publish state
- CI green on the merge commit: "Lint, typecheck, test, build" (the full `npm run check`
  gate + production build), CodeQL analysis, and the CodeQL Analyze jobs all succeeded.
- Review gate cleared (see DR-0028): security-privacy + clinical-safety APPROVE;
  code-review + accessibility findings resolved and re-verified.
- Static, local-first app — no runtime infra, migrations, or secrets to rotate. The
  deploy is a Vite build published to GitHub Pages.

### Operational notes / rollback
- **Rollback** is a redeploy of the prior `main` (revert the merge commit, or re-run the
  Pages workflow on the previous good commit) — no data migration is involved.
- **Feature activation is decoupled from this deploy.** The provider picker, the
  redesigned flow, and the review/scroll fixes are live immediately. Live Epic OAuth
  additionally requires the maintainer to (1) set the repo Actions Variable
  `SMART_CLIENT_ID` and (2) have `https://kabaka.github.io/stemma/` registered as a
  redirect URI on the Epic app. Until the Variable is set, the deployed app shows the
  manual Client-ID fallback — no breakage. Setting it takes effect on the next deploy.
- **Provider directory freshness** is a manual `npm run gen:endpoints` re-run (documented
  in CONTRIBUTING); no runtime dependency on open.epic.com.

Post-deploy verification: confirm the Pages workflow succeeds and the published site at
https://kabaka.github.io/stemma/ loads the new connect flow.
