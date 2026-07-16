---
name: architecture-design
description: The craft of proposing logical architecture, a domain model, and interface/data contracts BEFORE code, then surfacing the design choice for the human arbiter — presenting 2+ options with trade-offs and producing the architecture handoff artifact. Use when designing or structuring the system, shaping a domain model, defining interface/API or data contracts, choosing component or module boundaries, weighing which approach / which tech / which pattern, or evaluating tech-choice trade-offs at Construction's design fork. Decides WHAT the system looks like (structure, boundaries, contracts). Do NOT use for sequencing the build — use implementation-planning for the order of work. For the lifecycle loop and gates, see aidlc-workflow.
---

# Architecture Design (Construction · the design fork)

The craft of deciding **what the system looks like** — its structure, component and
domain boundaries, and the interface/data contracts between them — and surfacing
that decision for the human arbiter **before any code is written**. You are the
`architect` at Construction's design fork. This skill produces the **architecture
handoff artifact** that Gate 2 approves.

For the lifecycle loop, the gates, and the Solo Mob mechanics, read
`aidlc-workflow` — **don't re-derive them here.** For what the phases and ceremonies
ARE, read `aidlc-methodology`. This skill is the *how* of one stage: design.

## Scope boundary — structure, not sequence

This is the sharp line that keeps routing clean (ADR-0004 routing boundaries):

- **This skill (`architect`) decides STRUCTURE** — how the system is *shaped*:
  components and their boundaries, the domain model, interfaces and data contracts,
  and the tech-choice trade-offs.
- **`implementation-planning` (`planner`) decides SEQUENCE** — in *what order* the
  unit is built: ordered steps, what each touches, step dependencies, per-step
  validation.

**Do NOT use this skill for sequencing the build — use `implementation-planning`.**
If the question is "what should the system look like / which approach / what are the
contracts," you are here. If it is "in what order do we build it," hand off to the
planner.

## The honest Solo Mob framing (state it; never overclaim)

> In AWS AI-DLC the mob ceremonies put **multiple humans** on a decision together
> in real time. AI-DLC for a solo developer adapts this: **AI specialist agents
> stand in for the absent human mob members to supply diverse, independent
> challenge, while you remain the sole arbiter who decides.** This is an
> adaptation, not a reproduction — agents can share blind spots that independent
> human stakeholders would not, so the diversity is weaker than a true human mob.

In design this means: you propose the architecture; challenge agents
(`code-reviewer`, `security`, dual `planner`) **contest** it; the single
human **decides** at Gate 2. Use the name **Solo Mob Construction**; never the bare
AWS "Mob Construction" for the agent loop.

## The procedure

Work from the approved Unit-of-Work contract (the Inception → Construction handoff —
see `requirements-elaboration`). Its `scope`, `acceptance_criteria`, `non_goals`,
and `risk_tier` are your inputs; honor them.

### 1. Model the domain and the boundaries

Establish *what the system is made of* before *how the pieces talk*.

- **Domain model** — the core entities, their relationships, and the invariants
  that must always hold. Name them in the domain's language, not the framework's.
- **Components / modules and their boundaries** — what each owns, what it hides.
  Draw boundaries along responsibility and rate-of-change seams; minimize coupling.
- **Map structure to the unit's acceptance criteria** — every criterion must have a
  home in the design. A criterion with no owning component is a gap; surface it.

### 2. Define the interface and data contracts

Contracts are the load-bearing output — they let the `planner` sequence and the
`implementer` build against a fixed shape.

- **Interfaces / APIs** — the operations each boundary exposes: inputs, outputs,
  errors, and pre/postconditions. Be explicit about the error contract, not just the
  happy path.
- **Data contracts** — the schemas/shapes that cross a boundary or persist, and
  their compatibility constraints (what may change without breaking consumers).
- Keep contracts **technology-light where you can** so the tech choice (step 3) does
  not leak into the interface a consumer depends on.
- For **`ui_bearing` units**, the **design-system contract** — design tokens + a
  UI-element inventory + state matrices — is itself an interface/data contract in
  this handoff. Produce it via the `design-system` skill (the *how it looks* layer)
  alongside `ux-design` (the *how it works* layer); the existing Gate 2 approves it.
  It is a sub-part of the architecture handoff, not a new gate or artifact-type.
  For `ui_bearing` units you also produce the **proposed** `.ai-dlc/stack-binding.json`
  (which UI stack / run command / audit paths the visual-QA tools target) via the
  `stack-binding` skill — it rides inside this same handoff and the arbiter confirms
  it inside the existing Gate-2 Decision Record.

### 3. Surface 2+ design options with trade-offs (for the arbiter)

The arbiter cannot decide what you never surface. For any real structural or
tech-choice fork, present **at least two viable options** and let the human choose.

- For each option: the **structure it implies**, its **trade-offs** (complexity,
  performance, cost, operability, reversibility, lock-in), and **what it's good/bad
  for** against *this* unit's criteria and `risk_tier`.
- Make options genuinely distinct — not one real option and a strawman. If only one
  approach is viable, say so and state why the alternatives were rejected (that *is*
  the trade-off analysis).
- **Recommend** one as the default with your reasoning — but the human decides. The
  deeper the `risk_tier`, the more options and the more explicit the trade-offs:
  high-risk units record options-considered (see `aidlc-workflow` triage).
- A `security`-relevant fork (auth, crypto, secrets, untrusted input, anything that
  runs on another machine) **escalates to `security`** as a challenge agent
  (ADR-0004) before the gate.

Trade-off framing patterns and a worked options table are in
`reference/options-and-tradeoffs.md`.

### 4. Produce the architecture handoff and reach Gate 2

Emit the **architecture handoff artifact** (below), then the work reaches the
**design Decision Record checkpoint (Gate 2)**: the human arbiter approves the
architecture **before any implementation begins**. **The gate is closed until an
approve Decision Record exists** — no code until then (`aidlc-workflow`). You
propose and contest; you do **not** record the decision — the human does. On
approval, hand the structure to `implementation-planning` for sequencing.

## The architecture handoff artifact (the design-fork output)

The `architect`'s output at the design fork — the system **structure** Gate 2
approves. Ship it as a compact, structured artifact, not loose prose. Include:

| Part | Content |
| --- | --- |
| Chosen design | The selected structure (the option the arbiter approved). |
| Components / domain model | The components/entities and their **boundaries**. |
| Interfaces & data contracts | Key interfaces/APIs and the data shapes crossing boundaries. For `ui_bearing` units, the **design-system contract** (tokens + UI-element inventory + state matrices, via `design-system`) is one of these contracts. |
| Alternatives considered | The other option(s) and **why rejected** — the trade-offs. |
| Risks & assumptions | What could go wrong; what the design assumes (esp. for high-risk units). |

This is the `architecture` link in the handoff chain
(**requirements → architecture → plan → diff+tests → review → ops**). The full chain
and downstream contracts are in `aidlc-workflow`'s `reference/artifacts.md`.

## Done criteria for design

- The domain model and component boundaries are defined and cover every acceptance
  criterion in the unit.
- Interface and data contracts are explicit, including error contracts.
- ≥2 distinct options were surfaced with trade-offs (or a single option with
  alternatives explicitly rejected), and a recommended default given.
- Security-relevant forks escalated to `security` where ADR-0004 requires.
- The architecture handoff artifact is complete (chosen design, components,
  contracts, alternatives, risks/assumptions).
- The Gate 2 Decision Record exists (`chosen_option = approve`) before any code; the
  structure is handed to `implementation-planning` for sequencing.

## Cross-references

- Order of work (NOT this skill): `implementation-planning`.
- Inputs from the prior phase: `requirements-elaboration` (the Unit-of-Work contract).
- For `ui_bearing` units: the **visual** design contract (tokens / UI-element
  inventory / state matrices) is `design-system`; **interaction/usability/WCAG** is
  `ux-design`. Both ride inside this architecture handoff.
- The lifecycle loop, gates, triage, handoff schemas: `aidlc-workflow`
  (`reference/artifacts.md` for the full contract chain).
- Concepts (phases, ceremonies, arbiter, values): `aidlc-methodology`.
- Deeper craft (options/trade-off patterns, contract design, boundary heuristics):
  read `reference/options-and-tradeoffs.md`.
