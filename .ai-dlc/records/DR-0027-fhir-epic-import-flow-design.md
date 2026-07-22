<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — FHIR/Epic import flow: build-time client ID, provider picker, flow redesign (design fork)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0027 |
| `transition`   | `design-fork` |
| `chosen_option`| `approve` |
| `target`       | `claude/fhir-epic-import-flow-glkih6` |
| `unit_of_work` | client-id-config-seam · remove-redirect-uri · provider-picker+endpoints-generator · callback-success-autosync · persistent-sync-chip · needs-review-guidance |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-22 |
| `risk_tier`    | high-risk (touches the SMART-on-FHIR integration, OAuth redirect, network-sourced provider data, and the record-import review path) |

## Rationale

Redesign the SMART-on-FHIR / Epic import so the deployed app ships a public client
ID and users pick a provider instead of hand-entering OAuth values. Architecture by
`software-architect`; public-client / brands-bundle facts verified by `researcher`
against RFC 6749 §2.1, RFC 7636 (PKCE), the SMART "User-access Brands" spec, and
Epic's open.epic.com docs.

### 1 — Build-time client ID (`VITE_SMART_CLIENT_ID`) with manual fallback
A browser SPA is an OAuth **public client**; `client_id` is **not a secret**
(RFC 6749 §2.1) — security rests on PKCE (already implemented in `gateway.ts`) plus
the registered redirect URI. So baking the ID in is standard. Read it in a new
UI-only `src/ui/config.ts` (`import.meta.env` stays a UI/build concern — never leaks
into store/integrations); thread the value into the existing `beginConnect(baseUrl,
clientId, opts)` argument — **no store/integration change**. Sourced in
`deploy.yml` from a GitHub Actions **Variable** (`vars.SMART_CLIENT_ID`), not a
Secret. When unset, today's manual Client-ID field renders unchanged (fork/local-dev
path preserved). Epic's model is one client ID across every org that has enabled the
app, so a single build-time value covers the whole picker.

### 2 — Remove the Redirect URI field
Epic fixes redirect URIs at app-registration time (exact-match, RFC 6749 §3.1.2).
The field is misleading, not merely clutter. Remove it; the app keeps deriving its
own (`origin + BASE_URL`). Maintainer confirmed the GitHub Pages URL is/will be
registered as an Epic redirect URI (the one true prerequisite for live OAuth).

### 3 — Provider picker + endpoints generator
`scripts/gen-endpoints.mjs` (mirrors `gen-conditions.mjs`; `npm run gen:endpoints`)
fetches Epic's User-access Brands bundle (`https://open.epic.com/Endpoints/Brands`,
92 MB) and slims it to a committed `src/data/smart-endpoints.ts`. Epic mandates
download-and-re-host, not runtime queries — so the data is **built, not
runtime-fetched** (preserves local-first; the only runtime network call remains the
user-chosen FHIR host). No logos (a remote image would violate CSP `img-src 'self'`
and local-first) — text initials at render time.

**Scope = brand-level (~1,243 entries), not the 89k full facility union.** All 94,131
orgs resolve to just **764 distinct FHIR base URLs**; the 92,886 facility orgs share
the same endpoints the ~1,243 brand orgs already carry, so brand-level loses **no
connectable endpoint** — only alternate search aliases. Brand-level is ~85 KB raw /
20 KB gzip vs. the full union's ~4 MB source / 0.85 MB gzip held in memory —
disproportionate for a local-first app for alias-only gain. City/state are included
to disambiguate same-named brands; the manual endpoint field is retained as an
explicit "can't find your provider" fallback (also the path for non-Epic providers).
Picker is a filterable combobox (not a 1,243-option `<select>`), lazy-loaded via
dynamic `import('@/data/smart-endpoints')` + `React.lazy` so neither code nor data
touches first paint. On select it calls the same `beginConnect(baseUrl, clientId,
opts)` as manual entry; `gateway.discover()` is unchanged. Named for today's one real
source (Epic) — no speculative multi-source infra, but a `source` provenance tag so a
second directory is an added entry, not a rename.

**Freshness:** refreshed by manually re-running `npm run gen:endpoints` (documented),
mirroring the conditions cadence. No CI staleness gate — a blocking gate cannot
re-fetch a 92 MB third-party file reliably; schema correctness is enforced by `tsc`
via the picker's typed import.

### 4 — Callback success: routing + auto-sync + clear state
The "redirected home, no indication" bug: `completeCallbackIfPresent` succeeds
silently and only `callbackError` re-opens the panel. Fix reuses that exact
non-persisted-signal idiom: add `requestedSyncId` + `requestSync`/`clearRequestedSync`
to the store (plain data — store still never imports `ui`). On success the store sets
`requestedSyncId`; `App.tsx` (the one legal UI mediator between the two stores)
navigates to the pedigree once, gated by the existing `smartCallbackFired` latch;
`PedigreeView` opens the panel on the signal; `SmartFhirConnect` auto-fires the
**existing** `handleSync` once (clearing the signal synchronously before the first
`await`, matching the `callbackInFlight` StrictMode discipline) → lands in the
existing `CcdaReview` review-to-confirm. Success announced via the existing
`role="status"` region — no new toast primitive.

### 5 — Persistent sync chip
New `SmartSyncChip.tsx` in `Sidebar.tsx`'s foot, reusing the `.chip` class; renders
only when ≥1 connection exists. Click = navigate + `requestSync(mostStaleId)` — the
same `requestedSyncId` seam as (4), no duplicated sync/panel logic. Unobtrusive;
does not take over the app.

### 6 — "Needs review" guidance
Additive static legend in the shared `CcdaReview.tsx` explaining the amber "Needs
review" badge (couldn't confidently map to the catalog, or source status not
`confirmed` — defaults off, clinically conservative but still checkable) and the
three disabled-checkbox causes (already recorded / no code to attach / relative not
yet selected). No prop or API change; serves both C-CDA and FHIR callers.

## Alternatives considered (high-risk addendum)
- **Full 89k-org union for the picker** — rejected: ~4 MB committed artifact + memory
  cost, disproportionate for a local-first app, and gains only search aliases since
  every FHIR endpoint is already covered by a brand entry. Brand-level + manual
  fallback chosen.
- **Commit the client ID in source** (valid, since non-secret) — rejected in favour of
  a build-time Variable for portability/forkability, with the manual field as the
  no-config fallback.
- **Runtime-fetch the brands bundle** — rejected: Epic forbids runtime queries and it
  would break local-first. Build-time generation chosen.
- **New toast + new re-entrancy latch for the success path** — rejected: reuse the
  established `callbackError`-style signal + existing latches to avoid new primitives.
- **Scheduled auto-PR endpoints refresh** — deferred: needs write-permissioned CI;
  manual `npm run gen:endpoints` is proportionate now.

## Risk note
Accepted risk: the provider picker offers Epic orgs the maintainer's registered app
may not be enabled for at every org — a connect attempt to a non-enabled org fails at
Epic's authorize step (handled by the existing `callbackError` surface), no data
leak. Live OAuth cannot be end-to-end verified in this change without the maintainer's
real client ID + registered redirect URI; everything else (build config, manual
fallback, generator transform, review guidance, flow wiring against fixtures) is
verified. Guardrails intact: no manufactured risk numbers; review-before-merge for
record data preserved; local-first (no new runtime network); clinical-boundary text
present on the review surface; determinism via injected fetch/config.
