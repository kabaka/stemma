<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — Phase 2 pedigree extras (merge + Pages publish)

Records the maintainer's authorization to integrate the third of four sequenced Phase 2
units — **pedigree extras** (consanguinity double-line, monozygotic/dizygotic twins, and
pan/zoom over the real graph, with a new union-editing surface) — into `main`. Because
`deploy.yml` auto-publishes to GitHub Pages on push to `main`, this action crosses **both**
the Construction→merge gate (Gate 3) **and** the →Operations deploy gate (Gate 4).

## Machine fields

| Field | Value |
| --- | --- |
| `decision_id` | DR-0005 |
| `transition` | `construction-to-merge` (coupled `to-operations` Pages publish authorized in the same action) |
| `chosen_option` | `approve` |
| `target` | `main` |
| `unit_of_work` | phase2-pedigree-extras — consanguinity double-line rendering (`Segment.double` + pure `offsetParallel`), twins (`Union.twins: TwinSet[]`, mono/di geometry in `segments()`), pan/zoom over the pedigree canvas, and a "Union details" editing surface (`updateUnion` store action + `PersonDrawer` UI) to set consanguinity/twins |
| `rationale` | Third of four Phase-2 PRs. Layered design by the `software-architect`; built by `implementer` (domain/store/export) + `frontend-engineer` (UI) against the `test-engineer` oracle. Full review gate ran — `code-reviewer` REQUEST_CHANGES (missing UI component coverage + a same-`parents` union key/mutation ambiguity — both addressed), `clinical-safety-reviewer` APPROVE (guardrail #4 verified: no `gender` in any twin/consanguinity path; kinship math untouched), `accessibility-reviewer` (a HIGH Tab-focus off-screen nudge + notation text-alternatives + a pan-button fallback — all fixed), `security-privacy-reviewer` PASS (no exfiltration; validation boundary rejects malformed/foreign twin members). `npm run check` green (486+ tests) and the Pages production build green before merge. Twins/consanguinity verified live in the running app. |
| `approver` | maintainer (kabaka) — directed the implement → PR → merge → deploy flow for Phase 2 |
| `date` | 2026-07-16 |
| `risk_tier` | standard |

## Recorded scope decisions (arbiter-facing, non-silent)

1. **Collapse/expand is DEFERRED to a named follow-up** — not a silent drop. The roadmap
   bullet reads "Pan/zoom/collapse over a real graph"; this PR ships **pan/zoom**. A real
   collapse needs the pure-core layout engine (`computeLayout`/`orderRow`/`segments`) to
   treat a collapsed subtree as a single placeholder node — a materially larger, engine-level
   change with its own segment cases — whereas a shallow "hide the divs" hack would leave the
   connector SVG drawing lines to now-invisible coordinates (broken geometry, not real
   collapse). Per the delivery rule against half-features, collapse is tracked as its own
   future unit requiring a dedicated `software-architect` layout-engine pass. Pan/zoom stands
   alone coherently — nothing depends on collapse.
2. **Monozygotic twins are DRAW-ONLY this cycle.** An MZ twin is rendered with the distinct
   converging-diagonals + bar notation but still contributes the ordinary sibling coefficient
   of relatedness (`r = 0.5`) to the pattern/screening engine — `relationInfo`/`patterns.ts`/
   `screening.ts` are untouched. Recomputing MZ kinship (true MZ twins share ~100% of germline
   variants) is a separate, larger unit touching the risk engine; deliberately out of scope.
3. **Adoption/donor (social vs genetic parent) remains deferred to Phase 5** per the earlier
   maintainer decision — not designed or built here.
4. **Union identity is matched by parents-set** (no stable `Union.id`). This is correct for
   app-created data (one sibship per parent pair); the ambiguity of two imported unions
   sharing an identical `parents` set but different children is a known pre-existing
   architecture limitation (documented in code) whose full fix (a `Union.id` migration
   touching seed / GEDCOM import / native backup / every fixture) is deferred.

## Notes

- Guardrails held and gate-verified: genetics/geometry keyed off `Union.parents`/`children`
  and layout, never gender (#4); no manufactured risk / no kinship-math change (#1); the
  pedigree already carries the `ClinicalBoundary` (#2/#3); local-first, no network, new
  `Union.twins` round-trips through the native backup and is validated at the import boundary
  (#5).
- Determinism/layering preserved: `graph.ts` twin geometry + `offsetParallel` are pure;
  pan/zoom is transient local UI state (never persisted), so it cannot corrupt the record.
- Sequenced work: append-only history (PR 4) follows as a separate PR. Collapse/expand is now
  a named backlog follow-up (see scope decision 1).
