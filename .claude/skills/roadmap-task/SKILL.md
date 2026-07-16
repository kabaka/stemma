---
name: roadmap-task
description: >-
  The end-to-end AI-DLC workflow for implementing a Stemma feature or roadmap item from start to
  reviewed commit. Use when picking up a unit of product work — a docs/ROADMAP.md item, a new
  capability, or a substantial change — and you want the full loop (scope, design, implement in
  the right layer, test, gate, verify, safety-review). Triggers: "implement <roadmap item>",
  "build the <feature>", "work the next roadmap task", "add <capability> to Stemma".
---

# Roadmap task — the standard-tier Construction fast-path

Stemma is built AI-first with no human dev team, so each change must land **complete**: scoped,
tested, gated, verified, and safety-reviewed. This is the **standard-tier fast-path** through the
AI-DLC lifecycle (`AGENTS.md` / `aidlc-workflow`) for a typical roadmap unit of work — the everyday
loop that already carries the Inception → Construction → Operations shape without the full ceremony.

**When to use the full lifecycle instead:** if the work is **high-risk** (touches the clinical-safety
guardrails, risk/advice/screening/identity logic, or has broad blast radius), or is novel/ambiguous
enough to need real Inception, run `aidlc-workflow` proper — dual planners, a wider Solo Mob challenge
round, and explicit Decision Records at each of the four gates under `.ai-dlc/records/`. Even on this
fast-path, the **arbiter gates still apply**: the maintainer signs off the scope, the design, and the
merge — record the decision (it may be terse for a standard unit). Follow this loop.

## 1. Scope
- Read the relevant [`docs/ROADMAP.md`](../../../docs/ROADMAP.md) item and
  [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md). Restate the goal and its acceptance in
  one or two sentences.
- Check the **clinical-safety guardrails** in [`CLAUDE.md`](../../../CLAUDE.md) — do they constrain
  this task? (Anything touching risk, advice, screening, or identity almost always does.)

## 2. Design (delegate to the architect for anything non-trivial)
- Have the **`software-architect`** agent produce the layered design and record the decision —
  what goes in which layer (domain → data → integrations → export → store → ui), the types/ports
  involved, and 2-3 alternatives with trade-offs. Pure logic goes in `domain` (no React/IO/wall-clock).
- If clinical logic is involved, get the criterion/guideline from the **`medical-domain-expert`**
  (evidence-grounded) and any codes from **`medical-coder`** *before* coding.
- If it's a well-known shape, use the focused skill: **`/add-condition`**, **`/add-pattern`**,
  **`/add-export`**. External services enter through a port in `integrations`, never a direct UI call.

## 3. Implement (with the specialist engineers)
- Work inside-out: land and test the pure core first, then the store wiring, then the UI. Keep the
  diff cohesive and in-layer; don't reach across layers or bypass the store.
- Delegate UI work to the **`frontend-engineer`** and test authoring to the **`test-engineer`**
  where that raises quality; run independent pieces in parallel.

## 4. Test
- Co-located `*.test.ts`. Domain/export tests must be **deterministic** — pass an explicit
  `asOfYear`/timestamp; never assert against the wall clock. Cover the new positive case and at
  least one negative/edge case (empty pedigree, unknown id, onset 0, null birth).

## 5. Gate
- `npm run check` must be green (`format:check` + `lint` + `typecheck` + `test:run`). If you
  touched the catalog, run `npm run gen:conditions` and commit the regenerated file (CI checks drift).

## 6. Verify in the app
- For anything with a runtime surface, run `npm run dev` and drive the actual flow (or the built
  app). Confirm the clinical-boundary text is present on any new analysis surface.

## 7. Review (run the relevant panel in parallel)
- Always: **`code-reviewer`** + **`clinical-safety-reviewer`**.
- Plus, by what the change touches: **`security-privacy-reviewer`** (data / network / deps),
  **`accessibility-reviewer`** (any UI), **`medical-domain-expert`** (clinical logic),
  **`test-engineer`** (coverage). Address every real finding before committing.

## 8. Commit
- One cohesive commit with the sign-off trailers used in the history. Update `docs/ROADMAP.md`
  (move the item, or note what shipped) if the roadmap changed.

## Definition of done
Right layer · deterministic tests · `npm run check` green · verified in-app · safety-reviewed ·
guardrails intact · roadmap updated.
