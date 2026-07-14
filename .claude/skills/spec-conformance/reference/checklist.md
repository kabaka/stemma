# Spec-conformance checklist template

The enumerated completeness checklist over a unit of work's **native** fields —
the template, the rules per family, and a filled example. Seed it at Inception
from the Unit-of-Work contract (`requirements-elaboration`); re-check it before
merge inside `code-review`. It adds **no** field to the contract.

## Contents

- [The template](#the-template)
- [Family rules](#family-rules)
- [Deriving the checklist from native fields](#deriving-the-checklist-from-native-fields)
- [Proportionality by risk_tier](#proportionality-by-risk_tier)
- [Filled example](#filled-example)

## The template

```text
Spec conformance — <unit id / title>   (risk_tier: <trivial|standard|high-risk>)

Requirement coverage (one item per acceptance_criterion):
  - [ ] AC1: <criterion text> — met AND verified by the oracle (test: <name>, evidence: <run result>)
  - [ ] AC2: ...

End-to-end reachability (every capability has a NAMED path):
  - [ ] <capability> reachable via <UI path | CLI command | API endpoint | public library entry>
        evidence: <arbiter-confirmed assertion | observation: command run + result>

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

## Family rules

The three families are **weighted equally**; dropping any one is the failure this
convention prevents.

### 1. Requirement coverage

- **One item per `acceptance_criterion`.** If the unit lists five criteria, the
  checklist has at least five coverage items. Nothing is silently dropped.
- Each criterion must be **met AND verified by the oracle** — the grading test
  (`testing-strategy`) that asserts it, run and green. A criterion with no passing
  test is an **unchecked box**, even if the code "looks right."
- A criterion may need several tests (happy path + boundary + failure mode); one
  test may cover part of several criteria. The **mapping**, not a count, is the bar.

### 2. End-to-end reachability

- Every capability the unit delivers has a **named path** by which a user or caller
  actually reaches it. The kind depends on the surface — **generalize beyond UI**:

  | Surface | Named path |
  | --- | --- |
  | `ui_bearing` unit | A UI path: screen → the control the user operates. |
  | CLI tool | A CLI command (and flags) a user runs. |
  | Service / API | An API endpoint or route a caller hits. |
  | Library / package | A public entry: exported function/class, or CLI binary. |

- A capability with **no** such path is an **orphan feature** — built but
  unreachable — and the line **stays unchecked**. Naming the path is what makes the
  *absence* of one visible.
- Reachability is an **arbiter-confirmed assertion** or **shown via evidence** (run
  the app / hit the endpoint / call the entry). Nothing mechanically proves it.

### 3. Companion freshness

- **Docs, tests, and changelog** are each their **own line item**, updated **in the
  same effort** as the change — so staleness is a visible unchecked box, not a
  silent follow-up.
- A stale companion makes the unit **incomplete**, not "done with a TODO."
- **Cross-references and `dependencies` resolve.** A referenced artifact, link, or
  dependency unit that doesn't exist/resolve is an unchecked box — **dependencies
  as reachability**: an item is not done if a thing it points to is unreachable.

## Deriving the checklist from native fields

Map each native Unit-of-Work field to the checklist — **derive, never duplicate**;
the contract stays the single source.

| Native field | Feeds | How |
| --- | --- | --- |
| `acceptance_criteria` | Requirement coverage | One coverage item per criterion, each mapped to its oracle test. |
| `non_goals` | Non-goals section | Listed as deliberately-excluded; guards against scope creep in *both* directions. |
| `dependencies` | Dependencies section | One "exists and is reachable" item per dependency. |
| `risk_tier` | Proportionality | Sets the checklist's depth (below); never removes the human gate. |
| `scope` | Reachability | Names the capabilities whose reachable paths must be listed. |
| `ui_bearing` | Reachability | Selects the path *kind* (UI path vs CLI/API/library entry). |

No new field is invented. If something can't be derived from the contract, the gap
is in the contract — raise it back to `requirements-elaboration`, don't paper over
it here.

## Proportionality by risk_tier

| `risk_tier` | Checklist depth (reachability + companions ALWAYS apply) |
| --- | --- |
| **trivial** | Terse: cover the one/two `acceptance_criteria`, one named reachability path, only the companions that actually changed. |
| **standard** | Full three-family checklist over every `acceptance_criterion`. |
| **high-risk** | Deepest: every criterion with its evidence, every capability's path confirmed, every companion named, converge diff recorded. |

The human merge gate **never** scales away. "It's trivial" is an **arbiter**
determination — propose it; the arbiter confirms it (mirrors `risk_tier`'s
"escalate, never silently downgrade").

## Filled example

A `standard`, `ui_bearing` unit: "Reset password by email."

```text
Spec conformance — UoW-42 / Reset password by email   (risk_tier: standard)

Requirement coverage:
  - [x] AC1: A known email receives a reset link within 60s — met (test:
        reset_sends_link, evidence: `pytest -k reset_sends_link` → 1 passed)
  - [x] AC2: An unknown email returns the SAME generic response (no account
        enumeration) — met (test: reset_no_enumeration → passed)
  - [ ] AC3: A reset token expires after 15 min — UNMET (test: token_expiry →
        FAILED: token still valid at 20 min) → reopen, back to implementer

End-to-end reachability:
  - [x] "Forgot password?" reachable via UI path: Login screen → "Forgot
        password?" link → email-entry form (observation: ran the app, link visible
        and submits)
  - [ ] Reset-token validation reachable via API endpoint POST /reset/confirm —
        endpoint exists but no UI/CLI reaches it yet → ORPHAN, unchecked

Companion freshness:
  - [x] Docs updated: docs/auth/password-reset.md
  - [x] Tests/oracle updated or added: tests/auth/test_reset.py
  - [ ] Changelog entry added — MISSING → unchecked
  - [x] Cross-references / dependencies resolve: links in docs verified

Non-goals (NOT done here, by design):
  - SMS / phone-based reset
  - Rate-limiting (tracked in UoW-45)

Dependencies:
  - [x] UoW-39 (email-sending service) exists and is reachable
```

Three unchecked boxes (AC3 unmet, an orphan endpoint, a missing changelog entry)
make the unit **not done**. In `code-review` this is `REQUEST_CHANGES` — back to
the `implementer` — not a silent deferral. See `converge.md` for the
delivered-vs-spec procedure that produces this verdict.
