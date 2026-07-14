<!-- ai-dlc:link-check-ignore-file -->

# Unit of Work — <title>

The **Inception output** and the **Inception -> Construction handoff contract**. A
parallelizable chunk of value sized to fit a bolt. Produced by the
`requirements-analyst` during Inception and consumed by Construction. Fill every
required field — the next phase reads a known shape, not prose.

| Field                 | Required           | Value |
| --------------------- | ------------------ | ----- |
| `id`                  | yes                | <stable identifier for the unit> |
| `title`               | yes                | <one-line name of the value delivered> |
| `scope`               | yes                | <what is in this unit — the WHAT, concretely> |
| `acceptance_criteria` | yes                | <testable conditions that define "done"; these drive the test-engineer's oracle> |
| `non_goals`           | yes                | <what is deliberately excluded — prevents scope creep> |
| `dependencies`        | yes (may be empty) | <other units this one needs; supports parallelization> |
| `bolt_time_box`       | yes                | <intended bolt window (hours-days). Intent/documentation only — NOT an enforced timer> |
| `risk_tier`           | yes                | <trivial \| standard \| high-risk — sets ceremony depth> |
| `arbiter_signoff`     | yes                | <reference to the Inception Decision Record (Gate 1) approving this unit> |

## Notes

- `bolt_time_box` records intent only — there is no timer, burndown, or cutoff in
  AI-DLC.
- `acceptance_criteria` are the oracle's source of truth. The `implementer` may not
  edit the grading tests derived from them.
- `arbiter_signoff` cannot be filled until the human records the Gate 1 Decision
  Record (see `decision-record.md`).
