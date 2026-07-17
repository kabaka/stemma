<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — Page-header unification & pedigree-header redesign (merge + operations)

## Machine fields

| Field           | Value |
| --------------- | ----- |
| `decision_id`   | DR-0014 |
| `transition`    | `construction-to-merge` |
| `chosen_option` | `approve` |
| `target`        | `main` |
| `unit_of_work`  | page-headers-pedigree-redesign |
| `rationale`     | See below. |
| `approver`      | kabaka (maintainer / sole arbiter) |
| `date`          | 2026-07-17 |
| `risk_tier`     | standard (UI layout; touches guardrail #3 by adding, never removing, a clinical boundary) |

## Rationale

Implements the maintainer-approved Claude Design deliverable "Page headers &
pedigree cleanup" — three edits, all within the existing design system, no new
tokens:

1. **Unify `.page-head`.** `align-items: baseline → center`, `margin-bottom: 4px
   → margin: 0 0 16px`, `min-height: 36px` for a stable header height across
   views. Each view's header now follows one convention: a left
   `.page-head__main` column (title + optional context — the "as of" meta or the
   Vantage/Viewing scoping `select`, moved out of the right cluster) and a right
   `.page-head__actions` cluster holding actions only.
2. **Standardize the below-header rhythm.** `.lede` `24px → 20px`; page-head /
   boundary / lede now share a consistent 16/16/20 rhythm. `<ClinicalBoundary/>`
   added to `TimelineView` (the timeline surfaces derived medication/lab
   read-models — a light analysis surface; guardrail #3). `HistoryView` stays
   without one — it is a pure audit log, computing no pattern, risk, or advice.
3. **Rebuild the pedigree header** into three clean bands: unified page-head
   (title + "N people · N generations" meta) → clinical boundary → one aligned
   `.pedigree-toolbar` (Highlight cluster left, "How to read" disclosure as a
   right ghost toggle). `.pedigree-header` top padding `22px → 28px` so the title
   no longer jumps 6px against `.scroll` on navigation. `catBreakdown` unchanged,
   still shown only when a category highlight is active.

Scope was strictly the header/layout: `src/styles/components.css` and the six
view files. No domain, store, export, or other component changed.

**Grounding & gates.**
- `frontend-engineer` implemented against the mockup and verified all six views
  (empty + populated pedigree, highlight state) in headless Chromium.
- `code-reviewer` → REQUEST_CHANGES, two Medium findings, both fixed: (1)
  `.page-head__actions` had lost the old `flex-wrap` (narrow-viewport
  clip/overflow risk) — restored, and `flex-wrap` added to `.page-head` plus the
  inner Vantage/Viewing label rows; (2) the pedigree generation count used
  `gens.length` (occupied generations) while `OverviewView` uses the span
  `maxGen − minGen + 1` — reconciled the pedigree meta onto the same span
  formula so the two surfaces can't disagree on a disconnected (imported) graph.
- `clinical-safety-reviewer` → PASS: boundary present on every Timeline state
  (including no-labs); the double boundary when labs exist (page-level + the
  lab-trend's own contextual one) is over-disclosure, guardrail-#3-compliant, not
  a violation; new meta copy is factual headcounts/labels, no manufactured risk
  number (guardrail #1) and no advice-as-verdict; identity/screening/genetics
  axes untouched.
- `accessibility-reviewer` → one Moderate finding (the `.page-head__actions`
  reflow regression, WCAG 1.4.10) now fixed; all else PASS (heading semantics,
  label-for-select association, focus/reading order, `.mono-dim` contrast ≥
  4.5:1, disclosure operability).
- `test-engineer` owns the oracle: fixed the now-two-boundary Timeline lab test,
  added page-level-boundary coverage for Timeline, a "N people · N generations"
  meta test, a disconnected-graph regression pinning the pedigree/overview
  generation-count agreement (verified to fail on the old `gens.length`), and a
  Vantage-label combobox guard. `npm run check` green (615 tests); production
  `npm run build` succeeds.

**To-operations:** authorized to publish; on merge to `main` the GitHub Pages
workflow rebuilds and deploys the static site (`transition: to-operations`,
`target: deploy`, `approve`, kabaka, 2026-07-17, standard).
