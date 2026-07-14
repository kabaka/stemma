# Ceremonies, the arbiter, and decision points

This file covers the heart of how AI-DLC keeps you in control: the **solo-adapted
mob ceremonies** (and their honest limitations), the **human-as-arbiter** principle,
the **four decision points**, the **Decision Record**, and how ceremony depth scales
to **risk tier**.

## Contents

- The solo mob ceremonies — honest framing
- What the adaptation gives you, and what it costs
- The human as arbiter
- The four arbiter decision points
- The Decision Record
- Risk-tier triage (right-sizing ceremony depth)

## The solo mob ceremonies — honest framing

In AWS AI-DLC, **Mob Elaboration** and **Mob Construction** are ceremonies where
**multiple humans** validate AI's proposals and make decisions **collectively, in
real time** — "extreme decision-making via mob work." That multi-human room is the
defining property of a mob.

You are working **solo** (one human + an agent team). So the ceremonies are
**adapted**, and the adaptation is stated honestly:

> In AWS AI-DLC the mob ceremonies put **multiple humans** on a decision together in
> real time. AI-DLC for a solo developer adapts this: **AI specialist agents stand in
> for the absent human mob members to supply diverse, independent challenge, while
> you remain the sole arbiter who decides.** This is an adaptation, not a
> reproduction — agents can share blind spots that independent human stakeholders
> would not, so the diversity is weaker than a true human mob.

The two ceremonies:

- **Solo Mob Elaboration** (Inception) — agents propose requirements and units of
  work, and contest each other's reading of your intent. You decide.
- **Solo Mob Construction** (Construction) — agents propose architecture, plan, code,
  and tests, and red-team each other's choices. You decide.

**Operations has no mob ceremony in AI-DLC; human oversight is the constant.** Do not
expect a "Mob Operations" — there isn't one, by design.

**Naming:** call them **Solo Mob Elaboration / Solo Mob Construction** (or "the mob
ceremony, adapted for solo use"). They are not the bare AWS multi-human ceremonies,
and the agents are not a human mob.

## What the adaptation gives you, and what it costs

**Gives you:** diverse, independent *challenge* on demand — multiple specialist
perspectives (a planner, an adversarial reviewer, a security pass) pressuring a
decision the way a mob's many minds would, but available instantly and tirelessly.
This is real collective-intelligence pressure, mechanized.

**Costs you:** the agents **share a model and a context**, so they can share blind
spots that genuinely independent human stakeholders would not. Their diversity is
**weaker** than a human mob's. And because you are the *only* human, you carry the
**full accountability** that a multi-human mob would have distributed across several
people. The adaptation trades independent-human diversity for speed and availability —
a good trade for most work, but know it before you bet a high-stakes, irreversible
decision on the agent mob alone. For those, seek a real second human.

## The human as arbiter

The central operating principle, repeated in every phase:

> AI creates a plan, asks clarifying questions to seek context, and implements a
> solution **only after receiving your validation.**

You are the **arbiter**: you hold the business context, the decision authority, and
the accountability. Agents propose and contest; **they never decide.** AI never
proceeds past a critical fork without your sign-off. This is the "AI-driven with a
human arbiter" sweet spot (see `values.md`).

## The four arbiter decision points

These are the only points where work is **blocked** until you record a decision.
Between them, AI proposes and contests freely.

1. **Inception → Construction** — requirements and units of work approved.
2. **Within Construction (design fork)** — architecture/plan approved before
   implementation begins.
3. **Construction → integration (merge)** — the implemented unit approved to merge.
4. **→ Operations (deploy/release)** — the change authorized for deployment.

Each is a place where "AI proceeds only after the human validates" takes concrete
form. A gate is **open** only when an approving Decision Record for that transition
exists; **no record = closed gate = AI must not proceed.**

## The Decision Record

The artifact you produce at each decision point. It is *our* concrete realization of
AI-DLC's "human validates before AI proceeds" loop — AWS states the principle; the
Decision Record is how this kit makes it auditable. Fields:

| Field | Meaning |
| --- | --- |
| `decision_id` | Stable identifier. |
| `transition` | Which gate (one of the four above). |
| `unit_of_work` | The unit(s) this decision covers. |
| `chosen_option` | What you decided (e.g. "approve plan A", "request changes"). |
| `rationale` | Why — the business/technical reasoning you own. |
| `approver` | You, the human arbiter (the single human in the solo model). |
| `date` | When recorded. |
| `risk_tier` | The unit's risk tier (below), so depth is auditable. |

A high-risk decision additionally records the **alternatives considered** and an
explicit risk note (and may warrant an ADR).

## Risk-tier triage (right-sizing ceremony depth)

AWS warns against **"one-size-fits-all rigidity."** This kit avoids it by scaling
ceremony **depth** to a unit of work's **risk tier** — the ceremonies stay the same;
only how much challenge you apply changes. This is a faithful application of AWS's
anti-rigidity guidance, **not** an AWS-named tiering scheme.

| Tier | When | Ceremony depth | Decision Record |
| --- | --- | --- | --- |
| **Trivial** | Low-risk, reversible, narrow scope (copy fix, isolated config). | Lightweight: a single proposer, no full mob round; you may approve inline. | Still required for the gate, but may be terse (one-line rationale). |
| **Standard** | A typical feature unit of work. | Full Solo Mob: a lead proposes, ≥1 challenge agent contests, you decide. | Full Decision Record at each transition. |
| **High-risk** | Irreversible, security-sensitive, broad blast radius, or high ambiguity. | Deepest: multiple challenge agents incl. security/adversarial review, explicit options surfaced. | Full Decision Record **plus** recorded alternatives and an explicit risk note; consider an ADR. |

Rules:

- The tier is set on the unit of work at Inception (`risk_tier`) and may be
  **escalated** if Construction reveals more risk — **never silently downgraded.**
- Triage **reduces ceremony, never the arbiter gate.** Even a trivial unit crosses a
  human decision point; triage changes *how much challenge*, not *whether you decide*.
  The human-as-arbiter principle holds at every tier.
