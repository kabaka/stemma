<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — client-side SMART-on-FHIR import (inception → construction)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0019 |
| `transition`   | `inception-to-construction` |
| `chosen_option`| `approve` |
| `target`       | `construction` |
| `unit_of_work` | smart-fhir-import |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-18 |
| `risk_tier`    | high-risk (introduces a second, PHI-bearing runtime network call → brushes guardrail #5; OAuth2/PKCE token handling in the browser; externally-sourced clinical data → conditions/family-history/provenance) |

## Problem

DR-0016 (C-CDA import) evaluated a live SMART-on-FHIR pull and **deliberately parked it**
to Phase 5, on the assumption that a no-backend browser client is blocked by inconsistent
per-vendor CORS, confidential-client secrets, and per-organization app activation, and that
every mature auto-pull integration resorts to a server-side broker. The maintainer is now
directing the **client-side subset that avoids those blockers**: a public (secret-less)
OAuth2 + PKCE browser client that talks only to the user's own provider FHIR endpoint, with
no backend proxy. This supersedes the DR-0016 deferral for the client-side path; the
server-side broker path remains out of scope.

## Options considered

- **A — Backend broker (the DR-0016 deferral).** Rejected by the maintainer's direction:
  the explicit constraint is *static page only, no backend proxy*. A broker would also
  reintroduce a server that holds PHI and tokens, weakening the local-first stance.
- **B — Client-side public client (PKCE), no backend. CHOSEN.** SMART App Launch STU 2.2
  standalone launch with PKCE (S256) is defined for public clients with no secret; discovery
  is via `.well-known/smart-configuration`; the token endpoint and FHIR REST endpoints are
  a server-side *SHALL* for CORS from a registered origin. This is exactly the browser-SPA
  case and needs no backend. Real, documented limits are accepted (see risk note).

## Scope approved (maintainer)

- **Standalone SMART App Launch** (patient-facing), public client + **PKCE S256**, no client
  secret. Discovery via `.well-known/smart-configuration` with a CapabilityStatement
  (`metadata` `oauth-uris`) fallback for older servers. Endpoints are **read from discovery,
  never hardcoded**; the FHIR base URL is user-supplied (or chosen from a provider directory).
- **Standard-compliant, vendor-neutral.** Must work against any conformant SMART server; the
  first validation target is Epic (its R4 sandbox), but nothing Epic-specific is hardcoded.
- **Resources imported:** `Patient` (proband context), `Condition` (problem list) and
  `FamilyMemberHistory` (relatives + their conditions) — Stemma's two data axes, matching the
  C-CDA import and the existing FHIR *export*. `Observation`/timeline resources are a deferred
  follow-up.
- **Merge-with-review, reusing the C-CDA `parse → stage → apply` contract.** Nothing is
  written wholesale; every parsed condition and relative is a suggestion the user confirms.
  Accepted conditions carry provenance `'record'`. Onset/codes/risk never fabricated; negated
  / "no known history" entries surfaced, never turned into positives; non-genetic relatives
  never auto-attached to genetic parentage.
- **Ongoing connection / update support — "standard + graceful re-auth" (arbiter decision).**
  Request `offline_access`; **use** refresh tokens on servers that grant them (real unattended
  re-sync there). Where a server declines them to a secret-less public client (Epic's
  documented behaviour), persist the *connection* (endpoint, patient id, client id, granted
  scopes, last-sync) so "Sync now" is a one-click reconnect + re-pull via a quick re-login.
  Every re-pull runs the merge-and-review — never a silent overwrite. Docs state honestly
  which servers allow unattended refresh.
- **Token storage — "opt-in persistence" (arbiter decision).** Access token in `sessionStorage`
  (cleared on tab close) per SMART storage guidance; refresh token + connection metadata
  persisted to `localStorage` **only if** the user opts into "stay connected", with a clear
  disclosure and a one-click disconnect that wipes all of it.
- **Documentation** for setup: provider/app registration, the exact redirect URI, the scopes
  requested and why, the Epic sandbox walkthrough, and the honest limits (refresh tokens,
  CORS, sparse FamilyMemberHistory).

## Non-goals (this unit)

Backend/proxy of any kind; confidential-client flows / client secrets / dynamic client
registration; EHR-launch (embedded) flow; write-back to any portal; `Observation`/medication/
lab/immunization → timeline import; a bundled provider-endpoint directory (user supplies or
pastes the FHIR base URL, with the discovery flow doing the rest); at-rest encryption of the
local record/tokens (unchanged from today's threat model — trusted device).

## Guardrail commitments carried into Construction

Guardrail #5 is directly implicated — this is a **second** runtime network call. It is honored
by: the call being **opt-in and user-initiated**, talking **only** to the user's own chosen
provider endpoint (no third party, no Stemma server, no analytics), keeping all PHI and tokens
in the browser, disclosing exactly what is sent/stored on the connect surface, and updating the
privacy docs + CSP to reflect the new, bounded egress. Never manufacture a code/onset/risk;
imported facts are provenance `'record'`; clinical-boundary text on every new surface; OAuth
state/PKCE/`aud`/exact redirect-uri handled to spec (CSRF + token-phishing defenses). The pure
FHIR→domain mapping stays deterministic (no clock/network/random) exactly like `ccda.ts`.
`code-reviewer` + `clinical-safety-reviewer` + `security-privacy-reviewer` +
`medical-domain-expert` + `accessibility-reviewer` all clear before merge.

## Next gate

`design-fork` — architect + planner design and sequence approved before implementation (DR-0020).
