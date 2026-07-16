<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — Phase 2 append-only history (merge + Pages publish) — completes Phase 2

Records the maintainer's authorization to integrate the **fourth and final** sequenced Phase 2
unit — **append-only history with a visible "what changed" diff** — into `main`. Because
`deploy.yml` auto-publishes to GitHub Pages on push to `main`, this action crosses **both** the
Construction→merge gate (Gate 3) **and** the →Operations deploy gate (Gate 4). Merging this unit
marks **Phase 2 — Pedigree & records depth complete**.

## Machine fields

| Field | Value |
| --- | --- |
| `decision_id` | DR-0006 |
| `transition` | `construction-to-merge` (coupled `to-operations` Pages publish authorized in the same action) |
| `chosen_option` | `approve` |
| `target` | `main` |
| `unit_of_work` | phase2-append-only-history — a pure diff engine (`diffRecords`/`summarizeDiff`) + bounded snapshot ring buffer (`capHistory`) + validators in `src/domain/history.ts`; a separate `stemma-history` persist store (`useHistoryStore`); a `commit()` choke point in `useStore.ts` that snapshots + labels every record-changing mutation; and a new top-level History view with an expandable per-change diff |
| `rationale` | Final of four Phase-2 PRs. Layered design by the `software-architect`; built by `implementer` (domain/store) + `frontend-engineer` (UI) against the `test-engineer` oracle. The four-reviewer gate ran and returned findings, all resolved before merge: `code-reviewer` **REQUEST_CHANGES** (a Medium-High union-diff key collision on empty-`parents` unions that mis-attributed history entries, a missing `deleteEvent` no-op guard, a non-matching caret selector, and a nav-table test gap — all fixed + regression-tested); `security-privacy-reviewer` PASS with a should-fix privacy-disclosure gap (deleted PHI persists in `stemma-history` until cleared — now disclosed in the History view, the Reports caveat, and the README); `accessibility-reviewer` (a Moderate clear-history focus/status drop — fixed); `clinical-safety-reviewer` APPROVE. After the fixes, `npm run check` is green and the Pages production build is green; History verified live in the running app (labeled entries, expand-to-diff, graceful oldest-entry + no-op messages, clear-history with managed focus). |
| `approver` | maintainer (kabaka) — directed the implement → PR → merge → deploy flow for Phase 2 |
| `date` | 2026-07-16 |
| `risk_tier` | standard |

## Recorded scope / design decisions (arbiter-facing, non-silent)

1. **Bounded snapshot ring buffer, not a diff/patch log.** Full `FamilyRecord` snapshots per
   change, capped by BOTH count (`HISTORY_MAX_ENTRIES = 50`) and serialized bytes
   (`HISTORY_MAX_BYTES ≈ 2 MB`), evicting oldest-first. Snapshots make the diff/restore trivial
   and isolate corruption to one entry; a patch chain would need a replay engine that tracks the
   record's evolving optional fields. Caps are tunable starting values.
2. **A separate `stemma-history` localStorage store, not folded into `stemma-record`.** This makes
   "a corrupt/oversized history can never break the record" a *structural* guarantee: a malformed
   `stemma-history` blob cannot reach the record's hydration path, and the `stemma-record` persist
   config is left byte-for-byte unchanged (zero risk to existing users' records). Per-entry
   sanitization (drop a bad entry, keep the rest) mirrors the record validator's per-element
   discipline.
3. **Restore-to-a-past-version is DEFERRED — view-only diff is the MVP.** The roadmap bullet names
   the "what changed" diff, which this ships in full; restore is an additive follow-on that
   re-enters through the existing `replaceRecord` + `isValidRecord` boundary (no new mechanism),
   but a destructive revert warrants its own confirm-UX and safety pass. Named follow-up, not a
   silent drop.
4. **No `ClinicalBoundary` on the History view — deliberate and confirmed by the safety gate.**
   This is the one analysis-adjacent surface that shows the app's own edit provenance, not clinical
   analysis, so a boundary callout would be noise. `summarizeDiff` output is mechanical edit
   descriptions, never advice or a risk number.
5. **Append-only means deletions are RETAINED in `stemma-history` until cleared — disclosed, not
   silent.** By design, deleting a person/condition/event removes it from the current record but not
   from the pre-change snapshots in the history log (the whole point of an audit trail). Because
   this changes what "delete" means versus the app's prior behavior, the `security-privacy-reviewer`
   flagged it as a disclosure gap; it is now surfaced to the user in the History view lede, the
   Reports backup/restore caveat, and the README privacy section, with **Clear history** as the
   purge control. A per-delete warning at the deletion site is a named optional follow-up.

## Notes

- Determinism/layering preserved: `src/domain/history.ts` is pure (diff engine, cap, validators —
  no clock/IO); the sole `Date.now()` read is the store's `commit()` choke point (the sanctioned
  wall-clock boundary). Every record-changing mutation routes through `commit`; no-op mutations
  record nothing.
- Guardrails: no manufactured number/analysis — a mechanical structural diff (#1); local-first —
  snapshots stay in localStorage, no network, and are the same unencrypted-at-rest exposure the
  record already carries, isolated under their own key (#5); the History view carries no boundary
  because it isn't clinical analysis (#3).
- **Phase 2 is complete** with this merge: care coordination (DR-0003), timeline depth (DR-0004),
  pedigree extras (DR-0005), and append-only history (DR-0006). Named Phase-2 follow-ups carried
  forward: pedigree collapse/expand, restore-from-history, a vitals-trend surface, FHIR enrichment
  of the new timeline fields, and byte-level document attachments — each requiring the async-storage
  seam or its own unit. Adoption/donor remains a Phase 5 axis.
