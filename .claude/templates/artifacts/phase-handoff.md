<!-- ai-dlc:link-check-ignore-file -->

# Phase-handoff artifacts

The compact, structured artifacts that carry work across phase boundaries. Each
arrow is a handoff; the receiving stage consumes the producing stage's whole
output. Keep each artifact compact and structured — these are contracts, not
narrative.

```text
requirements -> architecture -> plan -> diff+tests -> review verdict -> ops record
```

The `requirements` handoff is the Unit of Work (see `unit-of-work.md`). The rest
follow below. Copy the section you need.

## Architecture handoff

The `architect`'s output at the design fork — the system **structure**. This is
what **Gate 2 (design fork)** approves.

- **Chosen design** — <the structure selected>
- **Components / domain model** — <the pieces and their boundaries>
- **Key interfaces / contracts** — <the load-bearing interfaces>
- **Alternatives considered** — <options weighed and why rejected>
- **Risks / assumptions** — <what could go wrong; what is assumed>

## Plan handoff

The `planner`'s output — the **sequence** (in what order the unit is built). Dual
`planner`s produce two plans for the Solo Mob Construction round; the arbiter
approves one at Gate 2.

- **Ordered steps** — <step 1, step 2, ... in build order>
- **Files / areas per step** — <what each step touches>
- **Dependencies between steps** — <ordering constraints>
- **Validation per step** — <the check each step must pass>

## Diff + tests handoff

The Construction implementation output handed to review. Two coupled parts:

- **Diff** — the `implementer`'s code change for the unit.
- **Grading tests** — owned by `test-engineer` (the oracle), derived from the unit's
  `acceptance_criteria`. The **implementer never edits these**.

## Review verdict (enumerated)

The `code-reviewer`'s pre-merge output: the intent-vs-letter check plus **one**
enumerated verdict. The enumeration keeps routing deterministic.

| Verdict             | Meaning                                                            | Next |
| ------------------- | ----------------------------------------------------------------- | ---- |
| `APPROVE`           | Code satisfies the unit's intent and the oracle; safe to merge.   | Proceed to Gate 3 (merge). |
| `REQUEST_CHANGES`   | Defects or gaps; not mergeable as-is.                             | Back to `implementer`; re-review. |
| `ESCALATE_SECURITY` | A security concern beyond the in-line lens.                      | Hand off to `security`; resolve before Gate 3. |
| `BLOCK`             | A fundamental problem (wrong approach, broken oracle, mismatch). | Stop; escalate to the human arbiter. |

`APPROVE` does not open Gate 3 by itself — a human Decision Record still does (see
`decision-record.md`).

## Operations record

The `devops` output at deploy/release — the audit trail for each change shipped.

- **What was deployed** — <the change/version>
- **Where** — <environment/target>
- **Deploy / rollback method** — <how it ships and how it is reverted>
- **Monitoring / health signals** — <what to watch>
- **Gate 4 Decision Record** — <link to the Decision Record authorizing the deploy>
