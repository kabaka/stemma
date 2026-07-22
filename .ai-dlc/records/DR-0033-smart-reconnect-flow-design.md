<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — One-click re-authentication for an expired SMART connection (design fork)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0033 |
| `transition`   | `design-fork` |
| `chosen_option`| `approve` |
| `target`       | `claude/fhir-epic-import-flow-glkih6` |
| `unit_of_work` | reconnect-in-place · reconnect-button-and-copy |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-22 |
| `risk_tier`    | standard (touches OAuth callback + connection/token state; run code + clinical-safety + security + a11y review) |

## Problem

When a connection's access token has expired and cannot be refreshed (no refresh
token — the norm for Cerner/Oracle Health, which grants public clients only a
~10-minute access token, and for Epic without "Stay connected" once the session
token lapses), `syncNow` throws `"This connection has expired and needs to be
reauthorized."` The UI shows that text in the connection card's `role="alert"`, but
the card offers only **Sync now** (which keeps failing) and **Disconnect** — there is
**no re-authenticate affordance**. The only current re-auth path is Disconnect →
reopen the picker → re-pick the provider → sign in, which the maintainer found
non-obvious ("the sync button seems to do nothing and there is no obvious
alternative").

## Design

### 1 — Reconnect updates the existing connection in place (store)
`completeCallbackIfPresent` currently always mints `newId()` and appends
(`connections: [...s.connections, connection]`), so re-running the OAuth flow for an
already-connected provider would spawn a duplicate card. Change: match an existing
connection by **`fhirBaseUrl`** (the practical "one login per provider portal" key);
if found, **reuse its id** — persist the new tokens under that id and replace the
connection in place (refresh `authorizeEndpoint`/`tokenEndpoint`/`clientId`/
`patientId`/`scopesGranted`/`offlineAccessGranted`/`stayConnected`; keep `createdAt`
and the prior `lastSyncAt`). No match → today's append behavior. `requestedSyncId` is
set to the resolved id (existing or new) so the post-callback auto-sync still fires.
This also prevents accidental duplicate cards from connecting the same portal twice.
Non-goal: multiple distinct patients at the *same* `fhirBaseUrl` collapse to one
connection — acceptable for a single-proband tool; a future multi-patient model is out
of scope.

### 2 — "Sign in again" button + clearer copy (UI)
Add a `handleReconnect(connection)` to `SmartFhirConnect` that calls
`beginConnect(connection.fhirBaseUrl, connection.clientId, { stayConnected:
connection.stayConnected, redirectUri })` — reusing the connection's stored endpoint
and client id (correct per-vendor id, captured at connect time), so no re-picking is
needed. Add a **"Sign in again"** button to `ConnectionCard` (keyboard-operable,
labelled). It is always available; when the card's `syncError` indicates an expiry
(`/reauthoriz|expired|access may have expired/i`), it is promoted to the primary
action. Update `friendlyError`'s expiry branches to point at it ("use 'Sign in again'
below") instead of "disconnect and reconnect". On return, the callback updates the
same connection (part 1) and auto-syncs — a true one-click re-auth.

## Guardrails
No manufactured risk numbers; local-first preserved (only egress remains the
user-chosen OAuth/FHIR host); tokens stay in the `TokenStore` under the connection id,
never persisted in the connection metadata or transiting the UI; review-before-apply
unchanged (reconnect → sync → the existing CcdaReview step). `import.meta.env` stays in
`config.ts`; the store still imports no `ui`.

## Verification plan
Store unit tests (update-in-place vs append; tokens under the reused id; requestedSyncId
resolves to the existing id). UI tests ("Sign in again" calls `beginConnect` with the
connection's own base URL/client id/stayConnected; button promoted on expiry). Full
review gate (code + clinical-safety + security-privacy for token handling + a11y).
Live-OAuth reconnect can't be exercised in CI (needs a real provider); the token/state
plumbing and button wiring are covered by tests + fixtures.
