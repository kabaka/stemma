<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — lab/vital out-of-range marker (construction → merge)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0037 |
| `transition`   | `construction-to-merge` |
| `chosen_option`| `approve` |
| `target`       | `main` |
| `unit_of_work` | lab-out-of-range-marker |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-22 |
| `risk_tier`    | high-risk (touches clinical-safety guardrail #1) |

## What was built

Per the approved design (DR-0036): a pure domain primitive
`rangePosition(value, refLow?, refHigh?): 'within' | 'above' | 'below' | undefined` in
`src/domain/timeline.ts`, and a neutral, colour-independent `RangePositionMark`
("above range" / "below range") wired into the three surfaces that show a value beside its
recorded reference range — `LabTrend`, `PrintReports` (`MeasurementTable`), and `CcdaReview`.
Each surface computes the position from that reading's **own** co-recorded bounds. The
marker is a positional restatement of the FHIR `referenceRange` axis, never the
`interpretation` axis; it is display-only and never feeds the engine. The ~6 load-bearing
"no in/out-of-range flag" comments and `docs/ROADMAP.md` were updated to the now-true rule,
and each surface carries an honest, referral-oriented caveat.

## Gate evidence

- **`npm run check` green** — prettier, `oxlint --type-aware`, `tsc`, and `vitest run`:
  **1290 tests / 51 files** pass. Includes 27 deterministic `rangePosition` unit tests
  (boundary-inclusive, zero-bound, one-sided, inverted, non-finite, vignettes) plus UI/
  component coverage for `RangePositionMark`, `LabTrend`, `PrintReports`, and `CcdaReview`.
- **`code-reviewer`: APPROVE** — after one REQUEST_CHANGES round (three `CcdaReview`
  findings: one-sided-range display gate, missing co-located caveat, stale/uncovered test),
  all resolved and re-verified.
- **`clinical-safety-reviewer`: APPROVE** — guardrails #1/#2/#3 confirmed: strictly
  positional wording, no forbidden interpretation vocabulary, display-only isolation from
  `patterns.ts`/`screening.ts`/`recommendations.ts`, `timeline.ts` still a pure leaf,
  caveats referral-oriented, clinical boundary first-class on every surface.
- **`accessibility-reviewer`: no blocking WCAG failures** — meaning carried by text not
  colour (1.4.1), AA contrast in dark theme and print; two fixes applied (self-spacing
  marker for 1.4.1; `overflow-x: auto` for 1.4.10 Reflow).
- **`software-architect` + `medical-domain-expert`** grounded the design (FHIR R4
  `Observation` `referenceRange` vs `interpretation`; CLSI EP28-A3c / IFCC on reference
  intervals; inclusive bounds).

## Decision

Approved for merge to `main`. The change was rebased onto latest `origin/main` (conflicts in
`LabTrend.tsx`/`components.css` resolved to keep upstream #53/#55 alongside this unit) and
carries a single clean history on top of it.

## Next gate

`to-operations` (DR-0038) — GitHub Pages publish authorization.
