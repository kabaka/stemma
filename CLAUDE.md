# Stemma — AI-DLC operating manual

Stemma is a **local-first family-health & hereditary-pattern tool**. It is developed
**AI-first (AI-DLC)**: there is no human engineering team — the maintainer drives AI agents
against [`docs/ROADMAP.md`](docs/ROADMAP.md). This file is the standing contract for that work.
Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design and [`CONTRIBUTING.md`](CONTRIBUTING.md)
for conventions.

@AGENTS.md

## Claude-Code specifics

The orchestrator definition above (imported from `AGENTS.md`) is canonical. The notes below and the
rest of this file are the Claude-Code-specific and Stemma-specific contract that rides on top of it.

- **You are the Orchestrator** — the main Claude Code session. Delegate substantial work via the
  **Agent tool** to the agents in `.claude/agents/`; skills in `.claude/skills/` load on demand, and
  some agents preload a skill via their `skills:` frontmatter. The maintainer is the product owner
  and **sole arbiter**.
- **Dispatch independent work in parallel** by issuing multiple Agent calls in one turn — fan out
  `researcher`s during Inception, run dual `planner`s and parallel reviewers during Construction.
- **The four arbiter gates are documented discipline in Stemma** — a Decision Record committed under
  [`.ai-dlc/records/`](.ai-dlc/records/), not a wired git-hook (see that dir's README). The record is
  still required; absence of a record = closed gate.
- **Protect context**: prefer the `Explore` agent and read-only specialists over reading large files
  yourself; ask subagents for summaries plus file paths.
- **Editing the kit live**: SKILL.md text edits are picked up mid-session; new skill directories and
  edited agent files need a restart (or `/agents`) before they are live. Use `kit-extender` (never a
  wholesale replacement) to tailor the kit.

## Clinical-safety guardrails (non-negotiable)

Stemma is **decision-support, not a diagnostic device.** These rules bind every change and every
agent — above the lifecycle mechanics — and are what the `clinical-safety-reviewer` agent checks:

1. **Never manufacture a risk number.** The engine reports *patterns* and the *specific
   published criterion met* (e.g. "meets common criteria to discuss BRCA1/2 testing"), never a
   computed relative-risk multiplier or probability. Absolute risk only ever comes from a
   validated external model, with its confidence range, clearly attributed.
2. **Advice stays advisory and referral-oriented.** Any recommendation string is a prompt to
   raise with a clinician — not an instruction, diagnosis, or treatment plan.
3. **The clinical boundary is a first-class UI element,** not a footer. Every surface that shows
   analysis restates that Stemma is not a diagnostic device.
4. **Genetics vs. identity vs. screening are separate axes** (2022 NSGC): sex-assigned-at-birth
   drives the genetics and pedigree geometry; gender identity drives display; the organ
   inventory drives screening. Never key screening off gender.
5. **No lock-in, private by default.** Data stays in the browser; the only runtime network call
   is the optional vocabulary lookup. Everything is exportable to an open standard.

## Architecture & layering (enforced)

Dependencies point **inward**; the core is pure. Put new code in the **lowest** layer that can hold it.

| Layer | Path | May import | Must never import |
| --- | --- | --- | --- |
| Pure core | `src/domain/`, `src/data/` | each other | `store`, `ui`, `integrations`, `export`, `import`, React, the network |
| Ports | `src/integrations/` | `domain` (types) | `store`, `ui` |
| Export | `src/export/` | `domain`, `data` | `store`, `ui` |
| Import | `src/import/` | `domain`, `data` | `store`, `ui` |
| Store | `src/store/` | `domain`, `data`, `integrations` | `ui` |
| UI | `src/ui/` | everything below | — |

- **`src/domain/` is pure and fully unit-tested.** No React, no `fetch`/`localStorage`, no wall
  clock. Functions that need "now" take an `asOfYear` (or timestamp) argument.
- **The condition catalog is generated.** Never hand-edit `src/data/conditions.ts`; edit
  `scripts/gen-conditions.mjs` (including its verified code maps) and run `npm run gen:conditions`.
- **Two-layer catalog:** curated conditions are the engine's known set; the ICD-10 long tail is
  reached through the `VocabularyProvider` port. Don't hardcode long-tail codes into the catalog.

## The workflow — run the AI-DLC lifecycle

Every request runs the AI-DLC loop (Inception → Construction → Operations) with the maintainer as
sole arbiter. The full procedure — arbiter gates, Solo Mob ceremonies, units of work, complexity
triage — lives in the **`aidlc-workflow`** skill; **load it and follow it.** Concepts are in
**`aidlc-methodology`**. In practice:

1. **Right-size the ceremony to the risk.** A typical roadmap item is *standard-tier*: run the
   **`/roadmap-task`** fast-path (scope → design → implement in the right layer → deterministic
   tests → `npm run check` → verify in-app → safety review → commit), recording a terse Decision
   Record at each gate. Anything touching the guardrails or risk/advice/screening/identity logic is
   *high-risk*: run the full `aidlc-workflow` — real Inception, dual planners, a wider challenge
   round, explicit Decision Records under `.ai-dlc/records/`.
2. **Design before code.** Stand up `software-architect` (and `medical-domain-expert` /
   `medical-coder` for clinical logic) *before* building; the gate approves the layered design.
3. **Add/extend co-located tests** (`*.test.ts`). Domain and export tests are deterministic — pass
   an explicit as-of year/timestamp; never assert against the wall clock. `test-engineer` owns the
   oracle; the implementer never edits it to pass.
4. **`npm run check` must pass** before every commit (`format:check` + `lint` + `typecheck` +
   `test:run`). CI runs the same gate plus a catalog-staleness check and the build. If you touched
   the catalog, run `npm run gen:conditions` and commit the regenerated file.
5. **Verify in the running app** for non-trivial changes (`npm run dev`), not just tests. Confirm
   the clinical-boundary text is present on any new analysis surface.
6. **Review gate before merge:** `code-reviewer` + `clinical-safety-reviewer` both clear (they can
   block), plus `security-privacy-reviewer` / `accessibility-reviewer` / `medical-domain-expert` /
   `test-engineer` as the change warrants. Fix findings before commit.
7. **Commit** with the sign-off trailers already used in the history.

## The team (agents & skills)

Stemma ships a full AI-DLC specialist team; **stand up the relevant members before substantial work,
not after.** The Orchestrator coordinates; the agents propose and contest; the maintainer decides.
See [`AGENTS.md`](AGENTS.md) for the full roster and routing boundaries, and
[`docs/AI-DLC.md`](docs/AI-DLC.md) for how they compose.

**Lifecycle agents** — `requirements-analyst`, `researcher`, `research-synthesizer` (Inception);
`software-architect`, `planner`, `implementer`, `frontend-engineer`, `test-engineer` (Construction);
`devops`, `observability`, `debugger` (Operations & RCA).

**Stemma domain specialists** — `clinical-safety-reviewer`, `medical-domain-expert`, `medical-coder`,
`accessibility-reviewer`, `security-privacy-reviewer`, `technical-writer`, `code-reviewer`. On-demand:
`kit-extender` (tailor the kit, propose-for-approval).

**Skills** — the lifecycle/methodology playbooks (`aidlc-workflow`, `aidlc-methodology`,
`requirements-elaboration`, `architecture-design`, `implementation-planning`, `testing-strategy`,
`code-review`, `spec-conformance`, `rca-investigation`, `research-method`, `citation-verification`,
`delivery-operations`, `observability-practice`, `security-review`, `dependency-compliance`,
`ux-design`, `design-system`, `stack-binding`, `writing-docs`, `conventional-commits`,
`extending-the-kit`) plus Stemma's Construction fast-paths: **`/roadmap-task`** (umbrella loop) ·
**`/add-condition`** · **`/add-pattern`** · **`/add-export`**.

**Default review gate before committing non-trivial work:** `code-reviewer` +
`clinical-safety-reviewer`, plus `security-privacy-reviewer` (anything touching data/network/deps),
`accessibility-reviewer` (any UI), and `medical-domain-expert` (any clinical logic). Fix findings
before commit.

## Commands

```bash
npm run dev              # dev server (http://localhost:5173)
npm run check            # the full gate — must be green before commit
npm run gen:conditions   # regenerate src/data/conditions.ts
npm run build            # production build (GITHUB_PAGES=true for the Pages base path)
```
