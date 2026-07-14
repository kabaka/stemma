---
name: implementation-planning
description: How to sequence a unit of work into an ordered, dependency-aware implementation plan for your own product code — turning the Unit-of-Work contract into build steps, identifying what runs in parallel vs what is blocked, and producing the plan handoff. Use when you need to plan or sequence the work, break a unit into steps, decide what order to build things, figure out dependencies between tasks, or run dual-planner Solo Mob Construction. Do NOT use for system design (the components, interfaces, and structure) — that is `architecture-design`. The `planner` agent's playbook.
---

# Implementation Planning

A plan turns one **approved** Unit of Work into an **ordered, dependency-aware
sequence of build steps** a single implementer can execute without re-deciding the
approach. It owns the **HOW-in-what-order** of Construction. Concepts and the full
lifecycle loop live in `aidlc-methodology` and `aidlc-workflow` — this skill is
the planning step, not the whole phase.

**Stay in your lane.** Planning is **sequence**, not **structure**:

- **`architecture-design` owns structure** — the components, the domain model,
  interfaces and contracts, the chosen design and rejected alternatives. *How the
  system is shaped.*
- **`implementation-planning` (you) owns sequence** — given that structure, in
  **what order** the unit gets built, what depends on what, what can run in
  parallel. *In what order it is built.*

If you find yourself choosing a data model, an API shape, or a library, you are
designing — stop and defer to `architecture-design`. Plan against the architecture
it already produced; don't redo it.

**You plan the consumer's own product code, not kit authoring.** Steps reference
real files, modules, and tests in the user's repository.

## Inputs you plan from

You receive two upstream handoff artifacts; read both before sequencing (schemas in
`aidlc-workflow` → `reference/artifacts.md`):

1. **The Unit-of-Work contract** (Inception output) — especially:
   - `scope` and `non_goals` — the boundary of what you sequence (never plan
     outside it).
   - `acceptance_criteria` — every step exists to move toward these; the
     `test-engineer` derives the oracle from the *same* criteria (see
     `testing-strategy`). Map your steps to them so coverage is visible.
   - `dependencies` — other units this one needs; they bound when this unit can
     start, not its internal order.
   - `risk_tier` — sets how much ceremony the plan gets (see triage below).
2. **The architecture handoff** (the design fork output) — the structure your steps
   build against. The plan realizes this design; it does not revisit it.

## Producing the plan — procedure

1. **Restate the target.** One line: which unit, its scope, its acceptance
   criteria. Confirm the architecture you are building against.
2. **Decompose into tasks.** Break the unit into the smallest steps that each
   produce a verifiable result (a module, an endpoint, a migration, a wired-up
   path). Each step should be completable and checkable on its own.
3. **Map dependencies.** For each step, record what it **depends on** (must come
   first) — a shared type, a migration, an interface another step calls. A step
   with no unmet dependency is a *root*; roots and any independent branches are
   **parallelizable**. Everything on a dependency chain is **sequential**.
4. **Order the steps.** Topologically sort by dependency. Within that order, pull
   **risky or uncertain steps early** (a load-bearing integration, an unproven
   assumption) so failure surfaces before later work piles on it.
   - **Build a thin end-to-end thread first — a walking skeleton / tracer bullet.**
     Sequence a minimal slice that exercises the **whole** path the unit touches (UI
     → logic → data, or caller → API → store) end to end, then **thicken** it with
     the remaining behavior. This is a concrete instance of pulling risky steps
     early: it **front-loads integration risk** (the seams between layers are where
     surprises live) and **proves end-to-end reachability** — that the slice has a
     real user-reachable path — before the bulk of the work is built on top of an
     unproven thread.
5. **Attach validation per step.** State what each step must pass — the build, the
   specific tests, a lint/typecheck. The `test-engineer` owns the grading oracle;
   you say *which* checks gate *which* step, you do not author the tests.
6. **Cover every acceptance criterion.** Before you finish, verify each
   `acceptance_criterion` is reachable by at least one step. An uncovered criterion
   is an incomplete plan — fix the plan, never narrow the criterion.
7. **Emit the plan handoff** (shape below).

### Parallel vs sequential — the call that matters

The single highest-value output is an honest dependency map. Two failure modes:

- **Serializing the parallel** — forcing an order on steps that have no real
  dependency wastes the unit's bolt window.
- **Parallelizing the dependent** — marking steps independent when one silently
  needs another's output causes mid-build rework.

Mark a step parallel **only** when nothing it needs is produced by an unfinished
step. When unsure, treat it as dependent — the cost of a needless sequence is
lower than the cost of rework. Note that within a *single* unit a solo implementer
often executes sequentially anyway; the parallel/dependent split still matters for
ordering, for surfacing what *could* be split into separate units, and for honest
risk-front-loading.

## The plan handoff artifact

The plan is a **structured handoff**, not narrative — the implementer (and the
human at Gate 2) reads a predictable shape. Authoritative schema: `aidlc-workflow`
→ `reference/artifacts.md` (the "Plan handoff" section). Produce:

```markdown
## Plan — <unit id / title>
Building against: <architecture handoff reference>

### Steps (in execution order)
1. <step> — touches <files/area> — depends on [none | step #s] — [parallel-ok? Y/N]
   — validated by <build / specific tests / lint> — covers AC: <criteria ids>
2. ...

### Dependency notes
<the chains; what is genuinely parallelizable; what must be strictly ordered>

### Acceptance-criteria coverage
<each acceptance_criterion → the step(s) that satisfy it; none left unmapped>

### Risks & front-loaded uncertainties
<the steps pulled early and why; assumptions that could break the sequence>
```

Keep it compact and skimmable. The implementer should be able to execute top-to-
bottom; the arbiter should be able to approve it at **Gate 2 (design fork)** before
any code is written.

## Dual-planner Solo Mob Construction

A standard or high-risk unit is planned by **two `planner` agents dispatched
independently** — they do not see each other's work. This is **Solo Mob
Construction** applied to sequencing: the second plan is a stand-in for an absent
human mob member, supplying independent challenge.

> In AWS AI-DLC the mob ceremonies put **multiple humans** on a decision together
> in real time. AI-DLC for a solo developer adapts this: AI specialist agents
> stand in for the absent human mob members to supply diverse, independent
> challenge, while you remain the sole arbiter who decides. This is an adaptation,
> not a reproduction — two planner passes can share blind spots that independent
> humans would not.

How it plays out:

- Each planner produces a full plan **independently** — different decomposition,
  ordering, and risk calls are the *point*, not noise to reconcile away.
- The Orchestrator and the human **compare** the two plans: where they agree is
  low-risk; where they diverge is exactly where a decision is needed (a missed
  dependency, a different risk-ordering, a step one plan split and the other fused).
- The **human arbiter decides** — approves one plan, or a merge of both, in the
  **Gate 2** Decision Record. The planners propose; they never decide.

As a planner, do **not** hedge toward a presumed "other plan." Produce the best
independent plan you can; the divergence is what makes the ceremony work.

## Right-size the plan to `risk_tier`

Ceremony depth scales with the unit's tier; the **Gate-2 decision never goes away**
(see `aidlc-workflow` → triage):

| Tier | Planning depth |
| --- | --- |
| **Trivial** | A single short plan is enough; skip dual-planning. The Gate-2 record may be terse. The dependency map can be a line or two. |
| **Standard** | Dual `planner` Solo Mob; full plan handoff; full Gate-2 record. |
| **High-risk** | Dual planners **plus** explicit alternatives surfaced (different orderings/decompositions weighed), risks called out for `security`/`code-reviewer` challenge; arbiter records options-considered. |

## Checklist

- [ ] Did I plan **sequence**, leaving **structure** to `architecture-design`?
- [ ] Is every step inside the unit's `scope` and clear of its `non_goals`?
- [ ] Does the dependency map honestly mark parallel vs sequential (and default to
      sequential when unsure)?
- [ ] Are risky/uncertain steps front-loaded?
- [ ] Does every `acceptance_criterion` map to at least one step?
- [ ] Does each step name its gating validation (without authoring the oracle —
      that is `testing-strategy`)?
- [ ] Is the output the structured **plan handoff**, ready for Gate 2?
- [ ] For a standard/high-risk unit, was this produced as an **independent** plan
      for the dual-planner Solo Mob (no hedging toward a presumed other plan)?
