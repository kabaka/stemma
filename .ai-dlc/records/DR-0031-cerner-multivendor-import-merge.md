<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — Multi-vendor provider directory: Epic + Oracle Health/Cerner (construction → merge)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0031 |
| `transition`   | `construction-to-merge` |
| `chosen_option`| `approve` |
| `target`       | `main` |
| `unit_of_work` | cerner-endpoint-directory · per-vendor-client-id-seam · unified-provider-picker · cerner-docs |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-22 |
| `risk_tier`    | standard (extends the approved DR-0027/DR-0030 design) |

## Rationale

Implements DR-0030 on branch `claude/fhir-epic-import-flow-glkih6`: the provider
directory now merges Epic + Oracle Health (Cerner) into one source-tagged searchable
list (2,566 orgs), the build-time client id resolves per vendor, the picker
(`ProviderPicker`) shows a per-row system label, and docs cover Cerner setup. Store,
gateway, and scopes are unchanged (Cerner reuses the existing enumerated per-resource
scopes).

### Review gate (Solo Mob Construction)
- **`clinical-safety-reviewer`: APPROVE** — no guardrail/layering/determinism violations;
  re-ran `npm run gen:endpoints` and confirmed the generated file is byte-identical
  (determinism + genuinely generated); review-before-apply and clinical boundary
  untouched; `import.meta.env` stays in `config.ts`; store/integrations diffs empty.
- **`security-privacy-reviewer`: APPROVE** (no High/Critical) — no-exfiltration holds
  (build-time-only fetch, inert data, sandbox tenant excluded, no new deps, CSP + Variables
  correct). Two hardening notes: the vendor-inference host check (fixed, below) and the
  build-time-fetch integrity tradeoff (documented eyeball-the-diff discipline, no change).
- **`code-reviewer`: REQUEST_CHANGES → resolved.** Found a real HIGH regression: an unset
  `EPIC_CLIENT_ID` Variable bakes an empty string, and `config.ts`'s `??` chain didn't fall
  through to the legacy `VITE_SMART_CLIENT_ID` alias — blanking Epic's client id for a
  back-compat deploy. Fixed (first-non-empty fallback) with a test using the real
  empty-string shape. Low dedup-key note also fixed (regen byte-identical).
- **`accessibility-reviewer`: REQUEST_CHANGES → resolved.** The per-vendor manual Client ID
  field appeared with no announcement (WCAG 4.1.3) — wrapped in a `role="status"` region
  that names the active vendor; the vendor label moved to `--text-dim` for AA contrast
  headroom.

### Fixes verified
Security-hardening: `inferVendor` now parses the URL hostname instead of substring-matching,
so look-alike hosts (`cerner.com.evil.example`) no longer misclassify as Cerner. All fixes
have tests (incl. the empty-string-Variable regression and the host-inference bypass cases).

### Verification
`npm run check` green (1204 tests, 49 files). In-app (dev, Playwright): searching the unified
picker returns interleaved Epic + Oracle Health results, each labeled with its system and
disambiguated by city/state; no vendor toggle. Not verifiable here: live Cerner OAuth (needs
the maintainer's Cerner client id + the GitHub Pages redirect URI registered on the Cerner
app — verify the single-client-id-per-vendor assumption at code Console registration).

### Maintainer follow-ups to activate Cerner
1. Register a patient-facing public/PKCE app in Oracle Health's code Console; register
   `https://kabaka.github.io/stemma/` as its redirect URI; set repo Actions Variable
   `CERNER_CLIENT_ID`. (Epic keeps working via `EPIC_CLIENT_ID` or the legacy `SMART_CLIENT_ID`.)
2. Refresh the directory periodically with `npm run gen:endpoints` (now pulls both sources).

Merge authorized to `main`; release/publish at the `to-operations` gate (the Pages deploy on
push to `main`).
