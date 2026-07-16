# Architecture craft — options, trade-offs, contracts, boundaries

Deeper patterns for `architecture-design`. Read this when presenting design options
to the arbiter, designing a contract that must stay stable, or deciding where a
boundary goes. The `SKILL.md` body has the procedure; this is the toolkit.

## Contents

- [Presenting options to the arbiter](#presenting-options-to-the-arbiter)
- [Trade-off dimensions](#trade-off-dimensions)
- [Designing interface and data contracts](#designing-interface-and-data-contracts)
- [Where to put a boundary](#where-to-put-a-boundary)
- [Structure vs sequence — staying in lane](#structure-vs-sequence--staying-in-lane)

## Presenting options to the arbiter

The arbiter decides only among options you surface. Make the choice **legible and
real** — distinct, viable approaches with honest trade-offs, not one plan plus a
strawman.

A worked options table for a "store user sessions" fork:

| | Option A: signed stateless tokens | Option B: server-side session store |
| --- | --- | --- |
| Structure | No session storage; state in a signed token | A session table/cache keyed by session id |
| Good for | Horizontal scale, low infra | Instant revocation, small payloads |
| Costs | Hard to revoke before expiry; token bloat | A store to run and scale; a network hop |
| Reversibility | Hard to add revocation later | Easy to layer caching/expiry |
| Fits this unit because | Acceptance criteria need stateless API nodes | Criteria include "admin can force-logout" |

**Recommendation:** state your default and *why*, tied to this unit's
`acceptance_criteria` and `risk_tier` — then let the human decide. For a high-risk
unit, record the options-considered on the Decision Record (see `aidlc-workflow`
triage); consider an ADR for a durable, far-reaching choice.

If only one option is genuinely viable, that is fine — but **show the alternatives
you rejected and why**. The rejection reasoning *is* the trade-off analysis the
arbiter needs.

## Trade-off dimensions

Run a candidate structure or tech choice through these lenses; surface the ones that
actually differ between options (don't pad with ties):

- **Complexity** — moving parts, cognitive load, failure modes added.
- **Performance** — latency, throughput, resource use under the unit's load.
- **Cost** — infra, licensing, operational toil.
- **Operability** — how hard to deploy, observe, and debug in Operations.
- **Reversibility** — how cheaply can this be undone or changed later? (Weigh
  heavily for `high-risk` units.)
- **Lock-in** — coupling to a vendor, framework, or data shape that's costly to exit.
- **Security & blast radius** — attack surface, trust boundaries crossed. A
  security-relevant fork escalates to `security` (ADR-0004) before the gate.
- **Fit to criteria** — the deciding lens: which option best satisfies *this* unit's
  `acceptance_criteria` and honors its `non_goals`.

## Designing interface and data contracts

Contracts are what the `planner` sequences against and the `implementer` builds to —
get them stable early.

- **Specify the whole contract**, not just the success path: inputs, outputs,
  **errors**, and pre/postconditions. A missing error contract is a latent defect.
- **Version/compatibility** — state what may change without breaking a consumer
  (additive vs breaking). Name the compatibility rule, don't leave it implicit.
- **Keep contracts technology-light** where possible so a tech choice doesn't leak
  into the shape consumers depend on. The interface should outlive the
  implementation behind it.
- **Map each contract to a boundary** — a contract that doesn't sit on a component
  boundary is usually a sign the boundary is wrong.

## Where to put a boundary

Heuristics for drawing component/module lines:

- **Responsibility** — one component, one reason to own its data and rules.
- **Rate of change** — separate things that change for different reasons / on
  different cadences, so a change in one doesn't ripple.
- **Coupling vs cohesion** — maximize within-component cohesion; minimize
  cross-boundary coupling. Chatty boundaries are usually misplaced.
- **Trust** — a boundary that crosses a trust level (untrusted input, another
  machine) is a security boundary — make it explicit and flag `security`.
- **Testability** — if two parts can't be reasoned about or tested apart, the
  boundary between them may be wrong.

## Structure vs sequence — staying in lane

Keep this skill on **structure**; hand **sequence** to `implementation-planning`.

| Belongs to `architecture-design` (structure) | Belongs to `implementation-planning` (sequence) |
| --- | --- |
| What components exist and their boundaries | In what order to build them |
| The domain model and invariants | Which step comes first / depends on which |
| Interface and data contracts | What files each step touches |
| Which approach / tech and its trade-offs | The per-step validation plan |

When a design discussion drifts into "do X before Y," stop — that is sequencing.
Finish the structure, get Gate 2 approval, then the `planner` orders the work.
