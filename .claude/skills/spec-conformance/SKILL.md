---
name: spec-conformance
description: The completeness convention that makes a unit of work's "done" falsifiable — an arbiter-confirmable acceptance checklist derived from the unit's native acceptance_criteria, non_goals, and dependencies, seeded at Inception and re-checked before merge. Use to decide "is this actually done or did we defer something", to check every acceptance_criterion is met, to catch an orphan feature (a capability built but with no end-to-end reachable path — no UI/CLI/API/library entry), to verify companion freshness (docs, tests, changelog updated in the same effort), or to converge delivered-vs-spec and reopen any dropped scope (the anti-deferral rule, no silent v2). Backed by evidence — show, don't assert. Do NOT use to write the acceptance_criteria (requirements-elaboration), to design the test oracle (testing-strategy), or to emit the pre-merge verdict itself (code-review owns APPROVE/REQUEST_CHANGES/ESCALATE_SECURITY/BLOCK); code-review APPLIES this convention and folds the result into that existing verdict.
---

# Spec Conformance — the completeness convention

A unit of work ships **incomplete** in three recurring ways: scope is silently
**deferred** to a "v2"; a capability is built but left an **orphan** (no path a
user or caller can actually reach it by); or its **companions** — docs, tests,
changelog — go stale because they weren't updated in the same effort. This skill
is the **completeness convention** that makes "done" *falsifiable* for a unit of
work, so each of those failures becomes a visible unchecked box instead of a
surprise after merge.

The convention is **born at Inception** (seeded from the unit's contract) and
**re-checked before merge**. It is expressed entirely over the unit of work's
**native fields** — `acceptance_criteria`, `non_goals`, `dependencies`, and
`risk_tier` — that `requirements-elaboration` already produces. It introduces **no
new field, gate, verdict, agent, or ceremony.** `code-reviewer` applies it as part
of its existing pre-merge review and folds the result into its existing enumerated
verdict.

> **Kit convention, not an AWS scheme.** This completeness checklist is **our
> faithful application** of the product's own no-deferral delivery rule and its
> falsifiable-"done" test oracle — *not* an AWS-named scheme. AWS AI-DLC names no
> "definition of done." We derive the checklist from the native unit-of-work
> contract; we do not add anything to that contract.

## When to use

- Deciding **"is this actually done, or did we defer something?"** before a unit
  merges.
- Confirming **every `acceptance_criterion` is met** and verified by the oracle.
- Catching an **orphan feature** — a capability with no named end-to-end path.
- Checking **companion freshness** — docs/tests/changelog updated in the same
  effort.
- **Converging** delivered-vs-spec and reopening anything dropped (anti-deferral).

This is the *completeness* lens. It does **not** author criteria, design tests, or
own the verdict — see [Boundaries](#boundaries).

## The convention: an arbiter-confirmable acceptance checklist

Derive an enumerated checklist from the unit's native contract. Each item is
**testable, binary, observable** — a box that is checked or unchecked, never "ish."
Seed it at Inception from the unit's fields; re-check every item before "done" is
claimed at merge.

```text
Spec conformance — <unit id / title>   (risk_tier: <trivial|standard|high-risk>)

Requirement coverage (one item per acceptance_criterion):
  - [ ] AC1: <criterion> — met AND verified by the oracle (test: <name>)
  - [ ] AC2: ...

End-to-end reachability (every capability has a NAMED path):
  - [ ] <capability> reachable via <UI path | CLI command | API endpoint | public library entry>

Companion freshness (updated in the SAME effort):
  - [ ] Docs updated: <files>
  - [ ] Tests/oracle updated or added: <which>
  - [ ] Changelog entry added
  - [ ] Cross-references / dependencies resolve: <links, dependency units>

Non-goals (from non_goals — explicitly NOT done here, by design):
  - <excluded item>

Dependencies (from dependencies — must exist and be reachable):
  - [ ] <unit/artifact this one needs> exists and is reachable
```

## The three line-item families (weighted equally)

Every non-trivial unit carries all three. Dropping any one is the failure this
convention exists to prevent.

1. **Requirement coverage.** One item per `acceptance_criterion`; nothing silently
   dropped. Each criterion must be **met *and* verified by the oracle** — a green
   grading test is the evidence (see `testing-strategy` for the oracle, and "Show,
   don't assert" below). A criterion with no passing test is an unchecked box.

2. **End-to-end reachability.** Every capability the unit delivers has a **named
   path by which a user or caller actually reaches it** — and the kind of path
   depends on the surface, so generalize beyond UI:
   - a **UI path** for `ui_bearing` units (screen → control the user operates),
   - a **CLI command** for a command-line surface,
   - an **API endpoint / route** for a service,
   - a **public library entry** (exported function/class/CLI binary) for a library.

   A capability with no such path is an **orphan feature** — built but unreachable —
   and that line stays unchecked. Reachability is an **arbiter-confirmed assertion**
   (the reviewer asserts the path, the arbiter confirms) or **shown via evidence**
   (run the app / hit the endpoint / call the entry); nothing mechanically proves
   it. Name the path explicitly so the absence of one is *visible*.

3. **Companion freshness.** Docs, tests, and the changelog are updated **in the
   same effort** as the change — each its **own line item** so staleness shows up
   as a visible unchecked box instead of slipping through. A stale companion is an
   incomplete unit, not a follow-up.

**Dependencies as reachability.** An item is **not done if a thing it points to is
unreachable.** A `dependencies` entry, a cross-link, or a referenced artifact is
incomplete until that target exists and resolves.

## Converge / anti-deferral — no silent v2

Before "done" is claimed, **diff delivered-vs-spec** across the unit's
`acceptance_criteria` **and** `non_goals`. Any criterion **unmet**, or any in-scope
item silently **dropped**, is **reopened as work and handed back to the
`implementer`** — never quietly deferred to a "later phase" or a "v2." This
operationalizes the product's `AGENTS.md` rule *"meet every requirement, fully — no
deferring."*

- **AI proposes, the arbiter decides a descope.** A specialist that believes an
  item should be cut surfaces it as a **proposed descope with rationale** — it does
  not act on it. Only the **human arbiter** may approve dropping scope, and that
  approval is recorded at the **existing gate** (the Gate 3 merge Decision Record —
  see `aidlc-workflow`), not a new one.
- **Batch, never trickle.** Collect proposed descopes into **one arbiter
  checkpoint** rather than draining scope item-by-item across the bolt.
- **Escalate, never silently downgrade** — mirroring `risk_tier`'s own rule.

The full delivered-vs-spec procedure is in
[reference/converge.md](reference/converge.md) — read it before the converge step.

## Show, don't assert — completeness is backed by evidence

A completeness claim is only as good as its evidence. This reinforces the test
oracle's existing **"real output, never fabricated"** rule (`testing-strategy`):

- **Requirement coverage** is backed by **real test output** — the grading test
  that asserts the criterion, run, green. If you didn't run it, say so; never
  fabricate a result.
- **Reachability** is backed by an **arbiter-confirmed assertion** *or* a
  **run-the-app observation** — the command run and its result, the endpoint hit,
  the library entry called.
- **Companion freshness** is backed by the **actual diff** touching the doc, test,
  and changelog — a named file, not a promise.

A checked box with no evidence behind it is not checked. See
[reference/converge.md](reference/converge.md) for the evidence-per-claim table.

## Proportionality — scale by risk_tier (never skip the gate)

Scale the checklist's depth to the unit's `risk_tier`, exactly as the product
scales ceremony depth (`aidlc-workflow` → triage):

- **Trivial** (low-risk, reversible, narrow): a **terse** checklist — coverage of
  the one or two `acceptance_criteria`, a single named reachability path, and the
  companions that actually changed. Reachability and companions **still apply**,
  just lightweight.
- **Standard**: the full three-family checklist over all `acceptance_criteria`.
- **High-risk**: the deepest — every criterion with its evidence, every capability's
  path confirmed, every companion named, and the converge diff explicitly recorded.

Proportionality reduces *depth*, **never the human gate**: every unit still crosses
the arbiter's existing merge gate. "It's trivial" is an **arbiter** determination,
not an author or Orchestrator self-declaration — mirroring `risk_tier`'s
"escalate, never silently downgrade."

## Routing through the existing machinery (no new gate)

This convention rides entirely on machinery that already exists:

- **`code-reviewer` applies it.** During its existing pre-merge review (the
  `code-review` skill), the reviewer runs this completeness checklist alongside its
  correctness, intent-vs-letter, and security passes.
- **It folds into the existing verdict.** The result is **not** a new verdict — it
  feeds `code-review`'s existing enumerated verdict:
  **`APPROVE`** when the checklist is complete with evidence;
  **`REQUEST_CHANGES`** when a coverage / reachability / companion box is unchecked
  (a deferred or orphaned item is back to the `implementer`);
  **`BLOCK`** when scope was silently dropped or the oracle was bent to hide a gap;
  **`ESCALATE_SECURITY`** unchanged, per the security boundary.
- **It feeds the existing Gate 3.** That verdict feeds the **existing merge gate**;
  an `APPROVE` does not open it — the human arbiter records the merge Decision
  Record, where a descope (if any) is approved.

This is **not** a new gate, verdict type, agent, or ceremony — it is the
completeness lens *inside* the review that already gates the merge.

## Boundaries

Spec conformance is the **completeness convention** — *what "done" means*, born at
Inception, checked at merge. Keep it distinct from its neighbors:

- **Not `requirements-elaboration`.** That **authors** the `acceptance_criteria`,
  `non_goals`, and `dependencies` at Inception. This skill **derives a checklist
  from** them and judges completeness against it — it does not write them.
- **Not `testing-strategy`.** That designs the **test oracle** (the grading tests
  that verify each criterion). This skill **consumes** the oracle's result as the
  evidence for requirement coverage — it does not author tests.
- **Not `code-review`.** That is the **pre-merge check that applies** this
  convention and **owns the enumerated verdict** (APPROVE / REQUEST_CHANGES /
  ESCALATE_SECURITY / BLOCK). This skill is the *standard* that check applies; it
  emits no verdict of its own.

## Reference files

- [reference/checklist.md](reference/checklist.md) — the enumerated checklist
  **template** (the three families) over the native fields, with a filled example.
  Read it when seeding or re-checking a unit's checklist.
- [reference/converge.md](reference/converge.md) — the **delivered-vs-spec
  converge / anti-deferral** procedure and the **show-don't-assert** evidence
  table. Read it before the converge step at merge.

## Cross-references

- `requirements-elaboration` — authors the native fields this checklist derives
  from (the Unit-of-Work contract).
- `testing-strategy` — owns the oracle; its green tests are the coverage evidence.
- `code-review` — applies this convention and owns the enumerated verdict.
- `aidlc-workflow` — the lifecycle loop, the `risk_tier` triage, and the existing
  Gate 3 merge Decision Record this convention routes through.
