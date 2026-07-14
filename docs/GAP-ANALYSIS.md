# Prototype → app: conversion gap analysis

This is a faithful-conversion audit: what the original prototype
(`prototype/Lineage.dc.html`, a ~1,732-line `dc-runtime` app) did, versus what the current
typed/tested app does, so nothing the prototype delivered is silently lost. It was produced by a
seven-area audit (navigation/risk-vantage, data model & editing, kinship, pedigree rendering,
condition catalog, pattern engine, timeline, exports/reports/backup), each cross-checked with
file:line evidence on both sides.

Companion to [`ROADMAP.md`](./ROADMAP.md) — the concrete gaps below are filed there (§7) as
sequenced follow-ups.

## Bottom line

The conversion is **mostly faithful, and in several areas materially better**. Nothing in the core
engine was dropped: **no hereditary pattern, condition, category, synonym, event type, severity
level, calculator, or kinship label was lost**, and the catalog/pattern engine gained codes,
sourced epidemiology, broader Lynch coverage, determinism, and accessibility.

The real omissions are concentrated in **what the app _emits_ and _edits_** — reporting/printing,
native backup, and a few secondary surfaces — and **three of them erode the project's
non-negotiable guardrails** (§ *Guardrail erosions* below). None manufacture a risk number; the
guardrail on that held throughout.

## What came over faithfully or improved (the majority)

| Area | Verdict | Notes |
| --- | --- | --- |
| Hereditary-pattern engine | Faithful + enhanced | All 6 patterns present (HBOC, Lynch, premature-CVD, autosomal-dominant, age-of-onset, limited-history); bands, severity, calculators identical. Lynch spectrum broadened (ovarian + upper-urinary-tract); recommendation prose correctly rewritten to drop family-specific claims/imperatives (guardrails #1/#2). |
| Condition catalog | Faithful + enhanced | Strict superset: 0 of 115 conditions dropped, all 13 categories (identical colours incl. colourblind), all 192 synonyms, byte-identical search — plus ICD-10-CM/SNOMED codes, sourced prevalence, and the two-layer NLM long-tail. |
| Kinship vocabulary | Faithful | `relLabel`/`relationInfo`/degree binning ported term-for-term (great-grandparent, aunt/uncle, nibling, cousin, spouse, maternal/paternal side). |
| Risk / vantage view | Faithful (renamed) | The `risk` view became `PatternsView` with the re-rooting selector intact; gained provenance/sourcing detail. |
| Pedigree rendering | Faithful + enhanced | Layout, connectors, glyph shapes, deceased slash, YOU/SAB badges, highlight — at parity; plus always-shade-affected, a category legend, real-`<button>` keyboard/ARIA, and `+N` dot overflow. Advanced NSGC notation (consanguinity/twins/adoption) was absent in the prototype too — no regression. |
| Person editing / CRUD | Faithful + enhanced | Add/edit/delete + relative creation (restored in #5), onset/provenance, organ inventory; plus a domain-enforced two-parent cap, delete confirmation, birth-year-blankable, AFAB/AMAB labels. |
| Colourblind palette | Enhanced | Was a design-time prop; now a persisted, user-facing in-app toggle (Okabe-Ito). |
| Determinism | Enhanced | Wall-clock `2026 - birth` replaced by an injected `asOfYear` (domain-purity rule). |
| GEDCOM import/export | Net-new | The prototype's importer was a stub; the app ships a real structural importer (#3). |

## Real gaps, ranked

### High

| # | Gap | Evidence | Guardrail |
| --- | --- | --- | --- |
| **H1** | **All three printable clinical one-pagers are gone, and there is no `@media print` CSS at all.** The prototype printed a 3-generation NSGC pedigree, a family-history red-flag summary, and an IPS-style personal-health summary. The current "Print summary" button prints the on-screen dark app chrome, so it is non-functional for its "hand it to your clinician" purpose. | prototype L26–35, L700–783, L1679–1683; `src/ui/views/ReportsView.tsx:92` | #3 (per-report boundary footers dropped) |
| **H2** | **Native lossless full-record backup export dropped.** No way to export the complete graph (conditions + onset/provenance + timeline + organs + identity) to a file and restore it. GEDCOM is structural-only; FHIR/Phenopacket are lossy clinical projections. Restore is half-wired: `replaceRecord` exists but there is no native-JSON importer. | prototype "Lineage backup (native)" L1655; `src/ui/views/ReportsView.tsx:17–50`; `src/store/useStore.ts` `replaceRecord` | #5 (no lock-in / record outlives the app) |
| **H3** | **Timeline "Edit event" is missing from the UI.** The `updateEvent` store action exists but is wired to no view, so correcting a typo or wrong year requires delete + full re-entry. | `updateEvent` unused across `src/ui`; prototype L465, L1391, L1396 | — |

### Medium

- **M1 — Overview "Recent activity" dropped** (the 3 newest proband timeline events). Confirmed by two audits. (prototype L141–152, L1600; absent in `OverviewView.tsx`)
- **M2 — Pedigree category-breakdown string gone** — "N relatives · 2× Breast cancer, 1× Colorectal", the payoff of category-highlight mode. (prototype L1492–1499; absent in `PedigreeHighlight.tsx`)
- **M3 — Drawer condition cards no longer show the inheritance pattern** ("Autosomal dominant", etc.); the data is on the `Condition` type, just not rendered. (prototype L281; `ConditionPicker.tsx:83–104`)
- **M4 — Timeline event form has no person picker** — events can only attach to the currently-viewed person (compounds H3). (prototype L650–653; `TimelineView.tsx:176`)
- **M5 — Pedigree generation labels changed** from proband-relative (`YOU / ▲n / ▼n`) to absolute (`Gen 1/2/3`), losing the you-centric orientation and direction cues. (prototype L1467–1471; `PedigreeView.tsx:374–387`)

### Low / cosmetic

Drawer header avatar glyph; click-a-condition-to-highlight-in-tree link; condition "(N)" count +
collapsible picker (now always-open search); calculator "Open ↗" (disabled) affordance; Overview
top-flags 4→3 and per-card click-through → single "View all patterns" button; findings 2-col→1-col
and per-relative onset vs a single "earliest onset" line; drawer condition-picker result cap 30→12;
timeline vertical spine + colored per-event dots → flat grid; filter-chip colored dots; same-year
sort tiebreaker (newest-added-first) lost; pedigree selection-dimming (0.72 focus aid); SAB badge
suppressed when SAB is unrecorded (intentional/documented); per-affected color dot in the findings
table.

## Guardrail erosions

Small individually, but this is a safety-first product, so they are called out together:

- **#3 (clinical boundary is a first-class element, not a footer)** — the Patterns view demoted its
  boundary from a highlighted callout box to lede body text; the per-report boundary footers
  vanished with the printable reports (H1).
- **#4 (screening keys off organs, not gender)** — the drawer's explicit
  "Screening keys off organs present, not gender." sentence was dropped. (prototype L268)

## Behavioral change — signed off (keep, with an accuracy fix)

**HBOC referral sensitivity narrowed.** Two breast cancers split across *opposite* lineages
(one maternal, one paternal), with no ovarian, no onset < 50, no first-degree, now yields
**"Discuss"** where the prototype gave **"Referral"** (`src/domain/patterns.ts:137–154`). This is a
per-lineage refinement (a pathogenic BRCA variant descends one lineage) — *not* a risk-number
change.

**Verdict (medical-domain-expert, NCCN-grounded): KEEP "Discuss."** NCCN Guidelines v1.2025
(Genetic/Familial High-Risk Assessment: Breast, Ovarian, and Pancreatic) count close blood
relatives "**on the same side of the family**" (footnote "o"), and the multi-case breast criterion
is a same-side aggregate — so two opposite-lineage breast cancers (both > 50, nothing else) do
**not** meet the testing-referral criterion. Reverting to "Referral" would assert a criterion that
isn't met (guardrail #1). "Discuss" is the correct USPSTF-aligned surface-and-raise posture: it
keeps the signal visible (≈39% of carriers miss NCCN criteria — Samadder 2024) and routes it to a
clinician who can take a fuller history and run a validated model (Tyrer-Cuzick / CanRisk), without
overstating.

**Fix applied from the sign-off:** the HBOC flag's recommendation text was a single string
regardless of severity, so the "discuss" branch still read *"Meets common criteria to discuss
BRCA1/2 testing… Consider a genetics referral"* — overstating criteria-met for the exact case it
was distinguishing (guardrail #1). The `rec` is now severity-aware: the referral wording is
unchanged; the discuss branch states that per-lineage criteria are **not** met and still routes to a
clinician + validated model (`src/domain/patterns.ts`, HBOC block).

**Roadmap-level notes** (from the same review, filed in §7): the young-onset threshold is `< 50`
where strict NCCN single-relative young-onset is `≤ 45` (Stemma's is a slightly-more-sensitive
referral *screening* threshold — keep, but cite as such); the same-side ≥ 2 branch is likewise a
screening heuristic a touch broader than the strict NCCN "≥ 3 same-side" testing aggregate; and
Ashkenazi-Jewish ancestry (an NCCN any-age testing indication) is not modelled.

## Method & scope notes

- "Faithful" / "Enhanced" / "Changed (by-design)" / "Missing" verdicts are per capability, with
  prototype and current file:line evidence.
- Enhancements added since the prototype (medical codes, sourced epidemiology, the NLM long-tail
  catalog, GEDCOM, a11y, determinism, palette toggle) are noted as non-gaps.
- The no-manufactured-risk guardrail held on both sides: the prototype already used the
  pattern-and-criterion approach, so there was no risk multiplier to remove.
</content>
