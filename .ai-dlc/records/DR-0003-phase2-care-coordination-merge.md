<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — Phase 2 care-coordination (merge + Pages publish)

Records the maintainer's authorization to integrate the first of four sequenced Phase 2
units — **care coordination** (screening schedule with advisory overdue flags + an
iCalendar `.ics` export) — into `main`. Because `deploy.yml` auto-publishes to GitHub
Pages on push to `main`, this single action crosses **both** the Construction→merge gate
(Gate 3) **and** the →Operations deploy gate (Gate 4); both are authorized here.

## Machine fields

| Field | Value |
| --- | --- |
| `decision_id` | DR-0003 |
| `transition` | `construction-to-merge` (coupled `to-operations` Pages publish authorized in the same action) |
| `chosen_option` | `approve` |
| `target` | `main` |
| `unit_of_work` | phase2-care-coordination — screening *schedule* with advisory "may be due" flags (`scheduleFor`), an RFC 5545 `.ics` calendar export (`buildIcsCalendar`), a `TimelineEvent.screeningId` link, and the Overview/Reports/Timeline UI |
| `rationale` | First of four Phase-2 PRs (maintainer chose one-item-per-PR sequencing). Cadence constants grounded in USPSTF/ACC-AHA by the `medical-domain-expert`; layered design by the `software-architect` (domain-pure `scheduleFor`, export-layer `.ics`, shared `CLINICAL_BOUNDARY_TEXT` constant). Full Solo-Mob Construction gate ran — `code-reviewer` (REQUEST_CHANGES: unlink no-op + missing UI tests + dead-root guard — all fixed), `clinical-safety-reviewer` (APPROVE; "overdue"-verdict wording softened to "may be due"), `accessibility-reviewer` (button aria-labels + describedby + boundary lead restored), `security-privacy-reviewer` (PASS; UID sanitised defensively). `npm run check` green (424 tests) and the Pages production build green before merge. |
| `approver` | maintainer (kabaka) — directed the implement → PR → merge → deploy flow for Phase 2 |
| `date` | 2026-07-16 |
| `risk_tier` | standard |

## Notes

- Guardrails held and verified by the safety gate: no manufactured risk number (schedule
  surfaces published guideline constants only); advisory/referral-oriented copy (`STATUS:TENTATIVE`,
  "may be due", never an "Overdue" verdict); the clinical boundary rides in every `.ics`
  `DESCRIPTION` and on the Overview surface (guardrail #3); screening keys off the organ
  inventory via `screeningsFor`, never gender (#4); the `.ics` is generated client-side with no
  network call (#5). PSA and the BRCA panel are deliberately excluded from interval math.
- Determinism preserved: `scheduleFor`/`buildIcsCalendar` are pure, with `asOfYear`/`now` injected
  at the UI boundary.
- Sequenced work: the remaining Phase-2 units (timeline depth, pedigree extras, append-only
  history) follow as separate PRs, each with its own Decision Record. Adoption/donor
  (social-vs-genetic parent) is deferred to Phase 5 per the maintainer's decision.
