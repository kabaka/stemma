# Code-review rubric, severity, and output

Depth for the `code-review` skill: the full correctness checklist, the
intent-vs-letter red flags, the lightweight security checklist, the severity
rubric, the output shape, and worked verdict examples.

## Contents

- [Correctness & regression checklist](#correctness--regression-checklist)
- [Intent-vs-letter red flags](#intent-vs-letter-red-flags)
- [Lightweight security checklist](#lightweight-security-checklist)
- [Severity rubric (drives escalation)](#severity-rubric)
- [Output shape](#output-shape)
- [Worked verdict examples](#worked-verdict-examples)

## Correctness & regression checklist

Read the diff against the unit's `scope` and `acceptance_criteria`. Look for:

- **Logic** — wrong conditionals, inverted comparisons, mishandled edge cases,
  off-by-one and boundary errors, incorrect defaults.
- **Error handling** — swallowed exceptions, unchecked failure paths, errors that
  silently continue, missing validation of inputs/return values.
- **Regressions** — behavior callers depend on that this diff changes; a public
  signature/contract change without updated callers; a removed guard.
- **Concurrency & resources** — races, unguarded shared state, leaked handles/
  connections, unbounded growth.
- **Maintainability** — dead code, duplication, needless complexity, a simpler
  equivalent the change ignores. (Quality findings are usually Low/Medium.)

Each finding gets a severity (below) and a concrete location. Vague findings
("could be cleaner") are not actionable — point at the line and say what's wrong.

## Intent-vs-letter red flags

The check this skill owns — verifying the change satisfies the unit's real intent,
not just whatever tests happen to be green. Treat these as strong signals:

- **The oracle was edited in this diff.** Grading tests narrowed, deleted, skipped,
  `xfail`-ed, or assertions loosened so a failing case passes. The oracle is the
  `test-engineer`'s; the `implementer` may not touch it. → almost always `BLOCK`.
- **Hard-coded / special-cased answers.** Code returns the literal value a test
  expects rather than computing it; a branch exists only to satisfy one test input.
- **Coverage gap inside scope.** An obvious case within `scope` that no test
  exercises, where the code is wrong or unhandled. Raise it even though tests pass.
- **Scope drift.** The diff does something in `non_goals`, or solves a different
  problem than the unit describes.

A clean pass on all of these, plus a clean correctness and security pass, is what
`APPROVE` certifies.

## Lightweight security checklist

The standing in-line pass — load `security-review` for its quick checks and run
them over the diff. Quickly scan for: hard-coded secrets/credentials; unvalidated
or unsanitized untrusted input (injection, path traversal, deserialization);
missing authn/authz checks; weak or hand-rolled crypto; risky shell/subprocess or
network calls; dependency additions. Rate each finding (below). This is triage, not
a threat model — the dedicated `security` agent owns depth.

## Severity rubric

Severity drives the verdict, so apply it consistently:

| Severity | Meaning | Effect on verdict |
| --- | --- | --- |
| **Critical** | Exploitable now / data loss / auth bypass. | `ESCALATE_SECURITY` (High+ rule). |
| **High** | Likely exploitable or serious correctness break. | `ESCALATE_SECURITY` if security; else `REQUEST_CHANGES`. |
| **Medium** | Real defect, bounded impact. | `REQUEST_CHANGES`. |
| **Low** | Minor / hygiene / style. | `REQUEST_CHANGES` if blocking-worthy; else note for the author. |

Independently, **any** change touching a **sensitive surface** (auth, crypto,
secrets, untrusted input, runs-on-another-machine, MCP) is `ESCALATE_SECURITY`
regardless of whether you found a concrete issue — the surface itself warrants the
specialist.

## Output shape

```text
Verdict: <APPROVE | REQUEST_CHANGES | ESCALATE_SECURITY | BLOCK>
Unit: <id / title of the unit of work reviewed>
Summary: <1–2 sentences: does it satisfy intent + oracle; security lens result>

Findings (omit if APPROVE with none):
  - [severity] <file:line> — <what is wrong> → <recommended fix> (owner: implementer | test-engineer)

Intent check: <satisfies real intent | gap: …> | Oracle: <unedited | EDITED — see finding>
Security lens: <clean | finding(s) above | crosses escalation boundary because …>
```

Keep findings concrete (file:line + fix + owner). Name `test-engineer` as owner for
oracle/coverage gaps, `implementer` for code fixes.

## Worked verdict examples

- **APPROVE** — Diff implements the unit's scope, all acceptance criteria covered,
  oracle unedited, no obvious in-scope gap, security lens clean. One Low style note
  passed to the author, not blocking.
- **REQUEST_CHANGES** — Logic correct but an in-scope edge case (empty input) is
  unhandled and untested; plus a Medium: untrusted value logged without
  redaction on an ordinary surface (not a sensitive surface, finding is Medium).
- **ESCALATE_SECURITY** — Change adds a token-verification path (authentication —
  sensitive surface). Even with no concrete bug found, the surface crosses the
  boundary → hand to `security`. Also applies if any finding is rated High+.
- **BLOCK** — The diff deletes two assertions from the grading test to turn red
  green. The oracle was edited to fit the code; this is a fundamental integrity
  break → stop, escalate to the human arbiter.
