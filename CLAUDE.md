# Stemma — AI-DLC operating manual

Stemma is a **local-first family-health & hereditary-pattern tool**. It is developed
**AI-first (AI-DLC)**: there is no human engineering team — the maintainer drives AI agents
against [`docs/ROADMAP.md`](docs/ROADMAP.md). This file is the standing contract for that work.
Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design and [`CONTRIBUTING.md`](CONTRIBUTING.md)
for conventions.

## Clinical-safety guardrails (non-negotiable)

Stemma is **decision-support, not a diagnostic device.** These rules bind every change and
are what the `clinical-safety-reviewer` agent checks:

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
| Pure core | `src/domain/`, `src/data/` | each other | `store`, `ui`, `integrations`, `export`, React, the network |
| Ports | `src/integrations/` | `domain` (types) | `store`, `ui` |
| Export | `src/export/` | `domain`, `data` | `store`, `ui` |
| Store | `src/store/` | `domain`, `data`, `integrations` | `ui` |
| UI | `src/ui/` | everything below | — |

- **`src/domain/` is pure and fully unit-tested.** No React, no `fetch`/`localStorage`, no wall
  clock. Functions that need "now" take an `asOfYear` (or timestamp) argument.
- **The condition catalog is generated.** Never hand-edit `src/data/conditions.ts`; edit
  `scripts/gen-conditions.mjs` (including its verified code maps) and run `npm run gen:conditions`.
- **Two-layer catalog:** curated conditions are the engine's known set; the ICD-10 long tail is
  reached through the `VocabularyProvider` port. Don't hardcode long-tail codes into the catalog.

## The workflow

1. Work a [`docs/ROADMAP.md`](docs/ROADMAP.md) item; keep changes in the right layer.
2. Add/extend **co-located tests** (`*.test.ts`). Domain and export tests must be deterministic —
   pass an explicit as-of year/timestamp; never assert against the wall clock.
3. **`npm run check` must pass** before every commit (`format:check` + `lint` + `typecheck` +
   `test:run`). CI runs the same gate plus a catalog-staleness check and the build.
4. For non-trivial changes, verify behavior in the running app (`npm run dev`), not just tests.
5. Commit with the sign-off trailers already used in the history.

## The team (skills & agents)

Stemma ships a specialist team; **stand up the relevant members before substantial work, not
after.** Design with the architect, build with the engineers, verify with the reviewers — in
parallel where independent. See [`docs/AI-DLC.md`](docs/AI-DLC.md) for how they compose.

**Skills** (task playbooks): **`/roadmap-task`** (the umbrella loop) · **`/add-condition`** ·
**`/add-pattern`** · **`/add-export`**.

**Agents** (delegate via the Agent tool):

| Role | Agent | Use for |
| --- | --- | --- |
| Architecture | `software-architect` | design & architectural review before/after building |
| Frontend | `frontend-engineer` | React/TS UI implementation & review |
| Testing | `test-engineer` | coverage assessment + deterministic tests |
| Code review | `code-reviewer` | general correctness/quality review |
| Clinical safety | `clinical-safety-reviewer` | the guardrails + layering + faithful semantics |
| Medical domain | `medical-domain-expert` | clinical accuracy vs. published guidelines (evidence-grounded) |
| Medical coding | `medical-coder` | verified ICD-10-CM / SNOMED / HPO / RxNorm codes |
| Security & privacy | `security-privacy-reviewer` | no-exfiltration, XSS, supply chain, PHI handling |
| Accessibility | `accessibility-reviewer` | WCAG 2.1 AA + inclusive design |
| Docs | `technical-writer` | keep docs accurate and in sync |

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
