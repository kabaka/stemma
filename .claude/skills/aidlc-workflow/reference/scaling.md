# Agent-scaling rules — research fan-out vs linear dev

Two work shapes scale **differently**. Choosing the wrong shape either wastes budget
(the "50 subagents for a trivial query" failure) or serializes work that should run
in parallel. Match worker count to the number of **independent sub-questions**, and
cap each worker's tool-call budget.

## The asymmetry

| | Research | Software development |
| --- | --- | --- |
| Shape | **Parallel fan-out** | **Linear chain** |
| Why | Independent questions don't need each other's context. | Each stage needs the prior stage's whole output. |
| Pattern | `researcher` ×N (one turn) → fan-in to `research-synthesizer`. | architecture → plan → implement → test → review, passing the **full handoff artifact** forward intact. |
| Don't | Serialize independent questions. | Fan out a stage that needs full context, or drop the handoff. |

`research-synthesizer` also runs the **citation gate** on fan-in — see
`citation-verification`. Use `research-method` for how the research path itself runs.

## How many workers

| Use | When |
| --- | --- |
| **One** | A single-fact lookup; any single linear dev step (architect, plan, implement, test, review). |
| **A few (2–4)** | Genuinely independent research threads; dual-planning a standard unit (`planner` ×2); a small Solo Mob challenge set. |
| **Many** | Only when sub-questions are **truly independent** and the synthesis cost is worth the parallelism. Rare. |

**Rule of thumb:** worker count ≈ number of independent sub-questions, capped by
the cost of fanning in. If you cannot name the independent sub-questions, you do not
need more than one worker.

## Tool-call budgets

- **Cap tool calls per worker.** A research worker chasing one sub-question does not
  need dozens of searches; give it a budget proportional to the question's breadth
  and stop when the answer is found.
- **Don't over-provision for trivial queries.** A one-fact lookup is one worker with
  a small budget — never a fan-out. Spawning many subagents for a trivial query is
  the canonical failure to avoid: it burns budget and adds synthesis overhead for no
  diversity gain.
- **Linear dev steps get one worker each**, with the full prior handoff as context —
  the budget goes into doing the step well, not into parallel duplicates.

## Why the dev chain stays linear

Architecture, plan, diff+tests, and review each consume the **entire** preceding
artifact (`artifacts.md`). Parallelizing them would force workers to act on partial
context and reconcile conflicting outputs — slower and lower-quality than a clean
full-context handoff. Keep dev linear; reserve fan-out for independent research.
