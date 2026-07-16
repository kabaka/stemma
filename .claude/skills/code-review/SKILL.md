---
name: code-review
description: Pre-merge review of a proposed change for correctness, regressions, and intent — with a standing lightweight security lens — emitting one enumerated verdict. Use when reviewing this change / this PR / this diff before merge, gating a unit of work, checking whether code satisfies the unit's real intent (not just the letter of the tests), or deciding APPROVE / REQUEST_CHANGES / ESCALATE_SECURITY / BLOCK. Do NOT use for diagnosing an observed failure, a flaky test, or a regression that already exists — use rca-investigation. The code-reviewer agent's playbook.
---

# Code Review

Pre-merge gate for a **proposed change**. Review the diff for correctness and
regressions, apply a standing security lens, independently judge whether the change
satisfies the unit of work's **real intent** (not just the letter of its tests),
and emit **one enumerated verdict**. Review only — recommend fixes; the
`implementer` applies them. This is the `code-reviewer` agent's playbook.

No failure is required to run this skill — you are gating a change before it
merges. If a failure has already been **observed** (a test fails, a feature broke,
something is flaky in production), that is diagnosis work: stop and route to
`rca-investigation` (the `debugger` agent) instead.

## Method

```text
- [ ] 1. Frame (read the unit of work: scope, acceptance_criteria, non_goals)
- [ ] 2. Correctness (does the diff do what it claims, no regressions)
- [ ] 3. Intent vs letter (does it satisfy real intent, or just pass the tests)
- [ ] 4. Spec-conformance (apply the convention: coverage + reachability + companions + no deferral)
- [ ] 5. Security lens (the standing lightweight pass — escalate per the boundary)
- [ ] 6. Verdict (exactly one: APPROVE / REQUEST_CHANGES / ESCALATE_SECURITY / BLOCK)
```

### 1. Frame the review

Read the unit of work the change implements — its `scope`, `acceptance_criteria`,
and `non_goals`. The acceptance criteria are what the `test-engineer`'s grading
tests (the **oracle**) are derived from. You review against the **unit's intent**,
using the oracle as evidence — not as the definition of correct. Note what is
explicitly out of scope so you don't request changes that belong to another unit.

### 2. Correctness & regressions

Read the diff and judge whether it does what it claims and breaks nothing that
worked before. Look for: logic errors and wrong edge-case handling; broken or
missing error handling; off-by-one and boundary bugs; concurrency and resource
issues; changes that alter behavior callers depend on; dead, duplicated, or
needlessly complex code. See `reference/review-rubric.md` for the full checklist.

### 3. Intent vs letter — the check this skill OWNS

This is the verifier half of **"don't edit the oracle."** The `implementer` may not
weaken the grading tests to pass; your job is to confirm the change satisfies the
unit's **real intent**, not merely the **letter** of whatever tests exist. Ask:

- Does the code actually deliver the value in `scope` and `acceptance_criteria`, or
  does it pass the tests through a shortcut, a special-case, or a hard-coded answer?
- Were tests **narrowed, deleted, or loosened** in this diff to make red go green?
  A diff that edits the oracle to fit the code is a red flag — the oracle is the
  `test-engineer`'s, and weakening it is exactly the failure this check catches.
- Are there obvious cases inside `scope` that no test exercises, where the code
  would be wrong? Gaps in the oracle are still your finding to raise.

A change can pass every test and still fail intent. When it does, that is
`REQUEST_CHANGES` (or `BLOCK` if the oracle itself was broken — see verdicts).

### 4. Apply the spec-conformance convention

This pre-merge review is where the `spec-conformance` convention is **applied** —
not a new gate, ceremony, or verdict, just a lens you run before concluding. Check
the change against the unit's spec, proportional to its `risk_tier`:

- **Requirement coverage** — every `acceptance_criterion` is actually satisfied by
  the change (using the oracle as evidence, per step 3), not just the ones the tests
  happened to cover.
- **End-to-end reachability** — the capability has a real **user-reachable path**;
  no orphan feature wired to nothing (an API with no caller, a slice that never
  connects end to end). Look for the run-the-app evidence the `test-engineer`
  furnishes (see `testing-strategy`).
- **Companion freshness** — the docs, tests, and changelog the change implies were
  updated **in the same effort**, not deferred.
- **Converge / anti-deferral** — diff the change against the spec for silently
  **deferred or descoped** items ("v2", "later", "good enough for now"). An unmet or
  deferred item is **reopened**, not waved through: you **REQUEST_CHANGES** (or
  **BLOCK** on a fundamental mismatch) rather than passing it. You do **not**
  approve a descope — **only the human arbiter** may approve narrowing the spec, and
  only at the existing **Gate 3** Decision Record. ("Spec-conformance" / "definition
  of done" is a kit convention expressed over the native `acceptance_criteria` /
  `non_goals` / `risk_tier`; AWS AI-DLC names neither.)

**Fold the result into the existing verdict** below — there is no separate
completeness verdict or gate. A conformance gap routes through `REQUEST_CHANGES`
(or `BLOCK`); a clean pass contributes to `APPROVE`.

### 5. Standing security lens (lightweight)

Every review carries a **lightweight security pass** — load the `security-review`
skill and run its quick checks over the diff. This is the in-line half of the
hybrid model: you catch ordinary issues in flow; the dedicated `security` agent
owns deep/critical work. You do **not** do a full threat model here — you decide
whether this change **crosses the escalation boundary** below.

### Escalation boundary → the `security` agent (ESCALATE_SECURITY)

Emit **`ESCALATE_SECURITY`** (and stop short of approving) when the change does
either of the following — this is the boundary from ADR-0004, applied verbatim:

- **Touches a sensitive surface:** authentication, cryptography, secrets/credential
  handling, **untrusted input**, anything that **runs on another machine**, or MCP
  configuration. *(Also escalate on an explicit threat-model request.)*
- **Surfaces a High+ severity finding** in your lightweight pass — any finding you
  rate High or Critical, regardless of surface.

Below that bar (a Low/Medium finding on an ordinary surface), keep it in-line:
record it and use `REQUEST_CHANGES`. The boundary keeps routing deterministic —
ordinary hygiene stays with you; real risk reaches the specialist.

### 6. Emit exactly one verdict

Conclude with **one** enumerated verdict. The enumeration keeps the merge gate
deterministic for the Orchestrator and the arbiter:

| Verdict | When | What happens next |
| --- | --- | --- |
| `APPROVE` | Change satisfies the unit's intent and the oracle; security lens clean; safe to merge. | Proceeds to the merge gate (Gate 3) — still needs the human arbiter's Decision Record. |
| `REQUEST_CHANGES` | Defects, regressions, intent gaps, or a Low/Medium security finding; not mergeable as-is. | Back to the `implementer`; re-review after the fix. |
| `ESCALATE_SECURITY` | The change crosses the security escalation boundary above. | Hand off to the `security` agent; resolve before the merge gate. |
| `BLOCK` | A fundamental problem — wrong approach, scope mismatch, or a **broken/edited oracle** (the grading tests were weakened to pass). | Stop; escalate to the human arbiter. |

`APPROVE` is a recommendation, not the gate itself — the arbiter's Decision Record
opens the merge gate. Full output shape, severity rubric, and worked examples are
in `reference/review-rubric.md`; read it before your first review.

## Boundaries

- **Proposed change, no failure observed → this skill.** Gating a diff/PR pre-merge.
- **A failure already exists (test fails, regression, flaky, broke in prod) →
  `rca-investigation`** (the `debugger` agent). RCA explains a symptom; review gates
  a change.
- **Deep/critical security (threat model, High+ finding, sensitive surface) →
  `security` agent** via `ESCALATE_SECURITY`. You hold only the lightweight lens.
- **Test design and the oracle → `test-engineer`** (via `testing-strategy`). You
  verify the oracle wasn't bent; you don't author it.
