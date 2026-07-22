<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — FHIR/Epic import flow redesign (construction → merge)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0028 |
| `transition`   | `construction-to-merge` |
| `chosen_option`| `approve` |
| `target`       | `main` |
| `unit_of_work` | client-id-config-seam · remove-redirect-uri · provider-picker+endpoints-generator · callback-success-autosync · persistent-sync-chip · needs-review-guidance · review-panel-scroll-fix |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-22 |
| `risk_tier`    | high-risk (SMART-on-FHIR integration, OAuth redirect, network-sourced provider data, record-import review path) |

## Rationale

Implements DR-0027 across the layers on branch `claude/fhir-epic-import-flow-glkih6`.
All units of work delivered: build-time public client id (`VITE_SMART_CLIENT_ID` via a
GitHub Actions Variable) with a manual fallback; redirect-URI field removed; a
lazy-loaded searchable Epic provider picker over a generated brand-level index
(`src/data/smart-endpoints.ts`, `npm run gen:endpoints`); a non-silent
callback→auto-sync→review flow; a persistent sidebar sync chip; "Needs review"
guidance; and a fix for the import review panel not scrolling. Plus the additional
in-scope issue raised mid-flight (the review panel scroll bug).

### Review gate (Solo Mob Construction)
- **`security-privacy-reviewer`: APPROVE** — no-exfiltration holds (provider directory
  is inert build-time data, no runtime fetch; only egress is the user-chosen OAuth/FHIR
  host), `partialize` still excludes tokens, deploy uses a Variable (not a Secret) with
  no privilege widening, CSP untouched, no new deps.
- **`clinical-safety-reviewer`: APPROVE** — clinical boundary present on both render
  paths; auto-sync lands in the review-before-apply step and never auto-applies;
  local-first preserved; layering and determinism clean.
- **`code-reviewer`: REQUEST_CHANGES → resolved.** Found a real HIGH defect: the
  `requestedSyncId` auto-sync latch (`autoSyncedRef`) never reset, so the sync chip's
  retry for the same connection silently no-op'd and left the signal stuck. Fixed
  (latch resets per episode; signal always cleared, incl. the not-found branch) with
  regression tests that were verified to fail without the fix. Minor cleanups applied.
- **`accessibility-reviewer`: REQUEST_CHANGES → resolved.** Sync-chip accessible name
  now conveys the re-sync action; picker dropdown clipping (confirmed live via
  Playwright even at 1280×800) fixed with measured flip-above placement, re-verified
  live; conditional `aria-controls`; combobox semantics/focus otherwise sound.

### Verification
`npm run check` green (1171 tests, 49 files). Production build succeeds and emits the
picker as a separate lazy chunk; a build with `VITE_SMART_CLIENT_ID` set bakes the id
and hides the manual field, a build without it keeps the fallback. In-app (dev,
Playwright): the connect panel shows the searchable picker with state-disambiguated
results and no redirect-URI field; clinical boundary present. Not verifiable here:
live Epic OAuth (needs the maintainer's real client id + the GitHub Pages redirect URI
registered on the Epic app — the one maintainer prerequisite, confirmed at DR-0027).

### Maintainer follow-ups to activate the shipped feature
1. Register a patient-facing public/PKCE Epic app; register `https://kabaka.github.io/stemma/`
   as a redirect URI; set repo Actions Variable `SMART_CLIENT_ID` to the client id.
2. Re-run `npm run gen:endpoints` periodically (weekly) to refresh the directory.
Documented in `docs/SMART-ON-FHIR.md`, README, CONTRIBUTING.

Merge authorized to `main`; release/publish handled at the `to-operations` gate (the
GitHub Pages deploy on push to `main`).
