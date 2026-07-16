---
name: writing-docs
description: How to write clear human-facing documentation for your project — READMEs, usage guides, quickstarts, docstrings, inline code comments, and contributor docs. Use when asked to "write docs", "document this", "add a README" or a README section, "write usage instructions", "explain how to use this", "add a docstring", or when documentation is part of a unit of work. Covers audience-first writing, progressive disclosure for readers, concrete runnable examples, and linking instead of duplicating. Loaded on-demand by any lifecycle agent for inline docs, and preloaded by the documentation agent for doc sets.
---

# Writing Docs

This skill governs documentation written **for humans** — the people who install,
use, extend, or maintain your project. That includes a `README`, a usage or
install guide, a quickstart, a docstring, an inline comment, or a contributor
guide. It is distinct from instructions written for an AI agent (skill/agent
files): those compress for a model; docs orient a person who may be new to the
work.

Any lifecycle agent loads this skill when a unit of work produces incidental
documentation. The `documentation` agent preloads it for larger efforts. The line
between the two is the **escalation boundary** below — read it first so you know
whether to self-serve or hand off.

## Escalation boundary — self-serve vs. escalate to `documentation`

**Self-serve** the docs inline, using this skill, when they are **co-located with
your own deliverable** and small in scope:

- a docstring or function/class comment on code you just wrote;
- a single README **section** for a feature you built (one file, one place);
- a short usage note, a config example, an inline "how to run this" snippet;
- a CHANGELOG entry or a brief comment explaining a non-obvious choice.

**Escalate to the `documentation` agent** when any of these is true:

- the effort **spans multiple files** or assembles a documentation **set**
  (quickstart + usage + reference together);
- it needs **information architecture** — deciding what pages exist, how a reader
  navigates them, what goes where;
- **documentation is the primary deliverable** of the unit of work, not a
  byproduct of building something else;
- a major rewrite, a docs site, or a public-facing guide where consistency across
  many pages matters.

Rule of thumb: if you can write it in the same change as the code it describes and
it lives next to that code, self-serve. If it is its own project, escalate. When
unsure, escalate — a doc set written piecemeal by many agents drifts.

## Principles

1. **Audience-first.** Lead with what the reader is trying to *do*, not how the
   system is built inside. A user wants "install it and run it"; a contributor
   wants "set up, run the checks, open a PR"; a future maintainer wants "why is
   this here." Identify the audience, write to their goal, and cut everything that
   does not serve it.
2. **Progressive disclosure for readers.** Put the shortest path to value at the
   top — the quickstart, the one command that works. Push depth (full option
   reference, edge cases, internals, rationale) lower in the page or into a linked
   page. Never make a reader wade through background to run the first command.
3. **Concrete, runnable examples over abstraction.** Show the actual command, the
   actual path, the actual expected output. An example a reader can copy and run
   beats a paragraph describing it. Every example must be **real** — run the
   command, confirm the output; never invent a flag or paste a command you did not
   verify.
4. **Accurate to current behavior.** Document what the code does *now*. When you
   change behavior, update the docs in the same change. Stale docs mislead worse
   than missing docs.
5. **Link, don't duplicate.** Point to the one canonical source instead of copying
   it. Reference the config file, the API reference, the ADR, or the upstream doc
   rather than restating it — so there is a single place to update when it changes.

## Conventions

- Plain, direct, skimmable: descriptive headings, short paragraphs, tables and
  fenced code where they earn their space. No marketing fluff.
- Match the project's existing voice, spelling (US/UK English), and formatting.
  When the repo lints Markdown, the docs must pass that linter.
- State prerequisites and assumptions up front (language version, OS, accounts,
  env vars) so a reader does not discover them mid-procedure.
- Record user-facing changes where the project tracks them (e.g. a `CHANGELOG`);
  commit doc changes with a clear message — see `conventional-commits`.

## Structure cues by doc type

- **README** (the front door, not the manual): one-line *what it is* → quickstart
  (install + first successful use) → a short *why / when to use it* → links to
  deeper docs. Keep it short.
- **Quickstart**: the fastest path from zero to one working result. Prerequisites,
  then a numbered sequence of real commands, then what success looks like. No
  detours.
- **Usage guide**: task-oriented sections ("Install", "Configure", "Common
  tasks"), each a short procedure with a real example and expected output.
- **Reference**: exhaustive and lookup-oriented — every option/flag/field with its
  type, default, and effect. Completeness matters more than narrative here.
- **Docstring / inline comment**: state purpose, parameters, return, and the
  *why* of anything non-obvious — not a restatement of what the code plainly says.
- **Contributor doc**: setup → run the project's checks/tests → make a change →
  commit (`conventional-commits`) → open a PR.

## Docstrings and inline comments

These are the most common self-serve docs, so get them right:

- Document **why**, not the obvious **what**. `// increment i` is noise;
  `// retry budget: API rate-limits at 5/s, so cap at 4` earns its place.
- Follow the language's docstring convention (JSDoc, Python docstrings, Go doc
  comments, Rustdoc, etc.) so tooling can render it.
- Keep the docstring next to the code and update it when the signature changes —
  a docstring that lies about parameters is worse than none.

## Quality bar

A doc is done when a reader in its target audience can reach their goal without
asking a follow-up the doc should have answered; every command, path, and example
is real and verified; nothing duplicates a canonical source it could have linked;
and it passes the project's Markdown/lint checks. If the effort grew past the
escalation boundary while you worked, hand off to the `documentation` agent rather
than shipping a half-built doc set.
