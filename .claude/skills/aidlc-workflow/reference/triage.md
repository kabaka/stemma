# Complexity triage — right-sizing ceremony depth

Counters AWS's **"one-size-fits-all rigidity"** anti-pattern by scaling **ceremony
depth** to the unit's `risk_tier`. This is proportionality — **our faithful
application** of AWS's anti-rigidity guidance, not an AWS-named tiering scheme. The
ceremonies are the same at every tier; only their **depth** changes. The
**human-arbiter gate never scales away.**

## The tiers

| Tier | When | Ceremony depth | Decision Record |
| --- | --- | --- | --- |
| **Trivial** | Low-risk, reversible, narrow scope (copy fix, isolated config). | Lightweight: single proposer, no full mob round; arbiter may approve inline. | Still required for the gate it crosses, but may be terse (one-line rationale). |
| **Standard** | Typical feature unit of work. | Full Solo Mob ceremony: lead proposes, ≥1 challenge agent contests, arbiter decides. | Full Decision Record at each transition. |
| **High-risk** | Irreversible, security-sensitive, broad blast radius, or high ambiguity. | Deepest: multiple challenge agents incl. `security` / `code-reviewer`; explicit options surfaced; arbiter must record options-considered. | Full Decision Record **plus** recorded alternatives and an explicit risk note; consider an ADR. |

## Rules

- **Assign at Inception.** The tier is set on the unit of work (`risk_tier`).
- **Escalate, never silently downgrade.** If Construction reveals more risk, raise
  the tier and deepen the ceremony. Never quietly lower it.
- **Triage reduces challenge, never the gate.** Even a trivial unit crosses a human
  decision point. Triage changes *how much challenge* (how many challenge agents,
  how many options surfaced), **not** *whether the human decides*. This keeps the
  human-as-arbiter principle intact at all tiers — the single non-negotiable.
- **Don't present it as AWS's scheme.** Describe it as our application of AWS's
  "avoid one-size-fits-all rigidity" guidance.

## What scales vs. what doesn't

| Scales with tier | Never scales |
| --- | --- |
| Number of challenge agents in the Solo Mob round. | The existence of the arbiter gate. |
| Whether options/alternatives are explicitly surfaced and recorded. | The need for a human Decision Record to open a gate. |
| Decision Record verbosity (terse → options-considered + risk note). | Who decides (always the single human arbiter). |
| Whether an ADR is written. | The four gates' placement across phases. |
