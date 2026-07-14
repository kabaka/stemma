---
name: rca-investigation
description: Root-cause analysis for an OBSERVED failure or regression in your product — reproduce, isolate, diagnose the true cause, and recommend a fix plus its owner. Use when something is already broken: "why is this failing / flaky / broken," a test that started failing, a regression after a change, a production incident, a crash, or unexpected behavior you can point at. Investigate only — hands the fix to the implementer; does not apply it. Do NOT use to review a proposed change before merge — use code-review. The debugger agent's playbook.
---

# RCA Investigation

Find the *root cause* of an **observed failure**, not the symptom. Reproduce it,
isolate the responsible code, diagnose why it happens, and recommend the fix and
who should make it. Investigate only — you diagnose; the `implementer` applies the
fix. This is the `debugger` agent's playbook.

This skill is for a failure that **already exists** — a test that fails, a
regression after a change, a flaky check, a crash, an incident, behavior that
doesn't match intent. If instead you are gating a **proposed change** that hasn't
failed (a diff or PR before merge), that is `code-review` (the `code-reviewer`
agent) — stop and route there.

## Method

```text
- [ ] 1. Reproduce (capture the exact failing conditions: command, input, env)
- [ ] 2. Isolate (narrow to the responsible file / function / change)
- [ ] 3. Diagnose (the true cause — why it happens, not just what failed)
- [ ] 4. Recommend (the fix approach and the owning agent)
- [ ] 5. Prevent (the test or check that would have caught it)
```

### 1. Reproduce

Confirm the failure and the minimal conditions that trigger it. Capture the exact
evidence: the failing command and its output/stack trace, the input or request that
triggers it, the environment (version, OS, config), and — for an intermittent
failure — what makes it flaky (timing, ordering, concurrency, external state). A
reliably reproducible case is the most valuable evidence; a bug you cannot
reproduce is not yet diagnosed. For a true flake, characterize the failure rate and
the variable that flips it.

### 2. Isolate

Bisect the surface using read-only diagnostics. Use `git log` / `git diff` /
`git bisect` to find the change that introduced the regression; `grep` / `glob` to
locate the relevant code; targeted reading and a single re-run to narrow scope. Pin
the failure to the specific file, function, line, dependency, or interaction that
owns it. For a regression, the introducing commit is usually the fastest route to
the cause.

### 3. Diagnose

State the underlying cause precisely, distinct from the symptom. "The endpoint
returns 500" is a symptom; "the handler dereferences `user.session` before the
auth middleware populates it, so any unauthenticated request null-derefs" is a
cause. Distinguish the **root cause** from **contributing factors** (a missing
guard, a too-broad type, an absent test that let it through). Diagnose with
evidence — point at the line and the mechanism, don't speculate.

### 4. Recommend

Propose the fix approach and name the owning agent — usually the `implementer` for
a code fix, the `test-engineer` if the oracle has a gap, `devops` for an
environment/release cause, or `security` if the root cause is a vulnerability (a
High+ security root cause should escalate to `security`, not just be noted). You
recommend; you do not apply the fix — that crosses into authoring.

### 5. Prevent

Recommend the specific test or check that would catch a recurrence — a regression
test derived from your reproduction, an assertion the oracle was missing, a guard,
or a CI check. A regression that slipped through usually warrants a new test that
encodes the reproducing case, owned by the `test-engineer`.

## Common failure classes

- **Failing test / regression after a change** — a previously-green test now fails;
  `git diff` against the last good commit isolates the introducing change.
- **Flaky / intermittent failure** — passes and fails non-deterministically; the
  cause is usually timing, test-ordering, shared mutable state, or an external
  dependency. Find the variable that flips it.
- **Crash / unhandled error** — a stack trace points near the symptom; trace back
  to the input or state that reaches the bad line.
- **Wrong output / behavior mismatch** — code runs but produces the wrong result;
  reproduce with the minimal input, then locate where actual diverges from intended.
- **Production / integration incident** — narrow from logs and the deploy timeline;
  correlate the failure window with a change, config, or dependency shift.

## Output

An RCA report: **Issue · Reproduction · Root Cause · Contributing Factors ·
Recommended Fix (and owner) · Prevention**. Include the exact failing command and
output, or the stack trace / reproducing input, as evidence. See
`reference/rca-report.md` for the template and a worked example.

## Boundaries

- **Observed failure (fails, flaky, regressed, crashed) → this skill.** Explaining a
  symptom that already exists.
- **Proposed change, no failure yet (diff/PR before merge) → `code-review`** (the
  `code-reviewer` agent). Review gates a change; RCA explains a failure.
- **You diagnose, you don't fix.** The `implementer` applies the fix; the
  `test-engineer` adds the prevention test; escalate a security root cause to
  `security`.
