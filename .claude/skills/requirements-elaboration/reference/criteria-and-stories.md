# Requirements craft — acceptance criteria, stories, splitting, questions

Deeper patterns for `requirements-elaboration`. Read this when a requirement is
hard to make testable, a unit is hard to split, or the clarifying conversation is
sprawling. The `SKILL.md` body has the procedure; this is the toolkit.

## Contents

- [Testable acceptance criteria](#testable-acceptance-criteria)
- [User stories and the INVEST lens](#user-stories-and-the-invest-lens)
- [Splitting units of work](#splitting-units-of-work)
- [Non-goals that actually hold](#non-goals-that-actually-hold)
- [The clarifying-question protocol in practice](#the-clarifying-question-protocol-in-practice)
- [risk_tier judgement calls](#risk_tier-judgement-calls)

## Testable acceptance criteria

Each criterion must be **observable and binary** — a `test-engineer` derives one
grading test from it without guessing intent. Two useful forms:

- **Given/When/Then** for behavior: "Given a logged-out user, when they request
  `/account`, then they are redirected to `/login` with a 302."
- **Assertion** for constraints/non-functional: "P95 latency for `/search` is under
  300 ms at 100 RPS."

| Weak (don't) | Testable (do) |
| --- | --- |
| "Handles errors gracefully." | "On a malformed payload, returns 400 with an `errors[]` array; no 5xx." |
| "Is fast." | "Returns within 200 ms for a cached result." |
| "Works on mobile." | "Renders without horizontal scroll at 360 px width." |
| "Secure login." | "After 5 failed attempts in 10 min, the account locks for 15 min." |

Rules of thumb:

- One criterion = one check. Split "validates and persists and notifies" into three.
- Name the **observable** (status code, value, state, log, latency), not the
  internal mechanism.
- Cover the **unhappy paths** the unit owns — empty input, unauthorized, not-found,
  conflict — not just the success case.
- If you cannot phrase a criterion as a test, the requirement is still ambiguous —
  go back to the question protocol.

## User stories and the INVEST lens

Use the story form **"As a `<role>`, I want `<capability>`, so that `<value>`"**
when a user-value framing sharpens the WHAT. Drop it for pure constraints and
infrastructure where there is no end-user role — a plain requirement is clearer.

A good unit of work tends to be **INVEST**:

- **I**ndependent — minimal coupling to other units (record real coupling in
  `dependencies`).
- **N**egotiable — states the need, not a frozen implementation.
- **V**aluable — delivers something usable on its own (cut along value seams).
- **E**stimable — clear enough to size to a bolt.
- **S**mall — fits the `bolt_time_box` (hours–days).
- **T**estable — every acceptance criterion is checkable.

If a unit fails I or S, split it (below). If it fails T, the criteria need work.

## Splitting units of work

When a unit is too big for a bolt or can't be tested apart, split along a **value
seam**, not a technical layer. Common patterns:

- **By workflow step** — signup → verify email → first login as separate units.
- **By rule/variation** — the simple pricing case first; tiered/discount pricing as
  a later unit.
- **By happy path then edges** — core success path as one unit; bulk/error/empty
  handling as follow-ups (only when each is independently valuable).
- **By operation** — create as one unit, then read/update/delete, if each carries
  value alone.

Anti-pattern: splitting into "frontend unit / backend unit / database unit" — none
delivers value alone, and they can't be tested independently. That is a layer cut,
not a value seam.

## Non-goals that actually hold

Non-goals prevent scope creep only if they are **specific and visible**. Write the
exclusion a reader would otherwise assume is included:

- Good: "Does **not** support OAuth providers — email/password only this unit."
- Good: "No i18n; English copy only."
- Weak: "Out of scope: extra features." (Says nothing; excludes nothing.)

Pull non-goals straight from the questions where the human said "not now" — those
are the highest-value exclusions to record.

## The clarifying-question protocol in practice

A worked shape for step 1 of the procedure:

1. **Inventory ambiguities.** For each: *what's unclear*, *why it matters*
   (scope / domain model / acceptance), *options*.
2. **Rank by blast radius.** An answer that changes the domain model or unit
   boundaries outranks a wording nit.
3. **Ask with a default.** "Should deleted items be soft- or hard-deleted? I'll
   assume soft-delete (recoverable) unless you prefer otherwise — it affects the
   data model and the acceptance criteria."
4. **Classify each.** *Blocking* → wait for the human. *Non-blocking* → proceed on
   the recorded assumption and flag it for the gate.
5. **Batch and stop.** Don't trickle; ask the cluster when an answer would change
   the shape of the work, then continue.

Remember the Solo Mob frame: challenge agents may contest your questions and
assumptions, but **the human answers** — agents never decide the requirements.

## risk_tier judgement calls

Assign on the unit at Inception; it gates ceremony depth in Construction (see
`aidlc-workflow` triage). When unsure between two tiers, **pick the higher** — it is
escalate-friendly and never silently downgraded.

| Signal | Leans |
| --- | --- |
| Reversible, narrow, isolated config / copy | `trivial` |
| Typical feature, contained blast radius | `standard` |
| Touches auth, crypto, secrets, money, data deletion | `high-risk` |
| Irreversible or wide blast radius | `high-risk` |
| High ambiguity even after clarifying | `high-risk` |
| Runs on another machine / untrusted input | `high-risk` (also flags `security`) |

The tier is auditable on the Decision Record, so a conservative tier is cheap
insurance, not waste.
