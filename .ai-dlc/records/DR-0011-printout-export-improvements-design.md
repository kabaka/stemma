<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — Printout export improvements (design fork)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0011 |
| `transition`   | `design-fork` |
| `chosen_option`| `approve` |
| `target`       | `claude/printout-export-improvements-ql4yi8` |
| `unit_of_work` | printout-export-improvements (pedigree name fit · print page footer · current-medications table · IPS allergies/immunizations) |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-17 |
| `risk_tier`    | standard |

## Rationale

Four scoped improvements to the printable clinical one-pagers
(`src/ui/components/PrintReports.tsx`), validated by `software-architect`:

1. **Pedigree name overlap** — person-name labels in the shared SVG serializer
   (`src/export/pedigree-svg.ts` `glyph()`) are centered, unbounded `<text>`; anything
   wider than H_GAP (96px) overlaps its neighbour. Fix by fitting each name to a
   width budget derived from an **exported** `H_GAP` (≈14 chars/line, accounting for
   600-weight), wrapping on whitespace to at most 2 `<tspan>` lines, truncating an
   over-long token/line with `…`, and carrying the full name in a `<title>`. A shared
   per-node fitted-lines count (computed once per node into a `Map` reused by **both**
   the glyph render **and** the `maxY` viewBox padding) keeps a wrapped bottom-row name
   from being clipped (architect-found defect). Pure/deterministic; no DOM `measureText`.
   Fixes the on-screen SVG preview too (shared serializer).
2. **Clinical boundary → running page footer** — replace the 3 per-sheet inline
   `BoundaryFooter` blocks with one `position:fixed` print footer repeated on every
   physical page, with `@page` bottom margin reserving space. Strengthens guardrail #3
   (boundary on every page, not only where a sheet's content happens to end). UI-only.
   Must be verified in-app in the target browser (Chromium).
3. **Current medications table** — Sheet 3 renders a table from the existing pure
   read-model `currentMedications(record, proband.id, asOfYear)` when non-empty
   (Medication · Dose · Since). No new domain surface.
4. **IPS enhancement** — add pure, deterministic (no as-of) read-models `allergies()`
   and `immunizations()` to `src/domain/timeline.ts` (mirroring `labSeries`' payload
   guard; immunizations sorted ascending by year), and render Allergies and
   Immunizations tables in Sheet 3 when present. Sheet 3 reorders to IPS reading order:
   organ inventory → Conditions → Allergies → Current medications → Immunizations →
   Recommended screening → Health timeline.

Guardrails: everything shown is a recorded fact (dose, substance, dose label, year) —
no computed risk (#1); the clinical boundary stays first-class on every page (#3);
domain read-models stay pure and deterministic. The `<title>` full-name child preserves
the escaped-name substring the existing `pedigree-svg.test.ts` escaping test asserts, so
that oracle passed unchanged; `test-engineer` re-authored the `views.test.tsx` boundary
assertion for the single-footer design and added domain/export coverage for the new
read-models and name-fitting.
