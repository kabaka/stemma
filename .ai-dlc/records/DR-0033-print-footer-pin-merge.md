<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — pin clinical-boundary print footer (construction → merge)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0033 |
| `transition`   | `construction-to-merge` |
| `chosen_option`| `approve` |
| `target`       | `main` |
| `unit_of_work` | print-footer-pin |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-22 |
| `risk_tier`    | standard (print presentation; touches guardrail-#3 boundary placement, no risk/advice/screening/identity logic) |

## What merges

A follow-up to DR-0031 (#51). The `<tfoot>` running footer introduced in #51 fixed
content occlusion but regressed footer pinning: a `<tfoot>` only reaches the page bottom
when content fills the page, so on a short record, a single-page print, or the last page
of a multi-page print the clinical-boundary disclaimer floated up after the content
instead of being pinned to the bottom.

**Fix — hybrid footer** (`src/ui/components/PrintReports.tsx`, `src/styles/components.css`):
- An invisible `<tfoot>` spacer (`.print-doc__foot-spacer`, `20mm`, `visibility:hidden`)
  keeps reserving in-flow space at the bottom of every page (preserves the #51
  anti-occlusion property).
- A `position: fixed; bottom:0` `.print-footer` (`role="note"`, `20mm`, `overflow:hidden`,
  `box-sizing:border-box`) carries the visible boundary text pinned to the bottom of every
  physical page; placed first in `.print-reports` to avoid the documented trailing-blank-page
  bug. The two `20mm` heights are a documented coupled invariant.
- `@media print { html, body { background:#fff } }` so an under-filled page no longer prints
  the app's dark theme background as a band.

## Review gate — all clear

| Reviewer | Verdict |
| --- | --- |
| `clinical-safety-reviewer` | **CLEAR** (guardrail #3: boundary pinned + present on every page, single render site, 20mm fits the ~3-line text) |
| `code-reviewer` | **APPROVE** (coupled invariant sound; fixed-footer stacking cannot be occluded; footer first-in-DOM; print-scoped background; two low, non-blocking notes) |

## Verification

`npm run check` green — **1234 tests**. PDF-verified at Letter and A4 across multi-page,
short, and last-page records: footer at the identical bottom position on every page, no
occlusion, boundary complete, no trailing blank page. Branch restarted from `main`
(DR-0031's #51 already merged) per the merged-PR workflow.

## Next gate

`to-operations` — release/publish authorization (DR-0034).
