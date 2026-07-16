# AI-DLC — how Stemma is developed

Stemma has **no human engineering team**. It is built with an **AI Development Life Cycle
(AI-DLC)**: the maintainer drives a team of AI specialist agents against [`ROADMAP.md`](./ROADMAP.md),
and the repository ships the toolkit those agents use. This document describes the model; the
canonical, always-loaded contract is [`../AGENTS.md`](../AGENTS.md) (imported by
[`../CLAUDE.md`](../CLAUDE.md)).

The kit's job is to make AI-authored changes land **complete and safe by default** — in the right
architectural layer, deterministically tested, gated by the maintainer, verified in the app, and
checked against the clinical-safety guardrails — without a human reviewer as the safety net.

## The orchestration model

The main session is the **Orchestrator**. It does not do the substantial work itself: it decomposes
the request, delegates to specialist agents, runs adversarial challenge, gates on the maintainer's
decisions at the phase transitions, and reports back. The maintainer is the **product owner and sole
arbiter** — they decide; they do not implement.

Work flows through the three AI-DLC phases, threaded by one repeating pattern — the **human-arbiter
loop**: AI proposes and contests; the maintainer decides. Four transitions are **blocking gates**.

| Phase | What happens | Lead agents | Arbiter gate |
| --- | --- | --- | --- |
| **Inception** (WHAT/WHY) | Turn a roadmap item into **units of work** with acceptance criteria, non-goals, and a `risk_tier`. | `requirements-analyst`, `researcher` + `research-synthesizer`, `medical-domain-expert` | **Gate 1** — requirements + units approved |
| **Construction** (HOW) | Design → plan → build → test → review, in the right layer. | `software-architect`, `planner`, `implementer` / `frontend-engineer`, `test-engineer` | **Gate 2** — design/plan approved; **Gate 3** — merge approved |
| **Operations** (run it) | Vite build → GitHub Pages publish; measurement; incident RCA. No mob ceremony — standing oversight. | `devops`, `observability`, `debugger` | **Gate 4** — release/publish authorized |

### Solo Mob — the honest adaptation

AWS AI-DLC's "mob" ceremonies put multiple humans on a decision together. Stemma is a solo project,
so **AI specialist agents stand in for the absent human mob** to supply independent challenge, while
the maintainer remains the sole arbiter. This is an adaptation, not a reproduction — agents can share
blind spots real independent stakeholders would not. The ceremonies are **Solo Mob Elaboration**
(Inception) and **Solo Mob Construction** (Construction); Operations has none.

### The arbiter gates — documented discipline

Each of the four gates is a **Decision Record** committed under [`../.ai-dlc/records/`](../.ai-dlc/records/)
(`chosen_option: approve` opens the gate; absence = closed gate). Stemma honors these by **discipline
plus the committed record** rather than the kit's optional `jq` git-hook, which fits a solo maintainer
on a local-first static site. **Complexity triage** scales the *ceremony depth* to each unit's
`risk_tier` — trivial units get a terse record, high-risk units (anything touching the guardrails)
get alternatives-considered and a risk note — but every unit crosses a gate. Triage reduces
challenge, never the arbiter decision.

## The team

Full roster, mutation permissions, and routing boundaries are in [`../AGENTS.md`](../AGENTS.md).
**Stand the relevant members up first** — design with the architect and domain expert *before*
coding, build with the engineers, gate with the reviewers — because doing the substantial work
through the team, not after it, is what produces the quality. Delegate independent members in
parallel.

- **Lifecycle agents** run the phases: `requirements-analyst`, `researcher`, `research-synthesizer`,
  `software-architect`, `planner`, `implementer`, `frontend-engineer`, `test-engineer`, `devops`,
  `observability`, `debugger`.
- **Stemma domain specialists** carry the clinical/quality bar and act as challenge/review agents:
  `clinical-safety-reviewer`, `medical-domain-expert`, `medical-coder`, `accessibility-reviewer`,
  `security-privacy-reviewer`, `technical-writer`, `code-reviewer`.
- **`kit-extender`** is on-demand: it assesses this repo and proposes tailored skills/agents behind a
  propose-for-approval gate. It is not a lifecycle phase.

The **merge gate** before integration is `code-reviewer` + `clinical-safety-reviewer` (both can
block), plus `security-privacy-reviewer` / `accessibility-reviewer` / `medical-domain-expert` /
`test-engineer` as the change warrants.

## Skills

Each is a `SKILL.md` with a trigger `description` and a procedure, loaded on demand (some agents
preload theirs via `skills:` frontmatter). Invoke with `/<name>` or let it trigger on matching work.

- **Methodology & lifecycle**: `aidlc-methodology` (concepts), `aidlc-workflow` (the step-by-step loop).
- **Inception**: `requirements-elaboration`, `research-method`, `citation-verification`.
- **Construction**: `architecture-design`, `implementation-planning`, `testing-strategy`,
  `code-review`, `spec-conformance`, `rca-investigation`.
- **Operations**: `delivery-operations`, `observability-practice`.
- **Cross-cutting**: `security-review`, `dependency-compliance`, `ux-design`, `design-system`,
  `stack-binding`, `writing-docs`, `conventional-commits`.
- **Stemma Construction fast-paths** (the standard-tier procedures the lifecycle invokes):
  - **`/roadmap-task`** — the umbrella loop for a unit of product work: scope → design → implement in
    the right layer → deterministic tests → `npm run check` → verify in-app → safety review → commit.
  - **`/add-condition`** — add or edit a curated condition; enforces the "catalog is generated" rule
    and routes code lookups through `medical-coder`.
  - **`/add-pattern`** — add a hereditary red-flag rule to the pure engine; enforces the
    criterion-not-a-number guardrail, determinism, and paired positive/negative tests.
  - **`/add-export`** — add a standards serializer; enforces purity, determinism, and dual-coding.
- **Kit extension**: `extending-the-kit` (the `kit-extender` playbook).

## Why this shape

- **Orchestration, not a solo author.** The Orchestrator + gated lifecycle is what keeps AI-authored
  change converging and reviewed instead of a single session doing everything and consulting reviewers
  late (or not at all). The gates put the maintainer in control at the decisions that matter.
- **Guardrails as code, not vibes.** The clinical-safety rules that make a health tool trustworthy
  live in `CLAUDE.md`/`AGENTS.md` and are enforced by `clinical-safety-reviewer`, so they survive
  across sessions and authors.
- **Purity is the testability lever.** Keeping `src/domain/` pure and deterministic is what lets an
  agent add a pattern rule and *prove* it with a unit test. The skills and the reviewers defend that
  boundary.

## Extending the kit

Tailor the kit through **`kit-extender`** (propose-for-approval into a staging dir), following the
`extending-the-kit` skill — **never by wholesale-replacing the orchestration layer.** Add a skill when
a task recurs and has a right way to do it; add an agent only when a task needs a genuinely new,
reusable role. Follow the existing `SKILL.md` / agent front-matter conventions (a precise,
trigger-friendly `description` is what makes them fire at the right time), keep them short and
imperative, and have them point at the design docs rather than duplicating them.
