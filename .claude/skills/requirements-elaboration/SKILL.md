---
name: requirements-elaboration
description: The craft of turning business intent into requirements, user stories, and units of work during Inception's Solo Mob Elaboration — clarifying ambiguity first, writing testable acceptance criteria and explicit non-goals, and producing the Unit-of-Work handoff that opens Construction. Use when gathering or elaborating requirements, writing user stories or acceptance criteria, defining or decomposing units of work, deciding "what should we build" or scoping a feature, surfacing ambiguous or underspecified asks, setting a unit's risk_tier or bolt_time_box, or preparing the Inception → Construction sign-off. For the lifecycle loop and gates, see aidlc-workflow; for what a unit of work / bolt / arbiter IS, see aidlc-methodology.
---

# Requirements Elaboration (Inception · Solo Mob Elaboration)

The craft of turning a person's **business intent** into clear requirements, user
stories, and **units of work** — the Inception output that Construction consumes.
You are the `requirements-analyst` working the WHAT/WHY phase. This skill owns
producing the **Unit-of-Work contract**, the Inception → Construction handoff.

For *what* a unit of work, bolt, ceremony, or arbiter IS, read `aidlc-methodology`.
For the end-to-end loop and the blocking gates, read `aidlc-workflow` — **don't
re-derive them here.** This skill is the *how* of one stage: elaboration.

## The honest Solo Mob framing (state it; never overclaim)

> In AWS AI-DLC the mob ceremonies put **multiple humans** on a decision together
> in real time. AI-DLC for a solo developer adapts this: **AI specialist agents
> stand in for the absent human mob members to supply diverse, independent
> challenge, while you remain the sole arbiter who decides.** This is an
> adaptation, not a reproduction — agents can share blind spots that independent
> human stakeholders would not, so the diversity is weaker than a true human mob.

In elaboration this means: you and challenge agents **contest** the requirements
and the units of work — you do **not** decide them. The single human is the **sole
arbiter** at Gate 1. Use the name **Solo Mob Elaboration**; never the bare AWS
"Mob Elaboration" for the agent loop.

## The procedure

Work these steps in order. Don't skip step 1 — committing to requirements before
resolving ambiguity is the most expensive mistake in Inception.

### 1. Clarify before you commit — the question protocol

Surface ambiguity **as questions to the human arbiter, before** writing any
requirement. Intent arrives underspecified; guessing silently bakes the wrong
assumption into every downstream phase.

- **List the ambiguities**, don't paper over them. For each: what is unclear, why
  it matters, and the options you see.
- **Ask the highest-leverage questions first** — the ones whose answers most change
  scope, the domain model, or acceptance criteria.
- **Propose a default** with each question ("I'll assume X unless you say
  otherwise") so the human can confirm fast or correct cheaply.
- **Record assumptions you proceed on** so they are auditable at the gate — an
  unconfirmed assumption is a known risk, not a hidden one.
- **Batch** questions; don't trickle them one at a time. Stop and ask when an
  answer would change the shape of the work.

A blocking ambiguity (the answer changes scope or the domain model) means you
**wait** for the human. A non-blocking one travels as a recorded assumption.

### 2. Capture requirements and user stories

Turn confirmed intent into requirements and, where it fits the work, user stories.

- One requirement = one verifiable capability or constraint. Split compound asks.
- Prefer the user-story form **"As a `<role>`, I want `<capability>`, so that
  `<value>`"** when the value-to-a-user framing sharpens the WHAT. Use plain
  requirement statements for constraints, non-functional needs, and infrastructure.
- Keep requirements **solution-free** — they state WHAT and WHY, not HOW. Structure
  and tech choices belong to the `architect` (see `architecture-design`); order of
  work belongs to the `planner` (see `implementation-planning`). Don't pre-empt them.

### 3. Decompose into units of work

A **unit of work** is a **parallelizable chunk of value sized to fit a bolt** (the
hours-to-days cadence — see `aidlc-methodology`). Decompose so that each unit is
independently valuable, independently testable, and small enough for one bolt.

- Cut each unit as a **thin vertical slice** — a **walking skeleton** that runs
  end-to-end through every layer it touches (UI → logic → data, or caller → API →
  store), **not** a horizontal layer. A unit should deliver something a user or the
  system can actually exercise, not "the database part of everything". Slicing
  vertically prevents **orphan features by construction**: a slice has a
  user-reachable path the moment it exists, so no capability lands wired to nothing.
- Make units **parallelizable**: minimize cross-unit dependencies; record the ones
  that remain in `dependencies`.
- If a unit is too big for a bolt, split it **into thinner slices that each still
  run end-to-end** — never into orphan layers. If two units can't be tested apart,
  reconsider the seam.

### 4. Write testable acceptance criteria and explicit non-goals

These two fields are where elaboration quality lives — they become the
`test-engineer`'s oracle and the wall against scope creep.

- **Acceptance criteria** are **testable conditions that define "done"** — each one
  observable and checkable, not a vibe. Prefer concrete, binary phrasing
  ("returns 404 for an unknown id") over aspirations ("handles errors well").
  Write them so a `test-engineer` could derive a grading test from each one without
  guessing. They drive that oracle — see `aidlc-workflow`'s "don't edit the oracle".
- **Non-goals** state **what is deliberately excluded**. Make them explicit, not
  implied — an unstated exclusion becomes someone's silent assumption and then
  scope creep. Non-goals keep the unit "sized to be parallelizable".

A unit's `acceptance_criteria` and `non_goals` **seed the `spec-conformance`
checklist**: at this Inception step you are writing the line items that the
pre-merge review later checks the change against — requirement coverage, the
slice's end-to-end **reachability** path, and the **companion** docs/tests the
criteria imply. Write them concretely enough to be checked off later (the bare
phrase "definition of done" / "completeness" is a kit convention here — AWS AI-DLC
names neither; we express it over the native `acceptance_criteria` / `non_goals`
fields, scaled by `risk_tier`).

More patterns (good vs weak criteria, the INVEST lens, splitting strategies) are in
`reference/criteria-and-stories.md`.

### 5. Assign risk_tier, bolt_time_box, and ui_bearing

- **`risk_tier`** is one of **`trivial` / `standard` / `high-risk`**. It sets how
  much ceremony the unit gets in Construction (depth scales; the gate never does —
  see `aidlc-workflow`'s triage). Trivial = low-risk, reversible, narrow. High-risk
  = irreversible, security-sensitive, broad blast radius, or high ambiguity. It may
  be **escalated** later, **never silently downgraded**.
- **`bolt_time_box`** records the **intended hours-to-days window** for the unit.
  It is **documentation/intent only — not an enforced timer.** Do not invent a
  countdown, burndown, or cutoff; AI-DLC prescribes none (see `aidlc-methodology`).
- **`ui_bearing`** you set **true when the unit renders something a person sees and
  operates** (a UI surface), **false otherwise**. You **propose, you do not decide**
  it; the arbiter confirms it at Gate 1.

The design-system / UX lens engages only when `ui_bearing` is true; depth scales by
`risk_tier × ui_bearing`; non-UI units skip the lens but cross the same
Gate-1/arbiter sign-off as every unit — triage reduces challenge depth, never the
gate. `ui_bearing` is our faithful application of AWS AI-DLC's proportionality
guidance, not an AWS-named scheme; AWS names no such field.

### 6. Produce the Unit-of-Work handoff and reach Gate 1

Emit each unit as the **Unit-of-Work contract** below — a real, structured
artifact, not prose. Then the work reaches the **Inception → Construction Decision
Record checkpoint (Gate 1)**: the human arbiter reviews the requirements and units
and records an **approve** Decision Record. **The gate is closed until that record
exists** — Construction must not start without it (`aidlc-workflow`). You produce
and contest the units; you do **not** record the decision — that is the human's.

## The Unit-of-Work output contract (Inception → Construction handoff)

This is the artifact this skill **owns**. Ship every unit with **all** fields. Use
these exact field names — Construction consumes a known shape.

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Stable identifier for the unit. |
| `title` | yes | One-line name of the value delivered. |
| `scope` | yes | What is in this unit — the WHAT, concretely. |
| `acceptance_criteria` | yes | Testable conditions that define "done". Drive the `test-engineer`'s oracle. |
| `non_goals` | yes | What is deliberately excluded — prevents scope creep; keeps the unit parallelizable. |
| `dependencies` | yes (may be empty) | Other units this one needs; supports parallelization decisions. |
| `bolt_time_box` | yes | Intended bolt window (hours–days). Documentation/intent field — **not** an enforced timer. |
| `risk_tier` | yes | `trivial` / `standard` / `high-risk` — sets ceremony depth. |
| `ui_bearing` | yes | `boolean` — Whether this unit renders something a person sees and operates (UI surface) — engages the design-system / UX lens; non-UI units skip it. Proposed by the analyst, arbiter-confirmed at Gate 1. |
| `arbiter_signoff` | yes | Reference to the Gate 1 Decision Record approving this unit. |

`bolt_time_box` records intent only — no timer, burndown, or cutoff exists in
AI-DLC. The full handoff chain and downstream contracts are in
`aidlc-workflow`'s `reference/artifacts.md`.

## Done criteria for elaboration

- Blocking ambiguities resolved with the human; non-blocking ones recorded as
  assumptions.
- Requirements are solution-free and verifiable; user stories carry role +
  capability + value where used.
- Every unit is independently valuable and bolt-sized, with testable
  `acceptance_criteria` and explicit `non_goals`.
- Every unit carries all Unit-of-Work fields, including `risk_tier` and
  `bolt_time_box`.
- Every unit carries `ui_bearing`, proposed from the UI boundary test
  (arbiter-confirmed at Gate 1).
- The Gate 1 Decision Record exists (`chosen_option = approve`) before Construction
  starts; `arbiter_signoff` references it.

## Cross-references

- Concepts (unit of work, bolt, ceremony, arbiter, values): `aidlc-methodology`.
- The lifecycle loop, gates, triage, handoff schemas: `aidlc-workflow`
  (`reference/artifacts.md` for the full contract chain).
- Next phase: structure → `architecture-design`; sequence → `implementation-planning`.
- Deeper craft (acceptance-criteria patterns, story splitting, the question
  protocol): read `reference/criteria-and-stories.md`.
