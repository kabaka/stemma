# Test methodologies — detail and fit

Per-methodology detail behind the selection framework in `../SKILL.md`. Read the
section for the methodology you're weighing. None is mandatory; **TDD is the
default** for production, AI-implemented work (see "Why TDD for AI work" at the
bottom and the don't-edit-the-oracle rule in the parent skill). This is
non-dogmatic: pick the methodology that fits the unit's clarity, risk, and output
shape, and record the choice if it deviates from the default.

## Table of contents

- [TDD — test-driven (red-green-refactor)](#tdd--test-driven-red-green-refactor)
- [BDD — behavior-driven](#bdd--behavior-driven)
- [ATDD / specification by example](#atdd--specification-by-example)
- [Property-based testing](#property-based-testing)
- [Approval / snapshot testing](#approval--snapshot-testing)
- [Spike / test-after](#spike--test-after)
- [Why TDD is the default for AI-implemented work](#why-tdd-is-the-default-for-ai-implemented-work)

## TDD — test-driven (red-green-refactor)

Write a failing test for the next small increment of behavior, confirm it fails
(red), write the minimum code to pass it (green), then refactor with the test as a
safety net — and repeat. Kent Beck's "Canon TDD" frames it as: list the behaviors,
turn one into a concrete failing test, make it pass, refactor, move to the next.

- **What it is:** test-first, one tiny red→green→refactor cycle at a time, driven
  off a running list of the behaviors the unit must have.
- **When it shines:** clear-enough requirements; production code you'll maintain;
  logic with branches and edge cases; medium-to-high risk; refactoring-heavy work
  where the regression net pays for itself; **any AI-implemented unit** (the tests
  pin intent before code exists, so a confident-but-wrong implementation fails).
- **Poor fit:** genuine throwaway exploration where you don't yet know the design
  or the interface (use a spike first); pure UI look-and-feel; cases where the
  oracle is easier to express as an example table (ATDD) or an invariant
  (property-based).
- **Worked example.** Unit: "parse an ISO-8601 date, reject anything else."
  1. List behaviors: valid date parses; trailing garbage rejected; empty string
     rejected; out-of-range month rejected.
  2. Write `parses_valid_iso_date()` asserting `parse("2026-06-17")` returns the
     right value. Run it → **red** (function doesn't exist).
  3. Implement just enough to pass → **green**. Commit.
  4. Add `rejects_trailing_garbage()` → red → implement → green. Repeat for the
     remaining behaviors. Refactor the parser once tests are green; they stay
     green or the refactor is wrong.

## BDD — behavior-driven

Express behavior as concrete scenarios in `Given / When / Then` form, in language a
non-engineer stakeholder can read. Often (not necessarily) automated with a
Gherkin-style runner. BDD is TDD pointed at *behavior described in domain
language*, emphasizing shared understanding over test mechanics.

- **What it is:** scenario-first specs (`Given` a context, `When` an action,
  `Then` an outcome) that double as living documentation and as the test oracle.
- **When it shines:** workflows with real stakeholder/domain semantics; acceptance
  criteria already phrased as scenarios; cross-functional features where shared
  understanding of behavior matters more than unit-level mechanics.
- **Poor fit:** pure algorithmic/internal code with no stakeholder-facing behavior
  (the Gherkin layer is overhead); micro-optimizations; throwaway spikes.
- **Worked example.** Feature "password reset":
  `Given a registered user, When they request a reset for their email, Then a
  single-use reset link is sent and is valid for 1 hour.` Each `Then` clause maps
  to a grading assertion; the scenario set *is* the acceptance-criteria coverage.

## ATDD / specification by example

Acceptance-Test-Driven Development: the team agrees the acceptance tests **before**
implementation, expressed as concrete examples (often a table of inputs →
expected outputs). The examples *are* the specification — "specification by
example." Distinct from BDD in emphasis: ATDD anchors on the agreed acceptance
example set; BDD anchors on behavior narratives.

- **What it is:** agree the acceptance examples up front; implement until those
  examples pass; the example set defines "done."
- **When it shines:** clear, enumerable rules with many input→output cases (pricing
  tiers, tax brackets, validation matrices, eligibility rules); when a table of
  examples communicates the requirement better than prose.
- **Poor fit:** exploratory or emergent designs where you can't enumerate examples
  yet; behavior dominated by invariants rather than specific cases (property-based
  fits better).
- **Worked example.** Shipping cost: a table of
  `(weight, zone) → cost` rows agreed with the stakeholder becomes the parametrized
  grading test. Implementation is done when every row passes and no row was
  weakened to fit the code.

## Property-based testing

Instead of hand-picked examples, state a **property/invariant** that must hold for
*all* inputs, and let a generator throw many randomized (and shrinking) inputs at
it to find counterexamples. Complements example-based tests; rarely replaces them.

- **What it is:** assert invariants (round-trip, idempotence, ordering,
  conservation, "never crashes on valid input") over generated inputs.
- **When it shines:** output has clear invariants; parsers/serializers
  (`decode(encode(x)) == x`); data structures; numeric/encoding code; anywhere the
  input space is too large to enumerate and edge cases hide in the corners.
- **Poor fit:** behavior with no clean invariant to state; UI; tiny fixed-case
  logic where a couple of examples are clearer; when failures are hard to reproduce
  because generation isn't seeded (always log/seed the failing case).
- **Worked example.** For the date parser above: property
  `for all valid date d: parse(format(d)) == d` (round-trip), plus
  `parse never throws — it returns ok or a typed error — for any string`. The
  generator surfaces the off-by-one on month boundaries an example set might miss.

## Approval / snapshot testing

Capture the program's output once, have a human **approve** it as the reference,
then fail the test whenever output diverges from the approved snapshot until
re-approved. Also called golden-master / characterization testing.

- **What it is:** record output → human approves the golden file → future runs diff
  against it; intentional changes require explicit re-approval.
- **When it shines:** large/structured outputs that are tedious to assert field by
  field (rendered HTML, generated code/config, serialized trees, CLI transcripts);
  **characterizing legacy code** before refactoring (pin current behavior, then
  change safely); rich diffs are more useful than a boolean.
- **Poor fit:** non-deterministic output (timestamps, ordering, randomness) unless
  scrubbed; when "approve" becomes rubber-stamping noise; as a substitute for
  asserting *intent* — a snapshot pins *what the code does*, which may be wrong, so
  pair it with intent assertions for anything load-bearing.
- **Worked example.** A report generator: run it on a fixed fixture, approve the
  rendered output as `report.approved.txt`; thereafter any diff fails the test and
  a human must approve the new golden file deliberately.

## Spike / test-after

An XP **spike** is a deliberately throwaway experiment to answer a question or
reduce uncertainty ("can this library do X?", "what does this API return?").
Spikes are **explicitly not** kept and **need no unit tests** — the learning is the
deliverable, and the code is discarded. **Test-after** writes tests once behavior
is already implemented (weaker than TDD: tests retrofitted to code tend to encode
what the code does, not what it should do).

- **What it is:** spike = throwaway exploration, no oracle, code thrown away once
  the question is answered. Test-after = implement first, add tests afterward.
- **When it shines:** *spike* — early exploration/prototyping, unknown feasibility,
  learning an API, prototyping a UI direction; the unit's `risk_tier` is
  effectively N/A because nothing ships. *Test-after* — only as a fallback for
  trivial, low-risk glue you didn't drive test-first, and even then keep tests
  asserting intent.
- **Poor fit:** anything that ships to production (promote a spike's *learnings*
  into a properly TDD'd unit; don't ship the spike); high-risk units (test-after
  gives the weakest oracle and the weakest guarantee against a wrong-but-passing
  implementation).
- **Worked example.** Spike: a 30-minute script to confirm a payment SDK's webhook
  payload shape — no tests, deleted afterward; the real integration is then built
  test-first as its own unit. Throwaway exploration carries **no unit-test
  obligation**; that carve-out is the point.

## Why TDD is the default for AI-implemented work

When an AI writes the implementation, the strongest guard against "tests pass but
the code is wrong" is to **fix the oracle before the code exists**:

1. Write the tests first, derived from the unit's acceptance criteria.
2. **Run them and confirm they fail** for the right reason (the behavior isn't
   built yet) — a test that passes before any code is a false oracle.
3. **Commit the failing tests** so they are the fixed, independent target.
4. Implement until they pass **without modifying the tests**.

Step 4 is exactly the parent skill's **don't-edit-the-oracle** rule, now motivated:
an implementer (human or AI) that can edit its own grading tests has no independent
verifier. Writing tests first, confirming red, and freezing them is what makes a
green run trustworthy. This mirrors Anthropic's Claude Code TDD guidance (write
tests, confirm they fail, commit them, then implement against them) and the
long-standing TDD practice described by Beck and Fowler.

The one carve-out: **spikes**. Throwaway exploration needs no tests at all — but its
output must not ship. Promote what you learned into a unit built test-first.
