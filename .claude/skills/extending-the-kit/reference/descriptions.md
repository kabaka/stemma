# Reference: Writing Descriptions That Trigger

Depth behind the `extending-the-kit` playbook. The `description` is the single
highest-leverage field in a skill or agent you draft for your repo — the *only*
content in context before the artifact activates, so it is what the model matches a
request against to decide whether to fire or delegate. A perfect body behind a vague
description is dead weight — it never runs.

## Contents

- [The non-negotiables](#the-non-negotiables)
- [Be a little pushy](#be-a-little-pushy)
- [Skill vs agent — same craft, different verb](#skill-vs-agent--same-craft-different-verb)
- [Don't summarize the workflow](#dont-summarize-the-workflow)
- [Overfitting and keyword-stuffing](#overfitting-and-keyword-stuffing)
- [Budgets and visibility](#budgets-and-visibility)
- [Test, don't guess](#test-dont-guess)
- [Worked before/after](#worked-beforeafter)

## The non-negotiables

- **Third person.** "Reviews migrations for our schema…" — never "I review…" or
  "you can use this to…". First/second person breaks the routing convention.
- **Front-load the trigger.** Put the most distinctive trigger in the **first ~100
  characters**. Listings and `/doctor` truncate; the opening must stand alone.
- **State what it does, then when:**

  ```text
  [what it does] + Use when [concrete scenarios] + [literal keywords a request contains]
  ```

- **Use literal keywords.** Include the actual words a real request would use for
  your repo — your filenames, your framework names, your domain nouns, and the
  verbs (`review`, `migrate`, `deploy`). The match is against the user's wording, so
  mirror it.

## Be a little pushy

A description should claim the **adjacent** scenarios, not just the exact one. List
the variations and near-neighbors a user might phrase, so the artifact fires on the
cluster of intents it can actually help with. "Use when writing a Terraform module,
**or** reviewing IaC, **or** planning infra changes" beats a single narrow trigger.
Err toward claiming a scenario you can handle over missing it — but push toward
*real* coverage, not noise (see overfitting/stuffing).

## Skill vs agent — same craft, different verb

- **Skill descriptions** answer *"when should this knowledge/procedure load?"* —
  scenario- and keyword-driven.
- **Agent descriptions** answer *"when should I delegate to this specialist?"* — the
  same shape, framed as a dispatch decision. For agents you want auto-delegated, add
  an imperative push: "**Use PROACTIVELY for…**" / "**MUST BE USED when…**".
  (Remember: auto-routing is unreliable, so strong descriptions *assist* explicit
  dispatch rather than replace it.)

## Don't summarize the workflow

The description states *when to fire*, not *how the work proceeds*. Recounting the
internal steps ("first it lints, then validates, then checks links") spends the
trigger budget on internals the router doesn't need and crowds out the scenarios and
keywords that actually drive matching. Keep the procedure in the body.

## Overfitting and keyword-stuffing

The two failure modes at the edges:

- **Overfitting** — the description fires only on the exact wording you tested. Real
  users phrase things differently and the skill silently misses. Fix: generalize to
  the intent; include synonyms and adjacent scenarios.
- **Keyword-stuffing** — cramming unrelated terms to "catch everything". The skill
  fires on prompts it can't help with, eroding trust and crowding real matches. Fix:
  include only keywords for scenarios the skill genuinely serves.

The test that separates them: would a *human reading only the description* expect
this artifact to be the right pick for that prompt? If not, the keyword doesn't
belong.

## Budgets and visibility

- Skill `description`: ≤1024 chars. The skill **listing** truncates per entry;
  `/doctor` shows a truncated form. The first sentence must be self-sufficient.
- Every description sits in context permanently across the whole roster. A bloated,
  stuffed description is a tax on *every* session, not just the one where it fires.
  Tight and specific beats long and vague.

## Test, don't guess

Descriptions are probabilistic triggers; you cannot eyeball reliability. Write evals
**before** finalizing the description and iterate against them — baseline whether the
right artifact fires on varied realistic prompts (NOT prompts that name the
target), then tune. The eval-driven loop is in `reference/evals.md`. This file gives
you *what to write*; that one gives you *how to verify*.

## Worked before/after

| Bad | Why | Better |
| --- | --- | --- |
| "Helps with our database." | Vague; no trigger, no keywords. | "Conventions for our Postgres schema and migrations. Use when writing or reviewing a migration, adding a table/index, or changing the schema." |
| "Rust expert." | "What it is", not "when to delegate". | "Reviews Rust for our crate's safety and error-handling conventions. MUST BE USED when reviewing a diff touching `unsafe`, `Result` handling, or async." |
| "I help you write infra." | First person; vague. | "Authoring guidance for our Terraform modules. Use when writing or reviewing IaC, adding a module, or planning an infra change." |
| "rust safety async error tokio serde build test lint…" | Keyword soup; fires on noise. | Keep the verbs/nouns that map to real scenarios; drop the rest. |
