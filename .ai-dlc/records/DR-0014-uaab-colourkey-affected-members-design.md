<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — UAAB + pedigree colour key + Sheet-2 affected members (design fork)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0014 |
| `transition`   | `design-fork` |
| `chosen_option`| `approve` |
| `target`       | `claude/printout-export-improvements-ql4yi8` |
| `unit_of_work` | uaab-sab-value · pedigree-category-colour-key · sheet2-affected-members |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-17 |
| `risk_tier`    | high-risk (A touches the identity axis + record schema + export/import); B/C standard |

## Rationale

Three changes: the two DR-0013 follow-ups plus a Sheet-2 enhancement the maintainer
requested. Architecture validated by `software-architect`; codes by `medical-coder`.

### A — UAAB as a distinct sex-assigned-at-birth value (`'x'`)
Today `Sab = 'm' | 'f' | 'u'` conflates a *deliberate* non-assignment (UAAB) with a
genuinely unknown value. Add `'x'` to `Sab`; `sabLabel('x') = 'UAAB'`. Load-bearing
edit: `record.ts` `SAB_VALUES` gains `'x'` so records carrying it validate on every
load/import path while old `{m,f,u}` records still validate (additive, no migration).
Verified no domain site branches on `=== 'u'`, so `'x'` is correctly "not m / not f"
in `defaultOrgans` (→ []), graph side-determination, and pattern thresholds — **no
`graph.ts`/`patterns.ts`/`screening.ts` change**. Editor: add `'x'` to
`PersonForm` `SAB_OPTIONS` (label flows from `sabLabel`). Exports (medical-coder,
cited): FHIR `us-core-birthsex` → **`OTH`** (a real "not F/M" NullFlavor, distinct
from `UNK` — the faithful export path); FHIR `Patient.gender` **unchanged** (`unknown`
— do not derive `other` from SAB); GEDCOM 5.5.1 `SEX` → **`U`** (no 4th code exists —
**lossy, documented honestly**). Import: `genderFromSab('x')='nb'`; `sabFromSex` maps
an inbound GEDCOM-7/5.5.5 `X` → `'x'` so an explicit signal isn't downgraded.
Guardrail #4: UAAB is the SAB axis only; never keys screening/gender. Routed through
`medical-domain-expert` (2022 NSGC) + `medical-coder` (done) + clinical-safety.

### B — condition-category colour key on print Sheet 1
NSGC Box 1.3 wants the fill/shading defined. Architect found deriving the key from the
unwindowed `affectedFindings` would show swatches for categories drawn on no glyph in
the ~4-generation print window. Fix: extract pure `windowedPeople(record)` from
`pedigree-svg.ts` (single source for the `g0-2..g0+1` window) and lift the pure
`legendCategories(people, catalog)` from `PedigreeView.tsx` into `data/categories.ts`;
Sheet 1 renders a compact swatch+label key over `legendCategories(windowedPeople(
record), catalog)`. Colour always paired with the text label (WCAG 1.4.1).

### C — affected family members per condition on Sheet 2
`FamilyFinding.affected[]` already carries `{rel, onset, prov}` sorted closest-degree
first — no domain change. Render a capped secondary line under each condition name
("Mother (45) · Maternal aunt (52) · +N more"), keeping the 4-column layout; cap so it
can't dominate the report. Relationship labels (not names) — clinically standard and
private-by-default. Diagnosed proband: the who-line leads with "You" (or "You (onset N)"
when the proband's onset is recorded) so a proband-diagnosed condition is never a bare row.

Determinism/purity/layering intact throughout; everything shown is a recorded fact
(guardrail #1); the clinical-boundary footer is unchanged (guardrail #3).
