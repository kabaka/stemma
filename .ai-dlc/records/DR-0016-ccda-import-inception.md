<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — C-CDA (CCD) patient-record import (inception → construction)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0016 |
| `transition`   | `inception-to-construction` |
| `chosen_option`| `approve` |
| `target`       | `construction` |
| `unit_of_work` | ccda-import |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-17 |
| `risk_tier`    | high-risk (externally-sourced clinical data → conditions/family-history/provenance; new merge semantics; in-browser XML parsing) |

## Problem

Health-focused users often carry more medical events than average and must
copy-paste their history into yet another app. We evaluated importing directly from
provider portals to remove that friction.

## Options considered

- **A — Live pull (SMART-on-FHIR / OAuth).** Rejected for now. A no-backend browser
  public client (PKCE + Epic dynamic client registration) is technically possible, but
  production **CORS** is inconsistent per-vendor (often absent → forces a proxy),
  many endpoints need a confidential client secret, and each provider organization
  must activate the app. Every mature auto-pull system (Apple Health, CommonHealth,
  Fasten, Flexpa) uses a server-side broker; aggregator services are paid B2B
  ($20k–$900k/yr) or AGPL/GPL copyleft. This collides with Stemma's guardrail #5
  ("the only runtime network call is the optional vocabulary lookup") and is correctly
  parked in ROADMAP Phase 5.
- **B — File-drop import of the patient's own downloaded record. CHOSEN.**
  **C-CDA (CCD) XML** is mandated for patient self-download from every certified EHR
  (ONC 170.315(e)(1) "View, Download, Transmit"), universally available today (Epic
  MyChart, Oracle/Cerner HealtheLife, athenahealth), and uniquely carries both a
  **Problem list** and a dedicated **Family History** section — Stemma's two data
  axes. Parsed 100% client-side, it reuses the exact trust model of the existing
  GEDCOM / native-backup importers (pure, deterministic, no network, funneled through
  the validating store boundary). Raw FHIR bundles are not self-service downloadable
  today, so they are not the design target.

## Scope approved (maintainer)

- **Full CCD**: parse the **Problem Section** → the proband's own conditions, and the
  **Family History Section** → relatives + their conditions.
- **Merge-with-review**: not wholesale replace. Surface what was parsed; the user
  confirms/deselects; accepted items attach to the proband and reconcile relatives into
  the existing pedigree. Requires new merge/dedup logic (does not exist today).
- Imported conditions carry provenance `'record'`. Uncoded/narrative-only and negated
  ("no known history") entries are surfaced for review, never fabricated into positives.
- Pure client-side; no new runtime network call. Apple Health ZIP is a deferred
  follow-up (its `export_cda.xml` reuses the same parser).

## Non-goals (this unit)

Live SMART-on-FHIR / OAuth pull; Apple Health ZIP unzip; Blue Button 2.0 JSON (claims);
raw FHIR bundle import; writing back to any portal.

## Guardrail commitments carried into Construction

Never manufacture a code, onset, or risk number; imported facts attributed as
provenance `'record'`; clinical-boundary text on the import/review surface; in-browser
XML parsing must not process/expand external entities (XXE / billion-laughs) and CDA
narrative must never be rendered as HTML (XSS). `code-reviewer` +
`clinical-safety-reviewer` + `security-privacy-reviewer` + `medical-domain-expert` +
`accessibility-reviewer` all clear before merge.

## Next gate

`design-fork` — architect + planner design and sequence approved before implementation.
