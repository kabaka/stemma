<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — client-side SMART-on-FHIR import (construction → merge)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0021 |
| `transition`   | `construction-to-merge` |
| `chosen_option`| `approve` |
| `target`       | `main` |
| `unit_of_work` | smart-fhir-import |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-18 |
| `risk_tier`    | high-risk (second PHI-bearing runtime network call; browser OAuth2/PKCE token handling; CSP relaxation; externally-sourced clinical data feeds the pattern engine) |

## What merges

The client-side SMART-on-FHIR import approved in DR-0019/DR-0020, implemented across:
`src/integrations/smart-fhir/*` (public-client OAuth2 + PKCE port), `src/import/fhir.ts`
(pure FHIR R4 → domain parser) reusing the hoisted merge engine `src/import/health-record.ts`,
`src/store/useSmartConnectionStore.ts` (non-secret connection state; `syncNow` returns the raw
bundle so the store stays out of the `import` layer), the connect/callback/review UI
(`SmartFhirConnect.tsx`, `App.tsx`, `PedigreeView.tsx`), the `connect-src 'self' https:` CSP
change, and the docs (`docs/SMART-ON-FHIR.md`, ADR-010, README, ROADMAP).

## Review gate — all clear (Solo Mob Construction)

| Reviewer | Verdict | Notes |
| --- | --- | --- |
| `code-reviewer` | **APPROVE** | Re-verified all 5 findings fixed with real regression tests; ran the suite. |
| `security-privacy-reviewer` | **APPROVE** | Token-handling model + `connect-src 'self' https:` CSP both APPROVE; the DR-0020-required sign-off. Confirmed the cross-origin pagination token-leak fix and the store/tokenStore test coverage. |
| `clinical-safety-reviewer` | **CLEAR / CONFIRM** | All five guardrails verified clean in code; re-confirmed the `deceasedRange/String` and `subject-unknown`-sab refinements are guardrail-safe. |
| `medical-domain-expert` | **PASS** | Parser faithful to the approved disposition table on every axis; recommended the two clinical refinements that were implemented. |
| `accessibility-reviewer` | **APPROVE** | Both WCAG blockers (focus loss, non-copyable redirect URI) and #3–#9 fixed and passing; UI suite 174/174. |

## Findings fixed before merge

StrictMode/concurrent double-exchange of the one-time auth code (App.tsx ref latch +
store in-flight latch); callback cleanup + URL scrub moved to a `finally` (no stale verifier /
retry loop); cross-origin `Bundle.link[next]` rejected before the bearer token is sent
(token-exfiltration path closed); failed-callback surfaced via `callbackError`; `Referrer-Policy`
added; `https:` form validation; `subject-unknown` retains the sex-from-relationship SAB;
`deceasedRange/String` → `dead:true`; store/tokenStore unit oracle added; full WCAG focus/labeling
fixes. Pre-existing invalid foster RoleCodes (`FSTRMTH/FSTRFTH`) in the shared table are noted for
a follow-up cleanup (non-genetic, never auto-placed → no clinical effect).

## Verification

`npm run check` green — **871 tests** (703 baseline + 168 new across the parser, OAuth/PKCE port,
token store, connection store, UI, and the RFC 7636 known-answer PKCE vector); deterministic
(injected randomness/digest/fetch/clock). `GITHUB_PAGES=true npm run build` succeeds. The pure
`parseFhirImport` and the OAuth/token invariants are independently test-owned; the implementer did
not edit the oracle. Note: in-app flows were driven in-session but the repo ships no committed
Playwright/e2e harness — verification of record is the vitest/RTL suite + the review gate.

## Next gate

`to-operations` — release/publish authorization (DR-0022): merge to `main` triggers the GitHub
Pages deploy.
