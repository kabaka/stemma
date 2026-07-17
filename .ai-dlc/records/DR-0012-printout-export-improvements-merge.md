<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — Printout export improvements (merge + operations)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0012 |
| `transition`   | `construction-to-merge` |
| `chosen_option`| `approve` |
| `target`       | `main` |
| `unit_of_work` | printout-export-improvements (pedigree name fit · running boundary footer · current-medications table · IPS allergies/immunizations) |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-17 |
| `risk_tier`    | standard |

## Rationale

Implements DR-0011's approved design on branch
`claude/printout-export-improvements-ql4yi8` (PR #41). Delivered:

- **Pedigree names no longer overlap** — the shared SVG serializer fits each
  name to a per-line budget derived from the exported `H_GAP`, wraps to ≤2
  `<tspan>` lines with a `<title>` full-name fallback, and its viewBox padding is
  label-aware (no bottom-row clipping; unwrapped output byte-stable). Byline
  contrast raised `#777` → `#666` (WCAG AA).
- **Clinical boundary is a single running page footer** repeated on every
  physical printed page (11px, bold-led) — a strict improvement on guardrail #3.
- **Current medications** table plus **Allergies** and **Immunizations** tables
  (two new pure `src/domain/timeline.ts` read-models), Sheet 3 in IPS order.

**Gates cleared:** `code-reviewer` (REQUEST_CHANGES → all findings resolved:
UI-table test coverage added, footer legibility restored to 11px, stale
docs/comments refreshed, comment precision + byline contrast fixed),
`clinical-safety-reviewer` (no guardrail/layering/determinism violations — the
footer move strengthens #3; everything shown is a recorded fact, #1),
`accessibility-reviewer` (no blockers after the 11px + `#666` fixes).

**Verification:** `npm run check` green (610 tests, +7), production build clean,
and print output confirmed end-to-end in Chromium (Playwright → PDF) for a
minimal record and the dense sample family — boundary on every page, no
content/footer collision, no phantom trailing page.

## To-operations authorization

The maintainer authorized publish through to production. On merge to `main`, the
existing GitHub Pages workflow builds and deploys the static site
(`GITHUB_PAGES=true` base path). This is a local-first static app with no runtime
backend; the deploy is the Pages publish of the built `dist/`. `transition:
to-operations`, `target: deploy`, `chosen_option: approve`, approver kabaka,
2026-07-17, risk_tier standard — recorded here alongside the merge decision since
the two are authorized together for this change.
