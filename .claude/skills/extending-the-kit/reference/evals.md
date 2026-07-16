# Reference: Evals for Kit Artifacts

Depth behind the `extending-the-kit` playbook. Skills and agents are
**probabilistic**: whether they fire and what they produce varies. You cannot tell
by reading whether a description triggers reliably or a body behaves. This is the
eval-driven method for the artifacts you draft for your repo, plus the record shape
the shipped validator lints.

## Contents

- [Evals before docs](#evals-before-docs)
- [Two things to test — keep them separate](#two-things-to-test--keep-them-separate)
- [Author in one session, test in another](#author-in-one-session-test-in-another)
- [The eval-record shape](#the-eval-record-shape)
- [The coverage requirement](#the-coverage-requirement)
- [What the validator does and does NOT prove](#what-the-validator-does-and-does-not-prove)
- [Probabilistic by design](#probabilistic-by-design)
- [Anti-patterns](#anti-patterns)

## Evals before docs

Write the evals **before** the artifact body. This forces you to define success
concretely and prevents writing to a vague target. The loop:

```text
1. Write the evals: realistic prompts + expected behavior. The validator's enforced
   floor is ≥1 positive and ≥1 near-miss per target; aim for several (~3+) — more
   varied scenarios catch more triggering gaps.
2. Baseline WITHOUT the artifact — see what the model does unaided.
3. Write the MINIMAL instructions that close the gap.
4. Run the evals; compare to baseline and expected.
5. Iterate: fix the description (triggering) or body (behavior); re-run.
```

The baseline matters: if the model already does the right thing for your repo
unaided, the artifact may be unnecessary or smaller. Write minimal instructions —
only enough to close the observed gap.

## Two things to test — keep them separate

An artifact can fail two independent ways. Test each:

### (a) Triggering — does the right artifact fire?

Does it activate on varied **realistic** prompts — the way a real user would phrase
the request — and *not* fire on adjacent prompts it shouldn't handle?

- **Never test with a prompt that names the artifact** ("use the rust-conventions
  skill"). That proves nothing; real users don't phrase requests that way, and the
  shipped validator rejects it as a fake.
- Test a spread: canonical phrasing, paraphrases, adjacent-but-in-scope (should
  fire), and adjacent-but-out-of-scope (should NOT fire — this catches
  keyword-stuffing and overfitting).
- A triggering failure is almost always a `description` problem — fix it there (see
  `reference/descriptions.md`), not in the body.

### (b) Behavior — does it produce the right output?

Once fired, does it do the right thing — correct, complete, faithful to your repo's
conventions? A behavior failure is a *body* problem: the procedure is unclear,
missing a step, or gives the wrong degrees of freedom (see
`reference/authoring-skills.md`).

Diagnosing which layer failed tells you which file to edit. Don't rewrite the body
to fix a triggering miss, or the description to fix a wrong output.

## Author in one session, test in another

Author and grader should be **separate sessions**. One session writes the artifact;
a **fresh session with no memory of the authoring** runs each eval prompt and reports
what happened. This removes the author's bias — the author "knows" what the artifact
means and unconsciously triggers it. The fresh-context run is the honest signal.

## The eval-record shape

Capture each eval as a structured JSONL record (one JSON object per line) so the
suite is repeatable **and the shipped validator can lint it**. Required fields:

```json
{"id": "rust-conv-pos-1", "target": "rust-conventions", "kind": "positive", "prompt": "I'm adding a new migration to the orders table — anything I should follow here?", "expectation": "Activates the rust-conventions skill; applies our migration conventions."}
```

| Field | Meaning |
| --- | --- |
| `id` | Unique identifier for the record (no duplicates in a file). |
| `target` | The skill/agent name the eval is about. |
| `kind` | `positive`, `near-miss-negative`, or `behavior`. |
| `prompt` | The realistic prompt to run. For triggering kinds it must **NOT name the target**. Vary wording across the suite. |
| `expectation` | The observable success criteria: did it trigger, and did the output match. |

All five fields are required and must be non-empty strings, or the validator FAILs.

## The coverage requirement

Every **triggering target** (a new skill or agent) needs at least:

- **≥1 `positive`** — a prompt that should fire it, and
- **≥1 `near-miss-negative`** — an adjacent prompt that should NOT fire it.

The validator enforces both. The near-miss is what proves the description isn't
overfitted or keyword-stuffed — without it, you only know the artifact fires, not
that it stays quiet when it should.

## What the validator does and does NOT prove

Run it: `node .claude/skills/extending-the-kit/scripts/validate-kit-artifact.mjs
ai-dlc-proposed/`.

It checks, deterministically: eval records are well-formed, ids are unique, a
triggering prompt does not name its target, and every triggering target has its
positive + near-miss pair. It also checks artifact frontmatter and tool hygiene.

It **does NOT and cannot run the prompts** or judge whether an artifact actually
fires. **No eval-runner harness ships with the kit.** Triggering verification is
**manual**, in a fresh session, per the method above. A validator PASS means the
suite is honest and structurally sound — "worth testing", not "verified".

## Probabilistic by design

Evals raise the *probability* an artifact fires and behaves; they do not make it
certain. **For behavior that MUST run every time** (a mandatory check, a required
pre-commit step), do not rely on a skill triggering — use a **hook**, which the
harness executes deterministically regardless of model judgement. Reach for a skill
when probabilistic activation is acceptable; reach for a hook when it is not.

## Anti-patterns

- Writing the artifact first and bolting evals on after (you write to a vague
  target).
- Testing with a prompt that names the target instead of a realistic prompt.
- Only positive cases — never checking the artifact *stays quiet* on out-of-scope
  prompts (misses keyword-stuffing/overfitting).
- Author grades their own artifact in the same session (bias).
- Conflating a triggering failure with a behavior failure and editing the wrong
  file.
- Using a probabilistic skill where the requirement is "must always run" — that
  needs a hook.
- Evals that trivially pass instead of genuinely exercising triggering and behavior.
