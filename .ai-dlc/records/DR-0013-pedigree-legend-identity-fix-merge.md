<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — Printout pedigree legend identity fix (merge + operations)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0013 |
| `transition`   | `construction-to-merge` |
| `chosen_option`| `approve` |
| `target`       | `main` |
| `unit_of_work` | printout-pedigree-legend-identity-fix |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-17 |
| `risk_tier`    | standard (touches the identity axis, guardrail #4) |

## Rationale

Follow-up correctness fix (a fresh change on the same branch, reset from `main`
after PR #41 merged). The printout's Sheet-1 pedigree legend
(`src/ui/components/PrintReports.tsx`) described glyph **shape** as
sex-assigned-at-birth ("Squares = assigned male at birth · circles = assigned
female · diamond = unknown") — but the app keys shape off **gender identity**
(circle = woman / square = man / diamond = nonbinary, with SAB annotated
beneath), so the copy contradicted both the actual SVG rendering
(`src/export/pedigree-svg.ts`) and the on-screen `PedigreeView` legend, and
conflated the identity and SAB axes (guardrail #4).

Corrected to: "Circle = woman · square = man · diamond = nonbinary (2022
gender-inclusive notation); sex assigned at birth (AFAB/AMAB) is noted beneath a
glyph when it differs. A shaded glyph is affected (coloured by condition
category), a slash marks deceased, and the arrow marks [proband]."

**Grounding & gates:** `medical-domain-expert` verified against Bennett et al.
2022 (NSGC gender-inclusive pedigree nomenclature) — shape = gender identity is
the standard, diamond = nonbinary is the 2022 recommendation, and the app forces
the SAB annotation on every nonbinary glyph so it never emits a bare "unknown"
diamond. `clinical-safety-reviewer` PASS (guardrail #4 conflation resolved, no #1
issue). `test-engineer` added a regression test locking the identity-based key
and rejecting the old sex-based wording. `npm run check` green (611 tests).

**To-operations:** authorized to publish; on merge to `main` the GitHub Pages
workflow rebuilds and deploys the static site (`transition: to-operations`,
`target: deploy`, `approve`, kabaka, 2026-07-17, standard).

## Deferred follow-ups (surfaced by the domain expert; not in this fix)

- The print pedigree sheet has no on-sheet **condition-category colour key**
  defining the shading colours (NSGC Box 1.3 asks the legend to define
  fill/shading). Roadmap-tier enhancement.
- `sabLabel` collapses **UAAB** ("unassigned at birth") to "unknown"; the 2022
  set distinguishes them. Roadmap-tier terminology gap.
