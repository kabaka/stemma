<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — printable-report improvements (construction → merge)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0031 |
| `transition`   | `construction-to-merge` |
| `chosen_option`| `approve` |
| `target`       | `main` |
| `unit_of_work` | printable-report-improvements |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-22 |
| `risk_tier`    | standard |

## What merges

Per DR-0030, in `src/domain/timeline.ts`, `src/ui/components/PrintReports.tsx`,
`src/styles/components.css`, and their oracles (`src/domain/timeline.test.ts`,
`src/ui/views/views.test.tsx`):

- **Footer** — `position: fixed` footer replaced by a `.print-doc` table with a `<tfoot>`
  running clinical boundary; per-sheet `<tr>` (needed for per-page `<tfoot>` repetition) and
  `break-before: page` on the row (a `break-after` on the sheet `<div>` inside a `<td>` is
  inert). PDF-verified at Letter and A4: no occlusion, footer on every page, no trailing blank.
- **Labs & vitals** — new pure read-models and a per-series summary section (latest value,
  reference range as recorded, count, span; no min/max, no in/out-of-range flag). The Health
  timeline drops note-less structured measurements but keeps note-bearing ones (value rendered
  inline) so no clinician note is lost. Event type labels via `EVENT_META`.
- **De-dup** — Sheet 2 family table filtered to `affCount > 0`.

## Review gate — all clear

| Reviewer | Verdict |
| --- | --- |
| `code-reviewer` | **APPROVE** (timeline predicate, `seriesSummary` last-not-max, `??` falsy-zero-safe formatting, cross-type isolation, dedup filter, `<tfoot>` restructure all verified; two low/non-blocking notes) |
| `clinical-safety-reviewer` | **CLEAR** (guardrails #1/#3/#4/#5, layering, determinism verified; the one must-fix — silent loss of a structured measurement's free-text `detail` note — fixed) |
| `accessibility-reviewer` | findings fixed (layout `.print-doc` → `role="presentation"`; Labs/Vitals label → `<caption>` for a programmatic table name; heading outline, colour-independent meaning, contrast all pass) |

## Findings fixed before merge

Silent loss of structured lab/vital `detail` notes (clinical-safety) → timeline now keeps a
note-bearing structured measurement, rendered with its value inline, and only drops the
note-less bulk (regression test added); inaccurate top-of-file comment about Sheet-2 `rec`
loss corrected; layout-table `role="presentation"` and Labs/Vitals `<caption>` added.

## Recorded, non-blocking (per `code-reviewer`)

`vitalSeries`/`vitalTitles` are currently exercised only by tests (the print summary uses the
private helper via `measurementSummaries`; the interactive `LabTrend` view is lab-only). Kept
as deliberate symmetric read-models mirroring `labSeries`/`labTitles`, with strong cross-type
isolation coverage, anticipating a vitals-trend view. Duplicated `referenceRange`/`formatRange`
left as a follow-up extraction.

## Verification

`npm run check` green — **1201 tests**, deterministic. `GITHUB_PAGES=true npm run build`
succeeds. Rebased onto `origin/main` (a0fbbb0) before merge; no conflicts.

## Next gate

`to-operations` — release/publish authorization (DR-0032).
