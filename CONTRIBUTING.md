# Contributing to Stemma

Stemma is developed **AI-first** (AI-DLC): there is no human dev team to onboard. Changes are
made by AI agents driven by the maintainer. This document is therefore a set of *conventions and
invariants* an agent must hold to — not a human onboarding, CLA, or review-etiquette guide.

If you are that agent: read this file, read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and
keep both open while you work. The product vision lives in
[`prototype/uploads/Lineage-expansion-ideation.md`](prototype/uploads/Lineage-expansion-ideation.md).

## The prime directives

1. **`npm run check` must be green before every commit.** No exceptions.
2. **`src/domain/` stays pure.** No React, no I/O, no store.
3. **Never hand-edit `src/data/conditions.ts`.** Regenerate it.
4. **The engine never manufactures a risk number, and advice stays advisory.**

The rest of this document expands on these.

## Layering — where code goes

Dependencies point **inward**. A layer may import from the layers below it, never above.

| Layer | Directory | May depend on | Must never import |
| --- | --- | --- | --- |
| Pure core | `src/domain/`, `src/data/` | each other (both pure) | `store`, `ui`, `integrations`, React, the network |
| Ports | `src/integrations/` | `domain` (types) | `store`, `ui` |
| Export | `src/export/` | `domain`, `data` | `store`, `ui` |
| Orchestration | `src/store/` | `domain`, `data`, `integrations` | `ui` |
| Views | `src/ui/` | everything below | — |

When adding code, put it in the **lowest** layer that can hold it. Reusable logic and math belong
in `domain`; curated constants belong in `data`; anything that touches the network or a third-party
service belongs behind a port in `integrations`; React-only concerns belong in `ui`.

## Invariant: `src/domain/` is pure and fully tested

The domain engine is the part clinicians would scrutinize, so it is kept deterministic, pure, and
unit-tested:

- **No React.** No components, hooks, or JSX.
- **No I/O.** No `fetch`, no `localStorage`, no timers, no `console` side effects. (It *may* read
  the pure, curated data tables in `src/data` — e.g. `patterns.ts` reads `RECS` from
  `src/data/recommendations.ts`. Those are constants, not I/O.)
- **No store imports.** Domain functions take a `FamilyRecord` (and an explicit `asOfYear` where
  time matters) as arguments and return plain values. They do not read global state.
- **Every domain module has co-located tests** (`*.test.ts`) that exercise it against known
  pedigrees — primarily the seed family in `src/data/seed.ts`.

If a change to `domain` needs data from the outside world, it does **not** reach out — the caller
(`store`/`ui`) passes it in.

## The condition catalog — regenerate, never hand-edit

`src/data/conditions.ts` is **generated** and carries a `DO NOT EDIT BY HAND` banner. It is derived
by `scripts/gen-conditions.mjs` from the self-contained base catalog
(`scripts/conditions.source.json`) enriched with verified ICD-10-CM and SNOMED CT code maps.

To change the curated catalog:

```bash
# 1. Edit the source of truth — the base catalog and/or the code maps in the script:
#    scripts/conditions.source.json  (id, name, cat, base, pattern, syn)
#    scripts/gen-conditions.mjs      (the SNOMED / ICD10 maps, COMMON list)
# 2. Regenerate:
npm run gen:conditions
# 3. Run the gate (the generated file is committed):
npm run check
```

Editing `src/data/conditions.ts` directly will be silently reverted the next time anyone runs the
generator — so don't.

## How to extend Stemma

### Add a curated condition
Add it to `scripts/conditions.source.json`; if it is high-signal, add its ICD-10-CM/SNOMED codes to
the maps in `scripts/gen-conditions.mjs` and (optionally) to the `COMMON` list. Run
`npm run gen:conditions`. Use a valid `CategoryKey` (the generator asserts this at module load).
The long tail of ICD-10 does **not** go here — it is reached at runtime via the vocabulary port.

### Add a pattern rule
Extend `detectPatterns` in `src/domain/patterns.ts`. A rule inspects the affected blood relatives
(use the `withCond(code)` helper), decides whether a published criterion is met, and pushes a
`PatternFlag` with: a `severity` (`referral` | `discuss` | `note`), the **specific `criterion`
string** that was met, and an **advisory `rec`** (see the clinical-safety rule below). Add tests to
`patterns.test.ts` — a positive case *and* a negative case (a pedigree that must **not** trip it),
passing an explicit `asOfYear`.

### Add an export format
Create the module under `src/export/` alongside the existing serializers (FHIR, Phenopacket, GEDCOM,
pedigree SVG) and re-export it from `src/export/index.ts`. It reads a `FamilyRecord` (plus the
catalog) and returns a string/object. Keep it pure and deterministic — accept any timestamp via an
options argument rather than calling the wall clock, so fixtures stay stable — and unit-test it
against the seed record. Do not import `store` or `ui`.

### Add a vocabulary provider
Implement the `VocabularyProvider` port in `src/integrations/vocabulary.ts` (fields: `name`,
`system`, and `search(query, opts)` returning `VocabularyHit[]`). This is the extension point for a
fuller terminology server (SNOMED/UMLS, a FHIR `$expand`) in a self-hosted deployment. The default
`NlmClinicalTablesProvider` must remain CORS-safe and API-key-free so the static build keeps working.

## Test conventions

- **Vitest + Testing Library**, jsdom environment (config in `vite.config.ts`, setup in
  `vitest.setup.ts`).
- **Co-locate** tests as `*.test.ts` next to the code they cover.
- **Determinism is mandatory.** Never assert against the wall clock. Domain functions that reason
  about age take an explicit `asOfYear`; timeline events use explicit years. Tests pass fixed values
  (the suites use `const AS_OF = 2026`). The store binds `asOfYear` to `new Date().getFullYear()` —
  that binding lives in `store`, never in `domain`, and never in a test assertion.
- Prefer the seed family (`src/data/seed.ts`) as the fixture; construct minimal ad-hoc records for
  edge cases (see the sparse-pedigree test in `patterns.test.ts`).
- Run `npm run test` (watch) while iterating; `npm run test:run` (and `npm run check`) before
  committing.

## Code style

- **Strict TypeScript.** `strict` is on, plus `noUnusedLocals`/`noUnusedParameters` and
  `verbatimModuleSyntax`. **No `any`.** Prefix intentionally-unused bindings with `_`.
- **`import type` for type-only imports** (`verbatimModuleSyntax` enforces the split). Use the `@/`
  alias for cross-layer imports (`@/domain/types`), relative paths within a layer (`./person`).
- **Prettier owns formatting** — single quotes, semicolons, trailing commas, 100-column width,
  2-space indent. Run `npm run format` (or `format:check` in the gate). ESLint (flat config, 9.x)
  enforces the lint rules; keep it clean, don't disable rules to pass.

## Commit conventions

Use short, conventional-ish, imperative subjects with a type prefix:

```
feat(patterns): add Li-Fraumeni red-flag rule
fix(graph): correct MRCA selection for half-siblings
docs(architecture): document the vocabulary port
chore(deps): bump vite to 5.4.x
test(screening): cover organ-inventory overrides
```

Keep commits focused; if a change regenerates `conditions.ts`, commit the generated output in the
same commit as the source change.

## The clinical-safety rule

This is non-negotiable and load-bearing for the whole product:

- **The engine must never emit a fabricated risk number.** No relative-risk multipliers, no
  invented percentages, no "risk score." Stemma detects *patterns* and cites the *criterion met*.
  Where a real number is warranted, it defers to a validated external calculator (CanRisk, PREMM5,
  ASCVD) — it does not reinvent one. (Rationale: roadmap §2 /
  [`Lineage-expansion-ideation.md`](prototype/uploads/Lineage-expansion-ideation.md) §2.)
- **Every advice string stays advisory and referral-oriented.** `rec` and recommendation text are
  prompts to raise with a clinician ("consider a genetics referral", "discuss timing with your
  clinician") — never a diagnosis, an instruction, or a promise. If you cannot phrase a suggestion
  as something a patient takes *to* a professional, it does not belong in Stemma.
