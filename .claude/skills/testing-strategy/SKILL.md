---
name: testing-strategy
description: How to design the test oracle for a unit of work and verify intent, not just the letter — choosing test levels, covering every acceptance criterion, authoring tests independently of the implementation, reporting failures, and handing off to code-review. Owns the "don't edit the oracle" rule — the test-engineer owns the grading tests, the implementer never edits them, and tests assert true intent so passing means the code is right rather than that the test was gamed. Use when you write or design tests, plan a test strategy or coverage, decide what and how to test, verify behavior, or strengthen the test suite. The `test-engineer` agent's playbook.
---

# Testing Strategy

You design and own the **test oracle** — the grading tests that decide whether a
unit of work is actually done. The oracle is the **independent verifier** of
Construction: passing it must mean the code is *right*, not that the test was bent
to fit the code. This skill is the Construction verify step; the full lifecycle is
in `aidlc-workflow`, the concepts in `aidlc-methodology`.

Your single guarantee: **a green oracle is trustworthy.** Everything below protects
that.

## The non-negotiable: don't edit the oracle

This is the **independent-verifier split** the product bakes in. Hold it exactly:

- **You (`test-engineer`) own the grading tests.** You author and maintain them from
  the unit's `acceptance_criteria`, independent of how the code happens to be
  written.
- **The `implementer` never edits the grading tests.** The implementer writes code
  to *pass* the oracle; it does not move the goalposts. Weakening, deleting, or
  rewriting a grading test to make a unit "pass" is forbidden — it produces the
  exact "tests pass but the code is wrong" failure this split exists to prevent.
- **If the implementer believes a grading test is wrong,** it does **not** edit it.
  It escalates to **you** (the oracle owner); if unresolved, the **human arbiter**
  decides at the gate. You change a test only when the *criterion or its
  interpretation* is genuinely wrong — never to accommodate a convenient
  implementation.

Why it is structural and not etiquette: an implementer who can edit the test it is
graded by has no independent verifier at all. Keeping authorship separate is what
makes "passing" mean something.

### Tests assert intent, not a gameable proxy

A test that pins a brittle, incidental detail can pass while the behavior is wrong
— and can be "satisfied" by code that games the proxy. Author the oracle against
the **acceptance criterion's true intent**:

- Assert the **observable behavior / contract** the criterion describes, not an
  internal artifact that merely correlates with it (an exact log string, a private
  field, a call count that isn't the actual requirement).
- Prefer assertions a wrong-but-plausible implementation would **fail**. If a test
  would pass under an implementation you know is incorrect, it is testing the proxy,
  not the intent — tighten it.
- Cover the criterion's **boundaries and failure modes**, not just the happy path —
  empty/invalid input, error handling, the off-by-one edge. Intent includes how it
  behaves when things go wrong.

## What and how to test

Derive the oracle from the **Unit-of-Work contract** — specifically its
`acceptance_criteria` (the testable conditions that define "done") and `non_goals`
(out of scope; do not test beyond them). The contract schema is in `aidlc-workflow`
→ `reference/artifacts.md`.

Choose levels by what the criterion is about — use the **lowest level that faithfully
captures the intent**, adding higher levels only where the intent lives there:

| Level | Use for | Note |
| --- | --- | --- |
| **Unit** | A single function/module's logic, branches, edge cases. | Fast, most numerous; where most boundary/failure assertions live. |
| **Integration** | Behavior across a boundary — DB, API, file I/O, two modules' contract. | Use when the criterion is *about* the seam, not just the parts. |
| **End-to-end / acceptance** | A whole user-visible path that an acceptance criterion describes directly. | Fewer; reserve for criteria that are inherently end-to-end. |

Right-size to the unit's `risk_tier` (see `aidlc-workflow` → triage): a **trivial**
unit may need only a focused unit test or two; a **standard** unit gets full
acceptance-criteria coverage across the appropriate levels; a **high-risk** unit
gets the deepest oracle — boundaries, failure modes, security-relevant cases, and
adversarial inputs — and warrants `security` challenge.

## Choosing a methodology — TDD by default, not by dogma

How you *arrive at* the oracle is a real choice. **TDD (red-green-refactor) is the
default** for production, AI-implemented units — but it is not mandatory. Pick the
methodology that fits the unit's requirement clarity, whether it's
explore-vs-production, its risk, and its output shape/invariants. Detail per
methodology — what each is, where it shines, where it's a poor fit, with a worked
example — is in [reference/methodologies.md](reference/methodologies.md); read it
when the choice isn't obvious.

| Methodology | Fits when | Output / signal |
| --- | --- | --- |
| **TDD** (red-green-refactor) | Requirements clear enough; production code you'll maintain; branchy logic, edge cases; medium–high risk; **any AI-implemented unit**. | Test-first cycles; the oracle exists before the code. **Default.** |
| **BDD** (behavior-driven) | Behavior carries real domain/stakeholder semantics; criteria phrased as scenarios. | `Given/When/Then` scenarios that double as living docs. |
| **ATDD / spec-by-example** | Clear, enumerable rules with many input→output cases (pricing, tax, validation matrices). | An agreed example table that *is* the spec. |
| **Property-based** | Output has clear invariants; large input space; parsers, serializers, data structures. | Invariants over generated inputs (round-trip, idempotence). |
| **Approval / snapshot** | Large structured output; characterizing legacy code before a refactor. | A human-approved golden file; future diffs fail. |
| **Spike / test-after** | *Spike:* throwaway exploration/prototyping, unknown feasibility. *Test-after:* trivial low-risk glue only. | *Spike:* learning, code discarded, **no unit tests**. *Test-after:* weakest oracle. |

Choose by axis: **requirement clarity** (clear → TDD/ATDD; fuzzy/unknown → spike
first), **explore vs production** (explore → spike, no tests; production → test
first), **risk** (higher risk → stronger, intent-asserting oracle, never
test-after), and **output shape** (enumerable cases → ATDD; invariants →
property-based; large blobs → approval; behavior narratives → BDD). These compose —
e.g. a TDD unit whose oracle uses property-based assertions for a parser.

### Why TDD is the strongest pattern for AI-implemented work

When an AI writes the code, TDD is the best guard against "tests pass but the code
is wrong," because it **fixes the oracle before the code exists**:

1. **Write the tests first** from the acceptance criteria.
2. **Run them and confirm they fail** for the right reason — a test green before
   any code is a false oracle.
3. **Commit the failing tests** as the fixed, independent target.
4. **Implement until they pass — without modifying the tests.**

Step 4 *is* the **don't-edit-the-oracle** rule above, now motivated: an
implementer (human or AI) that can edit its own grading tests has no independent
verifier, so freezing the tests first is what makes a green run mean something.
This reinforces — never relaxes — that rule.

**The carve-out: spikes.** A throwaway XP spike — a deliberately discarded
experiment to answer a feasibility question — needs **no unit tests** at all. Don't
force TDD onto exploration; instead, promote what the spike taught you into a real
unit built test-first, and discard the spike code. Test-after is a fallback for
trivial, low-risk glue only, and even then tests must assert intent (it gives the
weakest guarantee against a wrong-but-passing implementation).

## Coverage: every acceptance criterion, accounted for

Coverage here means **every `acceptance_criterion` is verified by at least one
grading test** — not a line-coverage percentage. Build a visible map:

```text
acceptance_criterion → grading test(s) that assert it
```

Rules:

- **No criterion is unmapped.** An acceptance criterion with no grading test is an
  incomplete oracle — a unit could be declared "done" with that behavior untested.
- **No test grades outside `scope`/`non_goals`.** Don't fail a unit for behavior it
  deliberately excluded.
- A criterion may need several tests (happy path + boundaries + failure mode); one
  test may cover part of several criteria. The map, not a count, is the gate.

## Author independently of the implementation

To stay an *independent* verifier, write the oracle to the **criterion**, not to the
code's shape:

- Derive each test from the acceptance criterion's intent. Where the criteria allow
  it, author the oracle **before or alongside** the implementation (test-first), not
  after, retrofitted to whatever the code does.
- Assert the **public contract / observable behavior**, not private internals — so a
  legitimate refactor that preserves behavior still passes, and a behavior change
  fails.
- **Never relax a test to match a failing implementation.** A failing oracle is a
  signal about the code, not a defect in the test (unless the *criterion* itself was
  wrong — then fix the criterion through the arbiter, and the test follows).

## Reporting failures

When the oracle fails, report so the implementer can act and the arbiter can judge —
clearly and without weakening anything:

- **Which** acceptance criterion / test failed, and the **expected vs actual**
  behavior.
- **Reproduction**: the exact command or steps and the relevant output (real output,
  never fabricated — if you did not run it, say so).
- **Scope**: is this a code defect (back to `implementer`), a genuinely wrong
  criterion (escalate to the human arbiter), or a flaky/environmental issue
  (call it out)?
- Do **not** propose silencing or loosening the test as the fix. The fix is in the
  code or, rarely, in the criterion via the arbiter.

## Show, don't assert — the run-the-app evidence level

The strongest evidence a unit is complete is **demonstration, not assertion**:
**run the actual thing and show its real output**. An automated test that goes green
is one kind of evidence; for behavior that lives end-to-end — a CLI that must
produce a result, a server that must answer a request, a slice whose value is its
**reachability** — back the green with a **run-the-app observation**:

- Show the **command and its real result** — the invocation you ran and the output
  it produced, an **end-to-end / E2E run** through the slice, or a reachability
  observation that the user-facing path actually responds (not a description of what
  it *would* do).
- This **reinforces — never replaces** the don't-edit-the-oracle chain and the
  rule that all reported output is **real, never fabricated**: if you did not run
  it, say so; you may not paste output you did not produce. Demonstration that the
  thing runs is exactly what makes "done" credible rather than merely claimed.
- Right-size it to `risk_tier`: a trivial unit may need a single shown command; a
  standard or high-risk slice warrants an end-to-end run of the whole path. This
  whole-unit "show it works" check is the `spec-conformance` convention — the
  pre-merge `code-review` applies its checklist (requirement coverage, reachability,
  and companion freshness) against your evidence; furnish the run-the-app proof it
  needs. ("Show it works" / completeness here is a kit convention; AWS AI-DLC names
  no such level — we express it over the native `acceptance_criteria` and
  `risk_tier`.)

## Handoff to code-review — the independent verifier chain

You produce the **grading tests** half of the **diff + tests** Construction handoff
(the `implementer` produces the diff). Together they go to `code-reviewer`, which
adds the **second** independent check:

- **You** verify the code against the **letter** of the oracle (the tests pass).
- **`code-reviewer`** does the independent **intent-vs-letter** check — confirming
  the code satisfies the *intent* of the unit, not merely that the literal tests are
  green — and emits an **enumerated verdict**: `APPROVE`, `REQUEST_CHANGES`,
  `ESCALATE_SECURITY`, or `BLOCK` (definitions in `aidlc-workflow` →
  `reference/artifacts.md`). See `code-review`.

This two-layer check (oracle + independent reviewer) is why a passing unit is
trustworthy. The review verdict feeds **Gate 3 (merge)**; an `APPROVE` does not open
the gate by itself — the human arbiter records the merge decision.

## Checklist

- [ ] Did I derive every test from the unit's `acceptance_criteria` (not from the
      code's shape), staying inside `scope`/`non_goals`?
- [ ] Is **every** acceptance criterion mapped to at least one grading test?
- [ ] Do tests assert **observable intent/contract**, not a gameable proxy — and
      would a wrong-but-plausible implementation **fail** them?
- [ ] Are boundaries and failure modes covered, not just the happy path?
- [ ] Are test levels right-sized to the criterion and the `risk_tier`?
- [ ] Did I keep the oracle **independent** — never relaxing a test to fit a failing
      implementation, never letting the implementer edit it?
- [ ] Are failures reported with real expected-vs-actual output and reproduction,
      with no proposal to weaken the test?
- [ ] Is the **diff + tests** handoff ready for `code-review`'s independent
      intent-vs-letter check and enumerated verdict?
