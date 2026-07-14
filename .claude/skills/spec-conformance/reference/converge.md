# Converge / anti-deferral + show-don't-assert

The procedure for closing a unit of work **completely**: diff what was delivered
against what was specified, reopen anything unmet or dropped (never silently
defer), and back every completeness claim with **evidence**. Run this at the
converge step, before "done" is claimed — it produces the input to `code-review`'s
existing verdict. It introduces no new gate, verdict, or ceremony.

## Contents

- [The delivered-vs-spec converge procedure](#the-delivered-vs-spec-converge-procedure)
- [The anti-deferral rule (no silent v2)](#the-anti-deferral-rule-no-silent-v2)
- [Descope: AI proposes, the arbiter decides](#descope-ai-proposes-the-arbiter-decides)
- [Show, don't assert — evidence per claim](#show-dont-assert--evidence-per-claim)
- [Folding into the existing verdict](#folding-into-the-existing-verdict)

## The delivered-vs-spec converge procedure

Before "done," compute the diff between the unit's **spec** (its native
`acceptance_criteria` + `non_goals`) and what was **delivered**:

```text
- [ ] 1. List every acceptance_criterion. For each, find the delivered behavior
        AND its oracle test result. Met + green → covered. Unmet or no test → GAP.
- [ ] 2. List every non_goal. Confirm the diff did NOT do it. An in-scope item that
        was silently dropped is a GAP; an out-of-scope item that was built is DRIFT.
- [ ] 3. List each capability in scope. Confirm a NAMED reachable path exists for
        each (UI/CLI/API/library entry). No path → ORPHAN GAP.
- [ ] 4. Confirm companions (docs, tests, changelog, cross-refs/dependencies) were
        updated in the same effort. Any stale → GAP.
- [ ] 5. Collect all GAPs and DRIFT into one list. If non-empty, the unit is NOT
        done — go to the anti-deferral rule. If empty, proceed with evidence.
```

The output is a list of unchecked boxes (gaps) and any scope drift. An empty list
with evidence behind each checked box is the only "done."

## The anti-deferral rule (no silent v2)

Any criterion **unmet**, or any in-scope item silently **dropped**, is **reopened
as work and handed back to the `implementer`** — *never* quietly deferred to a
"later phase," a "v2," or "good enough for now." This operationalizes the product's
`AGENTS.md` delivery rule: *"meet every requirement, fully — no deferring."*

- A gap is **reopened**, not waved through. The `implementer` closes it; the unit
  is re-checked.
- **DRIFT** (work done that lands in `non_goals`) is also surfaced — it is scope
  creep in the other direction, and it goes back too.
- **Escalate, never silently downgrade** — mirroring `risk_tier`'s own rule. You
  may raise a concern about a criterion; you may not lower the bar to pass.

The **only** way an unmet item legitimately leaves the checklist without being
built is an **arbiter-approved descope** (next section). No agent — not the
`implementer`, not the Orchestrator, not the reviewer — may approve it.

## Descope: AI proposes, the arbiter decides

- **AI proposes, the human decides.** A specialist that believes an item should be
  cut surfaces it as a **proposed descope with rationale** — it does **not** act on
  it.
- **Batch, never trickle.** Collect proposed descopes into **one arbiter
  checkpoint** rather than draining scope item-by-item across the bolt. One
  decision, one record of what the human agreed to drop.
- **Recorded at the existing gate.** An approved descope is recorded in the
  **existing Gate 3 merge Decision Record** (`aidlc-workflow`) — not in a new gate,
  artifact-type, or ceremony. The dropped item moves from `acceptance_criteria` to a
  documented, arbiter-approved exclusion; it does not vanish silently.

## Show, don't assert — evidence per claim

A checked box with no evidence behind it is **not checked**. This reinforces the
oracle's **"real output, never fabricated"** rule (`testing-strategy`): if you did
not run it, say so — never invent a result.

| Completeness claim | Required evidence |
| --- | --- |
| An `acceptance_criterion` is **met** | The grading test that asserts it, **run, green** — the real command + its output (e.g. `pytest -k X` → `1 passed`). |
| A capability is **reachable** | An **arbiter-confirmed assertion** of the named path, **or** a **run-the-app observation** — the command run + its result, the endpoint hit + its response, the library entry called. |
| A companion is **fresh** | The **actual diff** touching the named doc / test / changelog file — a named path, not a promise. |
| A **dependency** resolves | The referenced unit/artifact/link **exists and resolves** — verified, not assumed. |

Reachability is the one family with **no** mechanical proof — it is an
arbiter-confirmed assertion or a shown observation. State which: "confirmed by
arbiter" or "observed: `<command>` → `<result>`." Do not let an unverifiable
assertion masquerade as a tested fact.

## Folding into the existing verdict

The converge result feeds `code-review`'s **existing** enumerated verdict — this
convention emits **no** verdict of its own:

| Converge result | `code-review` verdict |
| --- | --- |
| Checklist complete, every box backed by evidence. | `APPROVE` |
| A coverage / reachability / companion box is unchecked (deferred or orphaned item). | `REQUEST_CHANGES` — back to `implementer`. |
| Scope was **silently dropped**, or the oracle was bent to hide a gap. | `BLOCK` — escalate to the human arbiter. |
| The change crosses the security escalation boundary. | `ESCALATE_SECURITY` (unchanged). |

The verdict feeds the **existing Gate 3**; an `APPROVE` does not open the gate — the
human arbiter records the merge Decision Record, where any descope is approved. See
`code-review` for the verdict definitions and `aidlc-workflow` for the gate.
