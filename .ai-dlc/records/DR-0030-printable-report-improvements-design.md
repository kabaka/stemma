<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — printable-report improvements (design fork)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0030 |
| `transition`   | `design-fork` |
| `chosen_option`| `approve` |
| `target`       | `main` |
| `unit_of_work` | printable-report-improvements |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-22 |
| `risk_tier`    | standard (print-surface presentation of clinical data; touches the guardrail-#1 labs/vitals surface, no risk/advice/screening/identity logic) |

## The unit

Maintainer feedback on the printable clinical report (`src/ui/components/PrintReports.tsx`),
three issues: (1) tables reaching a page bottom are occluded by the fixed clinical-boundary
footer; (2) vital (and lab) events list under the Health timeline with no value and can add
tens of pages; (3) the family-history section duplicates the patient's own conditions already
shown in the Sheet-3 self-conditions table.

## Approved design (from `software-architect` + `medical-domain-expert`)

- **Footer occlusion** — root cause: Chromium paints a `position: fixed` footer over flowed
  content and reserves no in-flow space, so the `@page` bottom margin cannot keep content
  clear. Rejected: enlarging the margin (the invariant stays uncoupled and still drifts);
  the CSS `@page` margin box `@bottom-center` (Chromium never implemented margin-box `content`);
  a per-table `<tfoot>` (the sheets are not one table). **Chosen:** a single `.print-doc`
  table wrapping the three sheets with a `<tfoot>` running footer — reserves its height in
  normal flow on every page and repeats there. Verify by PDF render (the DR-0012 precedent).
- **Labs & vitals** — new pure domain read-models in `src/domain/timeline.ts` (a private
  helper generalising `labSeries`/`labTitles`, plus `vitalSeries`/`vitalTitles`, `seriesSummary`,
  `measurementSummaries`; `LabPoint`→`MeasurementPoint` with a back-compat alias). The print
  UI shows **one row per distinct test** — latest value, user-recorded reference range,
  reading count, year span. Per `medical-domain-expert`: **no min/max** (a Stemma-computed
  extreme next to the user's `refHigh` invites an out-of-range read, and is invalid across
  mixed-unit series), **no sparkline** this unit (needs a single-unit guard — deferred), and
  Stemma **does not rank "critical"** (a clinical judgment that fails unsafe against free-text
  titles) — show all series compacted, which already solves the page blow-up.
- **De-dup** — filter Sheet 2's family-conditions table to `affCount > 0`; a proband-only
  diagnosis lives solely on Sheet 3. Shared conditions still appear on Sheet 2 with the "You"
  annotation.

## Next gate

`construction-to-merge` (DR-0031).
