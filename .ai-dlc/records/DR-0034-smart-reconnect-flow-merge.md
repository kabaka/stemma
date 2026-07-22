<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — One-click re-authentication for an expired SMART connection (construction → merge)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0034 |
| `transition`   | `construction-to-merge` |
| `chosen_option`| `approve` |
| `target`       | `main` |
| `unit_of_work` | reconnect-in-place · reconnect-button-and-copy |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-22 |
| `risk_tier`    | standard |

## Rationale

Implements DR-0033: a "Sign in again" button on each SMART connection card re-runs the
OAuth flow for that connection (reusing its stored endpoint + client id), promoted to
the primary action on an expiry error; the OAuth callback upserts by (normalized)
`fhirBaseUrl` so a re-auth updates the existing connection in place rather than spawning
a duplicate card, and auto-syncs on return. Closes the "no way to re-auth an expired
connection" gap the maintainer hit (worst for Cerner's ~10-minute, no-refresh-token
sessions).

### Review gate (Solo Mob Construction)
- **`clinical-safety-reviewer`: APPROVE** — review-before-apply preserved (reconnect →
  auto-sync still lands in CcdaReview, never auto-applies); tokens stay in the TokenStore
  under the connection id; `partialize` unchanged; layering/determinism clean.
- **`accessibility-reviewer`: APPROVE** — real keyboard-operable button, Label-in-Name
  holds, primary/secondary promotion never colour-only, no focus-stranding. Minor
  consistency nit (disambiguate the sibling buttons) — fixed.
- **`code-reviewer`: ESCALATE_SECURITY → resolved.** Independently found the stale-token
  bug (below); also flagged the stale troubleshooting doc and an exact-string match key
  that could still duplicate on the manual path — both fixed (doc updated;
  `connectionMatchKey` normalizes scheme+host case + one trailing slash, match-only).
- **`security-privacy-reviewer`: BLOCK (High) → RESOLVED (re-verified).** `persistTokens`
  only cleared the refresh token inside `if (response.refresh_token)`, so an opt-out
  reconnect (stayConnected off, response without a refresh token) left a prior long-lived
  refresh token in localStorage under the reused id while the card showed "Stay connected"
  off — a private-by-default violation. Fixed: `stayConnected=false` now ALWAYS clears;
  `stayConnected=true` saves/rotates only when a token is issued, else leaves the existing
  one. Re-verified empirically (pre-fix commit fails the new regression tests; the fix
  passes) — finding fully closed, no new regression.

### Verification
`npm run check` green (1244 tests, 49 files). New tests cover: reconnect-in-place vs
append, tokens under the reused id, the opt-out-clears-stale-token regression (verified
to fail without the fix), the keep-on-no-rotation case, the normalized match key, and
per-connection button accessible names. Live-OAuth reconnect can't be exercised in CI
(needs a real provider); token/state plumbing + button wiring are covered by tests.

Merge authorized to `main`; publish at the `to-operations` gate (the Pages deploy on
push to `main`).
