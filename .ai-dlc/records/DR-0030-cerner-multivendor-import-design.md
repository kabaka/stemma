<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — Multi-vendor provider directory: Epic + Oracle Health/Cerner (design fork)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0030 |
| `transition`   | `design-fork` |
| `chosen_option`| `approve` |
| `target`       | `claude/fhir-epic-import-flow-glkih6` |
| `unit_of_work` | cerner-endpoint-directory · per-vendor-client-id-seam · unified-provider-picker · cerner-docs |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-22 |
| `risk_tier`    | standard (extends the approved DR-0027 high-risk design with a well-understood second source; touches the guardrail-adjacent client-id seam + a network-sourced data source, so the full review gate still runs) |

## Rationale

Extend the SMART-on-FHIR provider picker (DR-0027) to cover **Oracle Health (Cerner)**
alongside Epic, in one unified searchable directory — the maintainer confirmed Cerner
already worked via manual endpoint/client-id entry and asked to make it first-class,
without forcing users to choose a vendor (disclosing the underlying system per result
is fine). Research (`researcher`, cited) grounded the decisions against Oracle Health
docs, the SMART/OAuth specs, and the `oracle-samples/ignite-endpoints` repo.

### 1 — Cerner endpoint directory (a single clean file, same FHIR shape as Epic)
Oracle Health publishes patient FHIR R4 endpoints at
`oracle-samples/ignite-endpoints → oracle_health_fhir_endpoints/millennium_patient_r4_endpoints.json`
— a FHIR R4 Bundle of Organization + Endpoint (base URLs
`https://fhir-myrecord.cerner.com/r4/<tenant>/`), freely downloadable, ~1,323 orgs.
`scripts/gen-endpoints.mjs` now fetches BOTH sources, slims each (a pure
`slimCernerBundle` mirroring `slimBrandsBundle`), excludes the public sandbox tenant
`ec2458f2-…`, tags each entry `source: 'epic' | 'cerner'`, and merges into one
name-sorted, interleaved directory (`src/data/smart-endpoints.ts`, 2,566 entries,
~292 KB, still lazy-loaded/code-split). Bundled at build time (local-first; no runtime
query), refreshed manually via `npm run gen:endpoints`; Oracle advises watching the
repo git history for updates.

### 2 — Per-vendor build-time client ID (the key difference from Epic)
Epic and Cerner require **separate app registrations**, so a single client id can't
serve both. The config seam (`src/ui/config.ts`) becomes vendor-keyed:
`buildTimeClientId(vendor)` reads `VITE_CERNER_CLIENT_ID` for Cerner and
`VITE_EPIC_CLIENT_ID ?? VITE_SMART_CLIENT_ID` (back-compat alias) for Epic. Sourced in
`deploy.yml` from repo Variables `EPIC_CLIENT_ID`/`CERNER_CLIENT_ID` (still Variables,
not Secrets — public PKCE clients per RFC 6749 §2.1). `import.meta.env` stays confined
to `config.ts` (layering). `SmartFhirConnect` resolves the active vendor from the
picked provider's `source` (authoritative) or, for a manually-typed URL, infers it from
the host (`cerner.com` → cerner, else epic); the manual Client ID field now reappears
per-vendor when that vendor's Variable is unset. Research confirms one Cerner client id
covers all its patient orgs (like Epic) — high confidence by inference; verify at code
Console registration.

### 3 — Unified picker (no vendor choice; disclose the system)
`EpicBrandPicker` → `ProviderPicker` (renamed, source-neutral). Search is unified across
both vendors — no Epic-vs-Cerner toggle. Each result shows a text system label
("Epic" / "Oracle Health"), included in the option's accessible name (never colour-alone).

### 4 — Scopes unchanged
Oracle Health rejects `patient/*.read` wildcards, but `BASE_SCOPES` already enumerates
`patient/<Resource>.read` per type (which is why Cerner already worked), and
`FamilyMemberHistory` — central to Stemma — is supported by Oracle Health patient
access. No scope/gateway change.

## Alternatives considered
- **Separate Cerner data file + separate picker** — rejected for a unified, source-tagged
  single directory + one `ProviderPicker`; simpler UX (one search) and matches the "don't
  make users choose a vendor" requirement.
- **Infer client id from URL host only** — used only as the fallback for manually-typed
  URLs; a directory pick carries an authoritative `source`, which is preferred.
- **Full Oracle provider/Soarian lists** — rejected; only the patient R4 list is relevant
  to a patient-facing app.

## Risk note
Accepted: (a) the "one Cerner client id covers all orgs" claim is high-confidence by
inference, not a single verbatim Oracle sentence — verify at registration; a
non-provisioned org fails at Cerner's authorize step (handled by the existing
`callbackError` surface), no data leak. (b) Cerner may grant public clients only
short-lived access (refresh tokens historically confidential-only), so "Stay connected"
may not persist for Cerner — the code already handles access-only tokens, degrading
gracefully. Guardrails intact: no manufactured risk numbers; review-before-apply
preserved; local-first (directory is built-in data, no new runtime network); determinism
in the generator transforms; clinical boundary unchanged.
