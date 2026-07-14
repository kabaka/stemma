# AI-DLC — how Stemma is developed

Stemma has **no human engineering team**. It is built with an **AI Development Life Cycle
(AI-DLC)**: the maintainer drives AI agents against [`ROADMAP.md`](./ROADMAP.md), and the
repository ships the toolkit those agents use. This document describes the model and the kit.

The kit's job is to make AI-authored changes land **complete and safe by default** — in the right
architectural layer, deterministically tested, gated, verified in the app, and checked against the
clinical-safety guardrails — without a human reviewer as the safety net.

## The pieces

Three kinds of artifact encode the project's knowledge so every session starts aligned:

| Artifact | Where | Role |
| --- | --- | --- |
| **Operating manual** | [`../CLAUDE.md`](../CLAUDE.md) | Loaded every session: the guardrails, the layering rules, the workflow, the commands. The standing contract. |
| **Skills** | `.claude/skills/*/SKILL.md` | Task playbooks that trigger on matching work and encode the correct procedure. |
| **Agents** | `.claude/agents/*.md` | Specialist sub-agents for review and coding, invoked within a task. |

Design docs ([`ARCHITECTURE.md`](./ARCHITECTURE.md), [`ROADMAP.md`](./ROADMAP.md)) and
[`../CONTRIBUTING.md`](../CONTRIBUTING.md) provide the deeper reference the manual points to.

## Skills

Each is a `SKILL.md` with a trigger `description` and a procedure. Invoke with `/<name>` or let it
trigger on matching work.

- **`/roadmap-task`** — the umbrella loop for a unit of product work: scope → design → implement in
  the right layer → deterministic tests → `npm run check` → verify in-app → safety review → commit.
  Start here for anything non-trivial; it delegates to the focused skills below.
- **`/add-condition`** — add or edit a curated condition. Enforces the "catalog is generated"
  rule and the two-layer model, and routes code lookups through the `medical-coder` agent.
- **`/add-pattern`** — add a hereditary red-flag rule to the pure engine. Enforces the
  criterion-not-a-number guardrail, determinism, and paired positive/negative tests.
- **`/add-export`** — add a standards serializer. Enforces purity, determinism, and dual-coding.

## Agents — the specialist team

Stemma ships a full software-engineering team as `.claude/agents/*.md`. **Stand the relevant
members up first** — design with the architect and domain expert *before* coding, build with the
engineers, and gate with the reviewers — because doing the substantial work through the team, not
after it, is what produces the quality. Delegate independent members in parallel.

| Agent | Kind | Role |
| --- | --- | --- |
| `software-architect` | design | layered design + architectural review; guards seams for the roadmap |
| `frontend-engineer` | build | React/TS UI implementation & review; knows the store, hooks, theme |
| `test-engineer` | build | coverage assessment + deterministic Vitest tests; a regression test per bug |
| `technical-writer` | build | keeps README/CONTRIBUTING/ARCHITECTURE/ROADMAP/JSDoc accurate & in sync |
| `medical-coder` | build | verified ICD-10-CM / SNOMED / HPO / RxNorm codes (never guesses) |
| `code-reviewer` | review | general correctness/quality review |
| `clinical-safety-reviewer` | review | the guardrails + layering/purity + determinism + faithful semantics |
| `medical-domain-expert` | review | clinical accuracy vs. published guidelines, grounded in PubMed/ICD evidence |
| `security-privacy-reviewer` | review | no-exfiltration, XSS/injection, supply chain, PHI handling |
| `accessibility-reviewer` | review | WCAG 2.1 AA + inclusive design (colour-independent meaning) |

The **review gate** before committing non-trivial work is `code-reviewer` +
`clinical-safety-reviewer`, plus `security-privacy-reviewer` / `accessibility-reviewer` /
`medical-domain-expert` / `test-engineer` as the change warrants.

## Why this shape

- **Guardrails as code, not vibes.** The clinical-safety rules that make a health tool trustworthy
  (never a manufactured risk number; advice stays advisory; genetics/identity/screening are
  separate axes) live in `CLAUDE.md` and are enforced by the reviewer agent, so they survive
  across sessions and authors.
- **Purity is the testability lever.** Keeping `src/domain/` pure and deterministic is what lets an
  agent add a pattern rule and *prove* it with a unit test instead of a screenshot. The skills and
  the reviewer both defend that boundary.
- **The catalog is generated, the long tail is a port.** Encoding "don't hand-edit the catalog"
  and "reach the ICD-10 long tail through the adapter" into the kit prevents the most likely
  data-integrity mistakes.

## Extending the kit

Add a skill when a task recurs and has a right way to do it; add an agent when a task needs a
distinct, reusable specialist. Follow the existing `SKILL.md` / agent front-matter conventions
(a precise, trigger-friendly `description` is what makes them fire at the right time), keep them
short and imperative, and have them point at the design docs rather than duplicating them.
