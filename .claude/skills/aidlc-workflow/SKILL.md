---
name: aidlc-workflow
description: The end-to-end AI-DLC lifecycle procedure for a solo developer + AI — running Inception → Construction → Operations, the human-arbiter blocking gates, Solo Mob ceremonies, units of work, bolts, and complexity triage. Use when running the AI-DLC lifecycle on your own project, starting Inception/Construction/Operations, deciding how much ceremony a change needs (trivial vs standard vs high-risk), hitting a phase transition or arbiter sign-off, writing or checking a Decision Record, handing requirements → architecture → plan → diff+tests → review → ops between phases, scaling research fan-out vs linear dev work, or asking "do I need a full mob round for this / who approves this gate / can the implementer edit the tests?". For AI-DLC concepts themselves, see `aidlc-methodology`.
---

# Running the AI-DLC Lifecycle (solo developer + AI)

This is the operating procedure for a **single human + AI** running the
AI-Driven Development Lifecycle on their own software-dev or research work. It owns
the *how*; the consumer orchestrator (`AGENTS.md`) only summarizes it and points
here. For what the concepts *mean* (phases, bolts, units of work, the arbiter
principle, the four values), read `aidlc-methodology` — don't re-derive them here.

You operate **three phases in order — Inception → Construction → Operations** —
threaded by one repeating pattern: **the human-arbiter loop**. AI proposes and
contests; **the single human is the sole arbiter who decides.** At four points,
work is *blocked* until the human records a decision.

## The arbiter loop (the spine of every phase)

The core pattern, repeated everywhere: AI creates a plan, asks clarifying
questions, contests its own proposals with challenge agents — and **proceeds only
after the human validates.** Between gates, AI moves freely. **At** a gate, work is
blocked until a **Decision Record** with `chosen_option = approve` exists.

The **four arbiter decision points** (the only blocking gates):

1. **Inception → Construction** — requirements + units of work approved.
2. **Construction · design fork** — architecture/plan approved *before* implementation.
3. **Construction → merge** — the implemented unit approved for integration.
4. **→ Operations (deploy/release)** — the change authorized for deployment.

**Blocking-gate semantics.** A gate is **open only when** a Decision Record for
that transition exists with `chosen_option = approve`. **Absence of a record =
closed gate = AI must not proceed.** For a record to be **valid** the hook requires
three exact matches: `transition` == the gate class, `chosen_option` == `approve`,
and `target` == the branch/tag/release being acted on (a stale or wrong-transition
or non-approve record does not open the gate). **Mechanical enforcement covers only
Gates 3 and 4** — the command-level transitions (merge/integration and
deploy/release) the installed hook can intercept; it requires `jq` and **fails
closed** if `jq` is absent. **Gates 1 and 2 are conceptual** (no command to
intercept) and rely on the recorded Decision Record and discipline, not the hook.
Either way, **the human is the sole arbiter** — the hook checks for the human's
recorded decision; it never makes one. Full contract: `reference/arbiter-gate.md`.

**The Decision Record artifact** (what the arbiter produces at each gate):

| Field | Meaning |
| --- | --- |
| `decision_id` | Stable identifier. |
| `transition` | Which of the four gates. |
| `unit_of_work` | The unit(s) this decision covers. |
| `chosen_option` | What the human decided (e.g. "approve plan A", "request changes"). A gate opens only on **approve**. |
| `rationale` | Why — the business/technical reasoning the human owns. |
| `approver` | The human arbiter (one human, the solo model). |
| `date` | When recorded. |
| `risk_tier` | trivial / standard / high-risk — makes ceremony depth auditable. |

Full handoff/artifact schemas (Unit of Work, the phase-handoff contracts, review
verdicts) are in `reference/artifacts.md` — read it when producing or checking a
handoff. The arbiter gate and Decision Record details are in `reference/arbiter-gate.md`.

## Solo Mob ceremonies — the honest adaptation

> In AWS AI-DLC the mob ceremonies put **multiple humans** on a decision together
> in real time. AI-DLC for a solo developer adapts this: **AI specialist agents
> stand in for the absent human mob members to supply diverse, independent
> challenge, while you remain the sole arbiter who decides.** This is an
> adaptation, not a reproduction — agents can share blind spots that independent
> human stakeholders would not, so the diversity is weaker than a true human mob.

Use **"Solo Mob Elaboration"** (Inception) and **"Solo Mob Construction"**
(Construction). **Never** the bare AWS terms for the agent loop, and never imply
the agents equal a human mob. State the limitation when it matters: the solo
adaptation trades independent-human diversity for speed and availability, and the
**lone human carries the full accountability** a multi-human mob would distribute.

- A **lead** agent proposes; one or more **challenge** agents contest; the human
  decides. (Lead/challenge roster per phase: `reference/phase-playbook.md`.)
- **Operations has NO ceremony** — only **standing human oversight**. Do not invent
  a "Mob Operations" or any mob ceremony there. State the absence positively:
  "Operations has no mob ceremony in AI-DLC; human oversight is the constant."

## Complexity triage — depth scales, the gate never does

AWS names a **"one-size-fits-all rigidity"** anti-pattern. Counter it by sizing
**ceremony depth** to the unit's `risk_tier` — *not* by skipping the arbiter gate.
This is proportionality, our faithful application of AWS's anti-rigidity guidance;
it is **not** an AWS-named tiering scheme. The ceremonies are the same; only their
depth scales.

| Tier | When | Ceremony depth |
| --- | --- | --- |
| **Trivial** | Low-risk, reversible, narrow (copy fix, isolated config). | Single proposer, no full mob round; arbiter may approve inline. Decision Record still required, may be terse. |
| **Standard** | Typical feature unit of work. | Full Solo Mob: lead proposes, ≥1 challenge agent contests, arbiter decides. Full Decision Record per gate. |
| **High-risk** | Irreversible, security-sensitive, broad blast radius, or high ambiguity. | Deepest: multiple challenge agents incl. `security` / `code-reviewer`, options surfaced, arbiter records options-considered. Full Record **plus** alternatives + risk note; consider an ADR. |

**Rules:** assign `risk_tier` on the unit at Inception. It may be **escalated**
(never silently downgraded) if Construction reveals more risk. **Triage reduces
challenge, never the human decision** — even a trivial unit crosses a gate. This
keeps the arbiter principle intact at every tier. Depth rules in detail:
`reference/triage.md`.

## Phase walkthrough

### Inception (WHAT / WHY) — ceremony: Solo Mob Elaboration

1. `requirements-analyst` (lead) turns intent into requirements and **units of
   work**. For open questions, fan out `researcher` ×N → `research-synthesizer`
   (see "Research fan-out" below).
2. Challenge: a second, independent `requirements-analyst` pass
   contests the requirements and the units of work.
3. Each unit gets the **Unit-of-Work contract** (incl. `bolt_time_box`,
   `risk_tier`) — the Inception → Construction handoff. Schema in
   `reference/artifacts.md`.
4. **Gate 1 (Inception → Construction):** human reviews; records an approve
   Decision Record over the units. Closed until then.

### Construction (HOW) — ceremony: Solo Mob Construction

1. `architect` (lead, **structure**) proposes the design; `planner` ×2 (read-only,
   **sequence**) plan; `code-reviewer` / `security` contest. Output: the
   **architecture** then **plan** handoff artifacts.
2. **Gate 2 (design fork):** human approves architecture/plan *before* any code.
3. `implementer` (lead) builds the unit against the plan. `test-engineer` owns the
   grading tests (the **oracle**). Output: the **diff + tests** handoff.
   **The implementer never edits the grading tests** — see below.
4. `code-reviewer` (read-only) does the independent **intent-vs-letter** check and
   emits an **enumerated verdict** (`APPROVE` / `REQUEST_CHANGES` /
   `ESCALATE_SECURITY` / `BLOCK` — see `reference/artifacts.md`). On
   `ESCALATE_SECURITY`, hand off to `security`.
5. **Gate 3 (merge):** human approves the unit for integration via a Decision
   Record. Closed until then. Loop 3–4 on `REQUEST_CHANGES` / `BLOCK`.

### Operations (run it) — NO ceremony, standing oversight

1. `devops` (lead) manages deploy, infrastructure, monitoring. `security` reviews;
   `debugger` does post-failure incident RCA.
2. **Gate 4 (deploy/release):** human authorizes each change for deployment via a
   Decision Record. There is **no mob ceremony** — human oversight is the constant.

Per-phase lead/challenge rosters, gate placement, and the bolt/unit cadence are in
`reference/phase-playbook.md`.

## Units of work & bolts

A **Unit of Work** is the Inception output: a parallelizable chunk of value sized
to fit a **bolt**. It is the concrete **Inception → Construction handoff** — ship it
as a real artifact (the `requirements-elaboration` skill produces it; Construction
consumes it), not as prose. Full field contract — `id`, `title`, `scope`,
`acceptance_criteria`, `non_goals`, `dependencies`, `bolt_time_box`, `risk_tier`,
`arbiter_signoff` — is in `reference/artifacts.md`.

A **bolt** is the intended **hours-to-days** cadence for a unit. It is a
**documentation-and-intent concept**, modeled as the `bolt_time_box` field plus
consistent vocabulary ("this bolt", "scoped to a bolt"). **AI-DLC prescribes no
enforcement**, so it is a planning intent, not a gate. **Do not invent a bolt-timer,
burndown, or automated cutoff** — none exists in the methodology; any such timer is
a labeled *extension*, not part of AI-DLC.

## Phase-handoff output contracts

Work crosses every phase boundary as a **compact, structured artifact**, not loose
prose — so the next phase consumes a known shape:

**requirements → architecture → plan → diff+tests → review verdict → ops record.**

Each contract's fields and the enumerated review verdicts
(`APPROVE` / `REQUEST_CHANGES` / `ESCALATE_SECURITY` / `BLOCK`) are defined in
`reference/artifacts.md`. Produce and validate handoffs against those schemas.

## Research fan-out vs linear dev — and how many workers

Two work shapes scale **differently**. Getting this wrong wastes budget (the
"50 subagents for a trivial query" failure) or serializes work that should parallelize.

- **Research parallelizes.** Independent questions → dispatch `researcher` ×N in
  one turn, **fan in** to `research-synthesizer` (which also runs the citation
  gate — see `citation-verification`). Workers don't need each other's context.
- **Software dev is linear.** Architecture → plan → implement → test → review is a
  chain of **full-context handoffs**; each stage needs the prior stage's whole
  output. Don't fan it out; pass the handoff artifact forward intact.

**How many workers:** *one* for a single-fact lookup or a linear dev step; *a few
(2–4)* for genuinely independent research threads or dual-planning a standard unit;
*many* only when questions are truly independent and the synthesis cost is worth it.
**Match worker count to independent sub-questions, and cap tool-call budget per
worker.** Full scaling rules and budgets: `reference/scaling.md`.

## Don't edit the oracle

The grading tests are the **independent verifier**. To keep verification honest:

- The **`implementer` never edits the grading tests.** It writes the code to pass
  them; it does not move the goalposts.
- The **`test-engineer` owns the oracle** — authors and maintains the grading tests
  from the unit's `acceptance_criteria`, independent of the implementation.
- The **`code-reviewer` does the independent intent-vs-letter check** — confirming
  the code satisfies the *intent* of the unit, not merely the literal tests, and
  emits its enumerated verdict.

If the implementer believes a grading test is wrong, it does **not** edit it — it
escalates to `test-engineer` (oracle owner) and, at the gate, the human arbiter.

## Cross-references

- Concepts (phases, bolts, units of work, arbiter, values): `aidlc-methodology`.
- Phase work: `requirements-elaboration`, `architecture-design`,
  `implementation-planning`, `testing-strategy`, `code-review`,
  `delivery-operations`.
- Research path: `research-method`, `citation-verification`.
- Reference files (read on demand): `reference/arbiter-gate.md`,
  `reference/artifacts.md`, `reference/phase-playbook.md`, `reference/triage.md`,
  `reference/scaling.md`.
