<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — Phase 2 timeline depth (merge + Pages publish)

Records the maintainer's authorization to integrate the second of four sequenced Phase 2
units — **timeline depth** (structured medications / labs / vitals / allergies /
immunizations + document references, and derived read surfaces) — into `main`. Because
`deploy.yml` auto-publishes to GitHub Pages on push to `main`, this action crosses **both**
the Construction→merge gate (Gate 3) **and** the →Operations deploy gate (Gate 4).

## Machine fields

| Field | Value |
| --- | --- |
| `decision_id` | DR-0004 |
| `transition` | `construction-to-merge` (coupled `to-operations` Pages publish authorized in the same action) |
| `chosen_option` | `approve` |
| `target` | `main` |
| `unit_of_work` | phase2-timeline-depth — optional structured payloads on `TimelineEvent` (`med`/`lab`/`vital`/`allergy`/`immunization`/`attachments`), two new `EventType`s (`allergy`/`vital`), pure `domain/timeline.ts` derivations (`currentMedications`, `labSeries`, `labTitles`), the extended `isValidEvent` validation boundary, and the type-aware event form + "Currently taking" / lab-trend read surfaces |
| `rationale` | Second of four Phase-2 PRs. Layered design by the `software-architect`; built by `implementer` (domain/data) + `frontend-engineer` (UI) against the `test-engineer` oracle. Full review gate ran — `code-reviewer` REQUEST_CHANGES (a HIGH over-correction dropping a legitimately-entered new medication, plus a lab-payload type-gating defense-in-depth, a NaN guard, and a person-id consistency nit — all fixed + regression-tested), `clinical-safety-reviewer` APPROVE, `accessibility-reviewer` (two Mediums: attachment-remove focus + reference-range fieldset/legend — both fixed + tested), `security-privacy-reviewer` PASS. `npm run check` green (461 tests) and the Pages production build green before merge. |
| `approver` | maintainer (kabaka) — directed the implement → PR → merge → deploy flow for Phase 2 |
| `date` | 2026-07-16 |
| `risk_tier` | standard |

## Recorded scope decisions (arbiter-facing, non-silent)

1. **Lab/vital reference ranges are USER-ENTERED only.** No built-in "normal range" table
   ships in `src/data/` or `src/domain/`; nothing populates `refLow`/`refHigh` except the
   value the user transcribes from their own report, and `labSeries`/`LabTrend` compute NO
   in-range/out-of-range flag or interpretation — a reference range is a clinical assertion
   Stemma does not manufacture (guardrail #1). Verified by the safety gate.
2. **Attachments are metadata-only references this PR** (`AttachmentRef { id, name, note?,
   mediaType? }` — no file bytes). Storing binary blobs needs an async store (IndexedDB);
   the Zustand store is synchronous end-to-end, and the roadmap (§7) already earmarks that
   sync→async "storage seam" for Phase 5. Real byte storage is therefore **deferred to that
   seam** (ideally its first concrete driver) rather than bolted on ad hoc — a documented
   narrowing, not a silent drop. `security-privacy-reviewer` confirmed no byte/`FileReader`
   path exists.
3. **FHIR/Phenopacket enrichment for the new fields is out of scope for this PR**, tracked
   as a named follow-up. The native backup already round-trips every new field verbatim
   (no-lock-in, guardrail #5, test-verified), so the durable record outlives the app without
   the lossy clinical projections needing immediate extension.
4. **A vitals *trend* surface is deliberately deferred** — vitals are recorded, validated,
   and editable, but only labs get a trend view this PR (matching the roadmap bullet, which
   names "numeric lab trends"). Not a silent drop.

## Notes

- Guardrails held and gate-verified: no manufactured number/interpretation (#1); records are
  advisory facts, allergy severity is recorded not computed (#2); the lab-trend surface
  carries the shared `ClinicalBoundary` (#3); nothing keys off gender (#4); local-first, no
  network, native backup round-trips (#5).
- Determinism/layering preserved: `domain/timeline.ts` pure (asOfYear injected); new fields
  validated at the `record.ts` boundary; UI reads the clock only via the sanctioned
  `CURRENT_YEAR`.
- Sequenced work: pedigree extras (PR 3) and append-only history (PR 4) follow as separate
  PRs. Adoption/donor remains deferred to Phase 5.
