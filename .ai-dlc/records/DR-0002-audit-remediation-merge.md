<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — Audit-remediation fix-forward (merge + Pages publish)

Records the maintainer's authorization to integrate the audit-remediation branch
(`claude/audit-fixes`) into `main`. Because `deploy.yml` auto-publishes to GitHub
Pages on push to `main`, this single action crosses **both** the Construction→merge
gate (Gate 3) **and** the →Operations deploy gate (Gate 4); both are authorized here.

## Machine fields

| Field | Value |
| --- | --- |
| `decision_id` | DR-0002 |
| `transition` | `construction-to-merge` (coupled `to-operations` Pages publish authorized in the same action) |
| `chosen_option` | `approve` |
| `target` | `main` |
| `unit_of_work` | audit-remediation — the [`docs/AUDIT.md`](../../docs/AUDIT.md) P0/P1/P2 backlog + the UX/IA pass |
| `rationale` | Fix-forward remediation of the honest audit (not a rebuild — the audit found the domain core, guardrails, privacy model, and clinical content SOUND). Ten commits fix the three proven ship-blockers, the UI clutter/IA/a11y, export determinism, HBOC sensitivity, CI/CSP hardening, and the coverage holes. The four-reviewer pre-merge gate ran; its findings (a HIGH modal-focus regression, a REQUEST_CHANGES set, guardrail-process items) were all fixed and re-verified. `npm run check` green (394 tests). The maintainer authorized the merge and the coupled Pages publish ("test in production" consent for a brand-new, tiny app). |
| `approver` | maintainer (kabaka) |
| `date` | 2026-07-16 |
| `risk_tier` | high-risk |

## High-risk addendum

**Alternatives considered.** (1) Discard to the bare prototype and rebuild — rejected: the audit found the expensive-to-get-right parts already SOUND, so a rebuild would discard verified value and re-run the dice on clinically-reviewed logic. (2) Retroactive/dishonest ADRs — rejected outright (non-negotiable). (3) **Fix-forward, selectively — chosen**, on the audit's per-area evidence.

**Risk note.** The change touches clinical pattern logic (HBOC sensitivity) and relationship computation feeding the engine (`graph.ts` half-sibling/side/degree), and merging auto-publishes to Pages. Mitigations: every change reviewed by the relevant specialist gate (below); guardrails verified SOUND in code; 394 deterministic tests; the arbiter gate honored via this record. Residual accepted risk: first production publish of a young app, accepted by the maintainer.

## Recorded clinical sign-off (HBOC extension)

Resolves the clinical-safety-reviewer's "no recorded clinical sign-off" finding.
`medical-domain-expert` reviewed the pancreatic + male-breast HBOC additions and
returned **SOUND** (merge-ready as decision-support). Grounding: NCCN Genetic/Familial
High-Risk Assessment — Breast, Ovarian & Pancreatic, v2.2026 (PMID 41671423); USPSTF
2019 BRCA statement (PMID 31429903). Confirmed: the 1st–3rd-degree trigger scope
matches NCCN's "close blood relative" definition; male breast is keyed on
sex-assigned-at-birth, never gender (guardrail #4); the strings describe the family
finding with no manufactured risk number (guardrail #1); the pancreatic-surveillance
caveat is appropriately conservative. One overshooting rec sentence was softened per
the reviewer's exact wording (commit `d1d27e9`).

## Descope (arbiter-approved)

Two items are **deliberately deferred** from this unit and filed in
[`docs/ROADMAP.md`](../../docs/ROADMAP.md) §7:

- **Ashkenazi-Jewish ancestry** as an any-age BRCA indication — needs a new
  `Person.ancestry` data axis (schema + PersonForm UI + persistence + export). Its own
  **high-risk** unit with a dedicated Decision Record and `security-privacy-reviewer`
  pass. Its absence is an under-sensitivity gap, not an error in what ships.
- **Male-breast ICD dual-coding** (catalog `brca` carries the female `C50.919`; a
  male-sab case should dual-code to the `C50.92x` family) — a catalog/export
  follow-up; the pattern engine is unaffected (keys on id + sab).

## Review panel verdicts

| Reviewer | Verdict | Resolution |
| --- | --- | --- |
| `clinical-safety-reviewer` | Guardrails/layering/determinism **SOUND**; FIXABLE only on process | This record + the ROADMAP descope + dangling-ref fix close the process items |
| `medical-domain-expert` | HBOC **SOUND** | Rec wording softened; sign-off recorded above |
| `accessibility-reviewer` | **FIXABLE** — one HIGH focus-restore regression + mediums | Fixed (commit `c8b9526`) + regression tests (`7f03409`) |
| `code-reviewer` | **REQUEST_CHANGES** — 4 findings | All fixed (`c8b9526`/`d1d27e9`/roadmap) + re-verified; closing re-check recorded |
