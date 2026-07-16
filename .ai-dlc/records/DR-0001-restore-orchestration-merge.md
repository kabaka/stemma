<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — Restore the AI-DLC orchestration layer (merge)

The first Decision Record in this repository. It records a decision that was actually made and
executed, not a reconstruction: the maintainer explicitly authorized opening and merging the kit
restoration.

## Machine fields

| Field | Value |
| --- | --- |
| `decision_id` | DR-0001 |
| `transition` | `construction-to-merge` |
| `chosen_option` | `approve` |
| `target` | `main` |
| `unit_of_work` | restore-orchestration-layer |
| `rationale` | The AI-DLC orchestration spine (Orchestrator definition, lifecycle skills, arbiter gates, the missing lifecycle agents, `kit-extender`) was never installed at productionalization; restoring it is prerequisite to trustworthy AI-DLC work. Verified before merge: `npm run check` green (format/lint/typecheck/339 tests), the five clinical-safety guardrails preserved byte-for-byte, internal cross-references resolve, no runtime/product code changed. CI (CI gate + CodeQL ×3) green on the merged commit. |
| `approver` | maintainer (kabaka) |
| `date` | 2026-07-16 |
| `risk_tier` | standard |

## Notes

- Merged as PR #15 (squash `eec6ed0`). Docs/kit-configuration only; additive and reversible.
- This record also remediates the governance finding in [`../../docs/AUDIT.md`](../../docs/AUDIT.md):
  prior to today, `.ai-dlc/records/` held no Decision Records, so no earlier change had passed the
  arbiter gate the project's governing docs require. From here, gated transitions are recorded here.
- The rebuild-vs-fix-forward decision that the audit informs is a **separate** arbiter decision and is
  **not** recorded here — it awaits the maintainer. This record covers only the kit-restoration merge.
