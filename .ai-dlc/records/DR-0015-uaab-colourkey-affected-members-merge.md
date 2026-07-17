<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — UAAB + colour key + Sheet-2 members (merge + operations)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0015 |
| `transition`   | `construction-to-merge` |
| `chosen_option`| `approve` |
| `target`       | `main` |
| `unit_of_work` | uaab-sab-value · pedigree-category-colour-key · sheet2-affected-members |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-17 |
| `risk_tier`    | high-risk (identity axis + record schema + export/import) |

## Rationale

Implements DR-0014 on branch `claude/printout-export-improvements-ql4yi8`. Delivered:

- **UAAB** — `Sab` gains `'x'` (`sabLabel → 'UAAB'`); `record.ts` `SAB_VALUES`
  widened so `sab:'x'` validates while legacy `{m,f,u}`/absent records still load
  (additive, no migration). No `graph.ts`/`patterns.ts`/`screening.ts` change (verified
  no `=== 'u'` site). FHIR birthSex → `OTH` (distinct, faithful); FHIR gender unchanged
  (`unknown`); GEDCOM `SEX` → `U` (documented-lossy); GEDCOM import `X → x`,
  `genderFromSab x → nb`. Editor: 4th "UAAB" SAB toggle.
- **Pedigree colour key** — pure `windowedPeople(record)` extracted (barrel-exported)
  and pure `legendCategories(people, catalog)` lifted into `data/categories.ts`; Sheet 1
  renders a swatch+label key over the actual print window (colour always with text,
  WCAG 1.4.1); shape legend now "(AFAB/AMAB/UAAB)".
- **Sheet 2 affected members** — capped relationship+onset sub-line per condition
  ("You (onset N)" if diagnosed, then closest-first relatives, cap 3 + "+K more"),
  keeping the 4-column layout.

**Gates cleared:** `medical-domain-expert` (2022 NSGC) + `medical-coder` (FHIR `OTH` /
GEDCOM `U` cited) grounded the design; `code-reviewer` APPROVE (two Low findings
resolved: barrel-export + comment, DR wording); `clinical-safety-reviewer` (no guardrail
violations — UAAB confined to the SAB axis); `security-privacy-reviewer` (validation
stays a strict `Set.has()` gate, GEDCOM import safe, `esc()` intact, no network/deps);
`accessibility-reviewer` (no blockers; applied the +11px legibility bump). `npm run check`
green (629 tests); production build clean; print output verified in Chromium
(Playwright → PDF): colour key matches glyph colours, UAAB byline, capped Sheet-2 lines,
boundary on every page.

## To-operations authorization

Authorized to publish. On merge to `main`, the GitHub Pages workflow rebuilds and
deploys the static site. `transition: to-operations`, `target: deploy`,
`chosen_option: approve`, approver kabaka, 2026-07-17, high-risk.

## Deferred follow-ups (non-blocking; surfaced in review)
- Back-port `role="list"`/`role="listitem"` to `.print-flags` for parity with the new
  `.print-catkey` (pre-existing VoiceOver list-semantics gap).
- GEDCOM 7 exporter would carry UAAB as `X` (faithful) vs 5.5.1's lossy `U`.
