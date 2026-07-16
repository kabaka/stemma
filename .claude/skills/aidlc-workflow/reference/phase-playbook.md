# Per-phase playbook

Lead/challenge rosters, gate placement, and the ceremony per phase. "Lead" =
primary proposer; "challenge" = the agents that supply the Solo Mob diverse-
challenge function (stand-ins for absent human mob members). Agent names are the
consumer roster (ADR-0004).

## Contents

- [Solo Mob — the honest framing](#solo-mob)
- [Inception](#inception)
- [Construction](#construction)
- [Operations](#operations)

## Solo Mob

The challenge agents stand in for the **absent human mob members** to supply
diverse, independent challenge; **the human is the sole arbiter who decides.** This
is an adaptation of the AWS ceremony, **not** the multi-human ceremony itself —
agents can share blind spots independent human stakeholders would not, so the
diversity is weaker than a true human mob, and the lone human carries the full
accountability. Use **"Solo Mob Elaboration"** / **"Solo Mob Construction"**; never
the bare AWS terms for the agent loop.

## Inception

- **Question:** WHAT / WHY.
- **Ceremony:** Solo Mob Elaboration.
- **Lead:** `requirements-analyst`; `researcher` + `research-synthesizer` for
  open questions (fan-out — see `scaling.md`).
- **Challenge:** a second `requirements-analyst` pass contesting the requirements
  and the units of work (an independent challenge pass, not a separate agent).
- **Output:** the **Unit-of-Work** contract per unit (`artifacts.md`), carrying
  `bolt_time_box`, `risk_tier`, and `ui_bearing`.
- **Gate:** **Gate 1 — Inception → Construction** (requirements + units approved).

## Construction

- **Question:** HOW.
- **Ceremony:** Solo Mob Construction.
- **Design fork:**
  - **Lead:** `architect` (**structure** — how the system is shaped); `planner` ×2
    (**sequence** — in what order, dispatched twice for the Solo Mob round). For
    **`ui_bearing` units** the `design-system` lens engages (alongside `ux-design`),
    producing the **design contract** — tokens + UI-element inventory + state
    matrices — as Gate-2 evidence inside the architecture handoff. For those
    `ui_bearing` units the `architect`'s output also includes the **proposed
    `.ai-dlc/stack-binding.json`** (UI stack, browser, run/build commands the
    visual-QA tools target), arbiter-confirmed inside the existing Gate-2 Decision
    Record — no new gate, agent, or record-type.
  - **Challenge:** `code-reviewer`, `security` (depth per `risk_tier`).
  - **Output:** architecture handoff (the design contract and proposed
    stack-binding ride inside it for `ui_bearing` units), then plan handoff
    (`artifacts.md`).
  - **Visual-QA evidence:** the visual-QA tools (`.ai-dlc/scripts/visual-qa/`) are
    deterministic evidence feeding the **existing** Gate-2 and Gate-3 gates — not a
    new gate or agent. Static checks run freely; **app/browser execution is
    fail-closed** — human-confirmed per session, never auto-run from a freshly-pulled
    or changed `stack-binding.json` (running the app runs the consumer's own code, a
    residual risk; trusted repos only).
  - **Gate:** **Gate 2 — design fork** (architecture/plan approved before code).
- **Implementation + review:**
  - **Lead:** `implementer` builds the unit against the plan; `test-engineer` owns
    the grading-test **oracle**. **Implementer never edits the grading tests.**
  - **Output:** diff + tests handoff.
  - **Gate check:** `code-reviewer` (read-only) does the independent intent-vs-letter
    check and emits an enumerated verdict (`APPROVE` / `REQUEST_CHANGES` /
    `ESCALATE_SECURITY` / `BLOCK`). `ESCALATE_SECURITY` → hand off to `security`.
    As part of the same verdict, `code-reviewer` applies the **`spec-conformance`**
    convention against the unit's seeded checklist — requirement coverage vs
    `acceptance_criteria`, end-to-end reachability, companion freshness, and
    converge / anti-deferral — and **reopens any unmet or silently deferred item**
    as `REQUEST_CHANGES`. This is folded into the existing verdict; it adds no new
    verdict value.
  - **Converge diff (Gate-3 evidence):** before the Decision Record, run the
    delivered-vs-spec diff (the re-checked `spec-conformance` checklist from
    `artifacts.md`). It is **evidence for the existing Gate 3**, not a new gate,
    ceremony, or verdict.
  - **Gate:** **Gate 3 — merge** (unit approved for integration). Loop on
    `REQUEST_CHANGES` / `BLOCK`.

### Routing boundaries (avoid cross-fire)

- `architect` vs `planner`: **structure** vs **sequence**.
- `code-reviewer` vs `debugger` vs `security`: **pre-merge gate** vs **post-failure
  diagnosis** vs **deep/critical security escalation**.
- `researcher` vs `research-synthesizer`: **gather** (read-only fan-out) vs
  **synthesize** + run the citation gate (authoring).
- `implementer` vs `test-engineer`: implementer **may not edit grading tests**;
  test-engineer **owns the oracle**.

## Operations

- **Question:** run it.
- **Ceremony:** **none — standing human oversight.** Do **not** invent a "Mob
  Operations" or any mob ceremony. State the absence positively: "Operations has no
  mob ceremony in AI-DLC; human oversight is the constant."
- **Lead:** `devops` (deploy, infrastructure, monitoring).
- **Challenge / support:** `security` (review); `debugger` (post-failure incident
  RCA).
- **Output:** the operations record (`artifacts.md`).
- **Gate:** **Gate 4 — deploy/release** (each change authorized for deployment).
