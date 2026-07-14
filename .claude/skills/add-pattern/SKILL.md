---
name: add-pattern
description: >-
  Add or change a hereditary red-flag pattern in Stemma's detection engine
  (src/domain/patterns.ts). Use when implementing a new family-history pattern, referral
  criterion, or age-of-onset/clustering rule, or adjusting an existing one (HBOC, Lynch,
  premature cardiovascular disease, autosomal-dominant, age-of-onset, limited-history).
  Triggers: "add a pattern", "detect <syndrome>", "add referral criteria", "flag when
  <family-history condition>", "risk rule", "screening pattern".
---

# Add a hereditary-pattern rule

The pattern engine (`src/domain/patterns.ts`, function `detectPatterns`) is Stemma's core value.
It is **pure and deterministic** and is unit-tested against the seed pedigree in
`src/domain/patterns.test.ts`. Read the existing rules first — a new rule follows their shape.

## The contract (read before writing a rule)

Each rule inspects the family from a vantage (`rootId`) and, when its criterion is met, pushes a
`PatternFlag`:

```ts
{
  severity: 'referral' | 'discuss' | 'note',
  cat: CategoryKey | null,
  title: string,                 // the pattern's name
  criterion: string,             // the SPECIFIC published criterion met — this is the point
  rec: string,                   // advisory next step (referral-oriented)
  relatives: AffectedRelative[], // the relatives that triggered it
}
```

- `severity: 'referral'` means published criteria for a genetics/clinical referral are met;
  `'discuss'` is worth raising; `'note'` is a caveat. Flags sort referral → discuss → note.
- The **`criterion` must state the actual rule met** (counts, ages, relationships), e.g.
  "colorectal cancer before age 50 (Maternal Aunt at 47)". This is what makes the flag defensible.

## Steps

1. **Ground the rule in a published criterion** (NCCN, Amsterdam II, revised Bethesda, ACC/AHA,
   etc.). Cite it in the `rec`/comment. Do not invent thresholds.
2. **Add the rule inside `detectPatterns`** using the helpers already there: `withCond(code)`
   returns affected blood relatives with `degree`/`side`/`rel`/`onset`; use `relationMap` for
   kinship, `catalog.get` for condition metadata, and `sabOf` for sex-based thresholds. Guard
   age comparisons with `onset != null` (never truthy `onset`, so age 0 counts).
3. **Respect the guardrails** (`CLAUDE.md`): emit a *criterion + referral*, never a risk number
   or probability. Keep `rec` advisory.
4. **Test it** in `src/domain/patterns.test.ts`: a positive pedigree that triggers it and a
   negative one that must not. Pass an explicit `asOfYear` (use 2026 to match the seed). Assert on
   `severity`, `title`, and the `criterion` text.
5. `npm run check`, then verify in the running app (`npm run dev` → Family Patterns; re-root the
   vantage to confirm it behaves from any person).

## Don't

- Don't compute or display a relative-risk multiplier or probability.
- Don't call `Date`/`new Date()` in the engine — thread `asOfYear`.
- Don't reach into the store or UI; the engine is pure.
