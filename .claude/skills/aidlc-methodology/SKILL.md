---
name: aidlc-methodology
description: Explains the AI-DLC methodology concepts for your own project — what the three phases (Inception, Construction, Operations) are, what a bolt or unit of work is, what the Solo Mob Elaboration/Construction ceremonies are, and what "the human as arbiter" means. Use when you ask what a phase / bolt / unit of work / ceremony / arbiter / Decision Record IS, need grounding in the methodology before applying it, ask why agents stand in for a "mob", or want the four AI-DLC values and the AI-driven-vs-AI-managed-vs-AI-assisted distinction. Reference knowledge; for the step-by-step loop to run a phase, see the aidlc-workflow skill.
---

# AI-DLC Methodology (concepts)

**AI-DLC** — the **AI-Driven Development Lifecycle** — is a way of building software
where **AI is a central collaborator**, not a passive assistant. AI does the heavy
lifting of turning your intent into requirements, designs, code, and infrastructure;
**you keep decision authority and accountability** and sign off at the critical
forks. It was introduced by AWS (Raja SP, AWS DevOps Blog, 2025).

This skill is **reference knowledge** — it defines *what* the pieces are so you can
talk about and apply the methodology to your own project. It does **not** walk you
through running a phase: for the step-by-step loop (how to actually run Inception,
Construction, Operations end to end), use the **`aidlc-workflow`** skill.

If you are working solo (one human + this agent team), read the honest framing of
the ceremonies below — the team adapts AWS's multi-human "mob" ceremonies for solo
use, and it is important you know what that adaptation does and does not give you.

## The three phases

AI-DLC organizes work into three phases. You move through them per **unit of work**,
not for the whole project at once.

| Phase | Question | What AI does on your project | Ceremony |
| --- | --- | --- | --- |
| **Inception** | WHAT / WHY | Turns your business intent into requirements and decomposes them into **units of work** | **Solo Mob Elaboration** |
| **Construction** | HOW | Proposes architecture, code, and tests (incl. security & resilience) and builds the unit | **Solo Mob Construction** |
| **Operations** | run it | Deploys, runs, and observes the change under your standing oversight | *(none — see below)* |

Each phase is described in depth, framed for your own work, in
`reference/phases.md`.

## Bolts and units of work

AI-DLC compresses Agile vocabulary to match an AI-accelerated cadence:

- **Bolt** (replaces *sprint*) — an intense work cycle measured in **hours to days**,
  not weeks. A bolt is an **intent and a vocabulary**, *not* an enforced timer: the
  methodology names the cadence but prescribes no machinery that cuts work off at a
  deadline. You scope a unit "to a bolt"; nothing automatically stops the clock.
- **Unit of Work** (replaces *epic*) — a **parallelizable chunk of value**, produced
  during Inception and sized to fit a bolt. It is the thing that moves through the
  phases. It carries a small **Unit-of-Work contract** (id, scope, acceptance
  criteria, non-goals, dependencies, intended bolt window, risk tier, arbiter
  sign-off) so Construction has an unambiguous handoff.

Full definitions of the bolt cadence and the Unit-of-Work contract fields are in
`reference/bolts-and-units.md`.

## The ceremonies — adapted honestly for solo work

> In AWS AI-DLC the mob ceremonies put **multiple humans** on a decision together in
> real time. AI-DLC for a solo developer adapts this: **AI specialist agents stand in
> for the absent human mob members to supply diverse, independent challenge, while
> you remain the sole arbiter who decides.** This is an adaptation, not a
> reproduction — agents can share blind spots that independent human stakeholders
> would not, so the diversity is weaker than a true human mob.

Two ceremonies, each adapted for solo use:

- **Solo Mob Elaboration** (Inception) — agents propose requirements and units of
  work and contest each other's reading of your intent; you validate and decide.
- **Solo Mob Construction** (Construction) — agents propose architecture, plan, code,
  and tests and red-team each other's choices; you validate and decide.

**Operations has no ceremony.** The methodology names none, and the team invents
none — Operations is governed by your **standing oversight**, not a ceremony.

What this adaptation gives you and what it costs is laid out in
`reference/ceremonies-and-arbiter.md`. Read it before leaning on the agent "mob" for
a high-stakes decision.

## The human as arbiter

The central principle of AI-DLC: **AI creates a plan, asks clarifying questions, and
implements a solution only after you validate it.** You are the **arbiter** — you
hold the business context, the decision authority, and the accountability. Agents
propose and contest freely; **they never decide.**

This takes concrete form at **four arbiter decision points**, the only places where
work is *blocked* until you record a decision:

1. **Inception → Construction** — requirements and units of work approved.
2. **Within Construction (design fork)** — architecture/plan approved before building.
3. **Construction → integration** — the implemented unit approved to merge.
4. **→ Operations** — the change authorized to deploy/release.

At each point you produce a **Decision Record** (what you decided, why, which unit,
your name as approver, the date, the risk tier). Between these points AI works
freely; at them, it stops and waits for you. Decision points, the Decision Record
fields, and how ceremony depth scales to a unit's **risk tier** (trivial / standard /
high-risk) are in `reference/ceremonies-and-arbiter.md`.

## The four values and the sweet spot

AI-DLC is defined by four value pairs (higher-impact side first):

1. **Human-AI Collaboration** over Isolated Solutions
2. **Collective Intelligence** over Individual Brilliance
3. **Rapid Informed Decisions** over Analysis Paralysis
4. **Business Impact** over Development Velocity

These describe a **sweet spot — "AI-driven with a human arbiter"** — between two
anti-patterns:

| Mode | Who decides | Why it fails |
| --- | --- | --- |
| **AI-assisted** | You do everything; AI autocompletes | Wastes AI's ability to drive; you stay the bottleneck on work AI could lead. |
| **AI-driven, human arbiter** ✅ | **AI drives; you decide at the forks** | AI does the heavy lifting fast; you keep authority and accountability where it matters. |
| **AI-managed** | AI decides and proceeds unilaterally | No accountable human at the critical decisions; business context and judgement go missing. |

The whole methodology — the deferring of critical decisions to you, the
ceremonies, the Decision Records — exists to hold the middle row. The expanded
description of the values and anti-patterns is in `reference/values.md`.

## A note on faithfulness

This methodology is young and evolving, and the solo adaptation deliberately
**departs** from AWS's literal multi-human model in a few honest ways (the solo mob,
bolts-as-intent, the Decision Record artifact, the risk-tier triage). Where the
adaptation departs, the reference files say so plainly rather than claiming parity.
Treat the AWS terms (phases, ceremonies, bolt, unit of work, arbiter) as fixed; treat
the solo adaptations as clearly-labeled extensions.

## Reference

- `reference/phases.md` — the three phases in depth, framed for your project.
- `reference/ceremonies-and-arbiter.md` — the solo-mob ceremonies (honest framing
  and limitations), the four arbiter decision points, the Decision Record, and
  risk-tier triage.
- `reference/bolts-and-units.md` — the bolt cadence and the full Unit-of-Work
  contract.
- `reference/values.md` — the four values and the AI-driven sweet spot vs the
  AI-assisted / AI-managed anti-patterns.

For the **procedure** — how to actually run a phase end to end — see the
**`aidlc-workflow`** skill. This skill tells you what the pieces *are*; that one
tells you what to *do*.
