# RCA report template & worked example

The output shape for the `rca-investigation` skill, plus a worked example. The
report is a handoff: the `implementer` (or other owner) must be able to act on it
without re-investigating.

## Template

```text
Issue:        <one line — the observed symptom, where it shows up>
Reproduction: <exact command/input/env; failure rate if flaky; output or stack trace>
Root cause:   <the true underlying cause — the mechanism, at a specific location>
Contributing: <factors that allowed it: missing guard, gap in the oracle, config, …>
Recommended fix: <approach> (owner: implementer | test-engineer | devops | security)
Prevention:   <the specific test or check that would catch a recurrence> (owner: test-engineer)
```

Rules:

- **Root cause is distinct from the symptom.** If your "root cause" restates the
  symptom, you have not diagnosed it yet.
- **Evidence, not speculation.** Cite the failing command/output, the stack trace,
  or the introducing commit (`git bisect` result). Point at `file:line`.
- **Name an owner** for the fix and for the prevention test. A root cause that is a
  High+ security vulnerability escalates to `security`, not just a note.
- **You recommend; you don't apply.** No diffs in the report — the `implementer`
  owns the change.

## Worked example

```text
Issue:        POST /checkout returns 500 for ~8% of authenticated requests since Tuesday.
Reproduction: `curl -X POST /checkout` with a valid session under concurrency ≥ 4
              reproduces ~1-in-12; serial requests never fail. Stack trace:
              NullPointerException at CartService.total():142. Failure began at
              commit a1b3c9f (git bisect).
Root cause:   a1b3c9f moved cart loading off the request thread into a shared
              cache without synchronizing writes; concurrent checkouts read a
              half-populated Cart whose `items` is still null at total():142.
Contributing: total() has no null guard; the oracle has no concurrency test, so the
              race passed review (an intent-vs-letter gap that code-review could not
              see without a multi-threaded case).
Recommended fix: synchronize cache population (or load per-request); add the null
              guard as defense in depth. (owner: implementer)
Prevention:   a concurrent-checkout regression test that drives ≥4 parallel requests
              and asserts no 500s. (owner: test-engineer)
```

Note how the prevention test feeds back into the `test-engineer`'s oracle — the
same oracle that `code-review` later checks was not weakened.
