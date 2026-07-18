<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — client-side SMART-on-FHIR import architecture & sequence (design fork)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0020 |
| `transition`   | `design-fork` |
| `chosen_option`| `approve` |
| `target`       | `construction` |
| `unit_of_work` | smart-fhir-import |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-18 |
| `risk_tier`    | high-risk (second PHI-bearing runtime network call; browser OAuth2/PKCE token handling; CSP relaxation; externally-sourced clinical data feeds the hereditary-pattern engine) |

## Approved design (software-architect)

- **`src/integrations/smart-fhir/`** — the impure OAuth/transport port, behind injectable
  seams so the pure/testable parts stay deterministic:
  - `pkce.ts` — S256 verifier/challenge, pure given injected randomness + a digest fn.
  - `discovery.ts` — parse `.well-known/smart-configuration`, with the `metadata` `oauth-uris`
    CapabilityStatement fallback; pure over a JSON fixture.
  - `authorizeUrl.ts` — pure authorize-URL builder.
  - `gateway.ts` — `SmartFhirGateway` port + `FetchSmartFhirGateway` (injectable `fetch`):
    `discover`/`exchangeCode`/`refresh`/`fetchResources`.
  - `tokenStore.ts` — `TokenStore` port + `BrowserTokenStore`; the **only** place tokens are
    read/written (access → `sessionStorage`; refresh → `localStorage` only when opted in).
- **`src/import/health-record.ts`** — the reconciliation/merge engine **hoisted verbatim** from
  `ccda.ts` (RoleCode maps, conservative auto-placement, `stage…`/`apply…`, the shared
  `Staged*`/`Selections` types). `ccda.ts` keeps `parseCcda` and re-exports the hoisted
  functions/types as its existing names — **`ccda.test.ts` stays byte-for-byte the hoist
  regression oracle.** This is the reuse mechanism DR-0019 endorsed, not a deviation.
- **`src/import/fhir.ts`** — `parseFhirImport(bundle, {patientId})`: pure JSON mapping of
  `Patient`/`Condition`/`FamilyMemberHistory` → the generic parsed shape. Restates a **local,
  minimal** set of FHIR resource types; does **not** import `src/export/fhir.ts` (import must
  not depend on export, same rule `native.ts` documents). No clock/network/random.
- **`src/store/useSmartConnectionStore.ts`** — a new persisted slice under its own `stemma-*`
  localStorage key holding **non-secret** connection metadata (`SmartConnection[]`; v1 UI
  manages one active connection, schema allows many). It owns the sole code path that drives
  `SmartFhirGateway` + `TokenStore`. Tokens never enter the durable `stemma-record` slice.
- **UI**: `src/ui/components/SmartFhirConnect.tsx` (connect / status / "Sync now" / disconnect +
  the disclosure copy + clinical boundary); `App.tsx` gains a mount-once effect that completes
  an OAuth callback if `?code&state` are present; the existing `CcdaReview.tsx` is reused as the
  post-sync merge-review UI (its props are already the generic staged shape).

## Redirect round-trip (no backend, no SPA fallback)

`redirect_uri` = the app's **own root** (`https://kabaka.github.io/stemma/` prod,
`http://localhost:5173/` dev) — the repo has no `public/404.html` and the Pages deploy has no
SPA-fallback rewrite, so a dedicated callback sub-path would 404 on a hard redirect. `beginConnect`
stashes `{fhirBaseUrl, endpoints, clientId, codeVerifier, state}` in `sessionStorage`, then
`window.location.assign(authorizeUrl)`. On return, the `App` effect verifies `state` (CSRF),
exchanges the code, persists the connection + tokens, clears the pending entry, and
`history.replaceState`s the query string away so a reload can't replay the exchange. The callback
path writes **only** connection/token state — never the record; pulling data is a separate explicit
"Sync now" that always runs the merge-and-review.

## High-risk addendum

**Alternatives considered.**
- *Backend broker* (DR-0016 deferral) — rejected by the maintainer's explicit "no backend proxy"
  constraint; also reintroduces a server holding PHI/tokens.
- *Per-host CSP allowlist for `connect-src`* — rejected: incompatible with the approved
  "works against any conformant SMART server the user names" scope, and a static build's
  `<meta>` CSP cannot be extended at runtime.
- *Reuse `stageCcdaImport` directly from `fhir.ts` without hoisting* — rejected: the C-CDA-named
  surface (`ParsedCcda`, `stageCcdaImport`) is semantically wrong for a FHIR caller; the hoist
  gives correct names while the re-export keeps the C-CDA oracle intact.

**Risk note (accepted, with mitigation).** The build CSP `connect-src` widens from
`'self' https://clinicaltables.nlm.nih.gov` to **`'self' https:`**. This is a genuine, disclosed
weakening of the "one allowlisted host" posture guardrail #5 leaned on — the hard ceiling of a
static-file CSP against an arbitrary-host requirement, not a shortcut. Mitigations: `https:` still
blocks `http:`/`data:`/`blob:`/`ws:` egress; `script-src 'self'`, `form-action 'none'`,
`object-src 'none'`, `base-uri 'self'` are **unchanged** (the authorize step is a top-level
navigation CSP fetch-directives don't govern); tokens are centralized in `TokenStore`/the
connection store and never touched by `src/ui/`; the connect surface discloses exactly what is
sent and stored. **`security-privacy-reviewer` must explicitly sign off on the CSP change and the
token-handling invariant.**

**Clinical mapping is verified before the parser is coded (required, not a formality).** FHIR has
no CDA `negationInd`; `parseFhirImport`'s disposition of `Condition.verificationStatus` /
`clinicalStatus` and `FamilyMemberHistory` absence signals (`dataAbsentReason`,
`status=health-unknown`) governs guardrail #1 exactly as ADR-009's negation/absence handling does
for CCD. `medical-domain-expert` + `medical-coder` produce the disposition + relationship-code
table (does the CCD v3-RoleCode map apply to `FamilyMemberHistory.relationship`?) that the
implementer codes against; `test-engineer` encodes it in the oracle.

## Build sequence

1. Clinical mapping table (`medical-domain-expert` + `medical-coder`).
2. `implementer`: hoist `src/import/health-record.ts` out of `ccda.ts`; `npm run check` green
   with **zero** `ccda.test.ts` edits.
3. `test-engineer`: the oracle — fixtures (`.well-known` doc, CapabilityStatement fallback,
   token responses incl. Epic access-token-only shape, a Bundle spanning
   confirmed/refuted/unconfirmed conditions + a `health-unknown` relative) and deterministic
   tests for PKCE vectors, authorize-URL, discovery parsing, `parseFhirImport`, and fixed-`nowMs`
   token-expiry. Implementer may not edit these.
4. `implementer`: `src/import/fhir.ts`, `src/integrations/smart-fhir/*`, `useSmartConnectionStore.ts`.
5. `frontend-engineer`: `SmartFhirConnect.tsx`, the `App.tsx` callback effect, reuse `CcdaReview`.
6. `devops`: CSP change in `vite.config.ts`; CI/build green.
7. Review gate: `code-reviewer` + `clinical-safety-reviewer` + `security-privacy-reviewer` +
   `accessibility-reviewer` + `medical-domain-expert` all clear.
8. `technical-writer`: setup/registration walkthrough, exact redirect URIs, scopes + rationale,
   Epic sandbox + refresh-token honesty note, CSP/privacy doc update, ADR update.

## Next gate

`construction-to-merge` — implemented unit approved for integration (DR-0021).
