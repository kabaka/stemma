---
name: add-condition
description: >-
  Add or edit a condition in Stemma's curated catalog, or attach/verify its medical codes.
  Use when the task is to add a disease/condition to the catalog, give a condition an
  ICD-10-CM or SNOMED CT code, change a condition's category/inheritance-pattern/prevalence/
  synonyms, or extend the high-signal coded subset. Triggers: "add a condition", "add <disease>
  to the catalog", "code this condition", "add ICD-10/SNOMED", "the catalog is missing X".
---

# Add or edit a curated condition

Stemma's catalog is **two-layer** (see `docs/ARCHITECTURE.md`): the curated set in
`src/data/conditions.ts` is the "conditions the engine understands", and the ICD-10 long tail
is reached at runtime via the vocabulary adapter. This skill is for the **curated** layer.

**`src/data/conditions.ts` is GENERATED — never hand-edit it.** Edit the generator and its code
maps in `scripts/gen-conditions.mjs`, then regenerate.

## Steps

1. **Decide the layer.** If the condition only needs to be *recordable*, it already is — any
   ICD-10-CM code is attachable via live vocabulary search, no code change needed. Add it to the
   curated catalog only if the engine should *reason* on it (category colour, inheritance
   pattern for the autosomal-dominant detector, screening flags, curated recommendation).

2. **Add the base entry.** The curated array is sourced from `prototype/conditions.js`; for a new
   condition, add it to the generator's input (extend the array it reads, or add to an explicit
   additions list in `scripts/gen-conditions.mjs`). Fields: `id` (short slug), `name`, `cat` (a
   `CategoryKey` from `src/domain/types.ts`), `base` (rough lifetime prevalence %), `pattern`
   (inheritance, freeform — the detector matches `/dominant/i`), and `syn` (lay-term synonyms —
   these bridge lay terms to the condition, important because ICD-10 names are clinical).

3. **Verify the codes** — use the **`medical-coder`** agent, or the ICD-10 coding MCP tools
   directly. Add the verified `icd10` (FY-current ICD-10-CM) and `snomed` values to the
   generator's `ICD10` / `SNOMED` maps keyed by the condition `id`. Only add codes you have
   verified; do not guess. Prefer a representative unspecified/category code for a catalog entry.

4. **Regenerate and check drift.** Run `npm run gen:conditions`. The generated file must be
   committed; CI fails if it is stale.

5. **Wire the engine if relevant.** If the condition should drive a screening or a curated
   recommendation, update `src/domain/screening.ts` (`SCREENING_DEFS`) and/or
   `src/data/recommendations.ts`. If it participates in a red-flag pattern, that's `/add-pattern`.

6. **Test.** Add/extend `src/domain/catalog.test.ts` (lookup + search + codes present) and any
   screening/pattern test affected. Run `npm run check`.

## Guardrails

- Prevalence (`base`) is illustrative until roadmap §3 binds it to sourced epidemiology — if you
  add a `base`, keep it plausible and note the source in the commit if you have one.
- Categories are a closed set (`CategoryKey`); use `other` for genuinely uncategorised entries.
- Don't bloat the curated list with rare long-tail codes that the engine won't reason on — that's
  what the vocabulary adapter is for.
