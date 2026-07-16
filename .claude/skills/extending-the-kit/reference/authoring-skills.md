# Reference: Authoring Skills for Your Repo

Depth behind the `extending-the-kit` playbook for drafting a `SKILL.md` that
teaches the AI-DLC kit your repo's expertise. Read this before authoring a skill.

## Contents

- [What a skill is](#what-a-skill-is)
- [Frontmatter](#frontmatter)
- [Progressive disclosure — the core model](#progressive-disclosure--the-core-model)
- [Body structure](#body-structure)
- [Match degrees of freedom to task fragility](#match-degrees-of-freedom-to-task-fragility)
- [Scripts](#scripts)
- [Tools and MCP](#tools-and-mcp)
- [Lifecycle gotchas](#lifecycle-gotchas)
- [Anti-patterns](#anti-patterns)

## What a skill is

A skill is a directory holding a `SKILL.md` plus optional bundled `reference/`,
`scripts/`, and `assets/`. Claude Code surfaces the skill's name and description in
every session and loads the rest only when the skill triggers. Your job as author:
make it fire at the right time (the `description` does this — see
`reference/descriptions.md`) and, once fired, teach the model exactly what it needs
for your repo and nothing more.

Assume the reader is a capable model. A 50-token snippet beats a 150-token
explanation. Do not explain what the model already knows — encode the
**repo-specific**, the fragile, and the easily-forgotten: your conventions, your
build quirks, the gotchas in your stack.

## Frontmatter

Only two fields are needed in almost every case:

```yaml
---
name: <domain>               # kebab-case, ≤64 chars, == the skill DIRECTORY name
description: <see below>      # ≤1024 chars, third person, front-loaded trigger
---
```

- **`name`** must be lowercase letters, digits, and hyphens; ≤64 chars; must NOT
  contain "claude" or "anthropic" (reserved). The **directory name** sets the
  `/command` and the activation key; keep `name` == directory name.
- **`description`** is the single biggest lever for whether the skill fires. Write
  it third person, front-load the trigger in the first ~100 chars, then "Use when
  …" with concrete scenarios and the literal keywords a real request would contain.
  Full craft in `reference/descriptions.md`.

Add an optional field ONLY when the skill genuinely needs it. All listed below are
real Claude Code fields; do not invent others. `license` / `version` belong in the
**plugin manifest**, not in `SKILL.md`.

| Field | Use it when |
| --- | --- |
| `allowed-tools` | Pre-approve specific tools so the skill runs without prompts (e.g. `Bash(shellcheck *)`). Pre-approves; does NOT restrict. |
| `disable-model-invocation: true` | Side-effecting / user-only workflows that must never auto-fire; reachable only via explicit `/command`. |
| `user-invocable: false` | Auto-only skills that should not appear as a slash command. |
| `model` / `effort` | Pin a model or effort for this skill's work. |
| `paths` | Glob-gate auto-activation to matching files only. |
| `context: fork` + `agent` | Run the skill in a forked context / hand off to a named agent. |

## Progressive disclosure — the core model

Skills load context in three levels. Design every skill around this:

1. **Metadata** (`name` + description). Always in context, for *every* installed
   skill, every session — a permanent token cost across the whole roster. Keep it
   tight.
2. **`SKILL.md` body.** Loaded when the skill triggers. Target **under ~400–500
   lines.** This is the playbook.
3. **Bundled files** (`reference/`, `scripts/`, `assets/`). Loaded on demand, only
   when the body points to them. Effectively unbounded — depth goes here.

Rules that fall out of this model:

- Keep the body lean; push field-by-field references, long examples, and
  anti-pattern catalogs into `reference/<topic>.md`.
- Link references **one level deep** from `SKILL.md`. Claude only partially reads
  nested references (a ref that links to another ref), so flatten instead of
  nesting.
- Put a short **table of contents at the top of any reference file over ~100
  lines** so the model can jump to the relevant section.
- Reference bundled files by relative path and say what to do with each: *read*
  `reference/foo.md` for knowledge, *run* `scripts/bar.sh` for an action.

## Body structure

Open with 1–3 sentences: what the skill is for and when to use it. Then either:

- **Workflow skill** — numbered steps or a copy-into-notes checklist for a
  multi-step process the model should track.
- **Knowledge skill** — structured reference: tables, field lists, decision rules
  (e.g. your repo's API conventions, error-handling patterns).

Write imperatively in the second person for instructions. Use **one term per
concept** and never alias it. Give **one recommended default** approach with an
escape hatch, not a menu of equally-weighted options.

## Match degrees of freedom to task fragility

The central style decision. The more fragile or destructive the operation, the
less freedom you give the model:

| Task character | What to write |
| --- | --- |
| Open-ended, creative, many valid answers | Prose guidance and principles. Let the model reason. |
| A reliable procedure with judgement at each step | A numbered checklist with rationale per step. |
| Fragile, deterministic, or destructive (migrations, releases, parsing) | An exact script the model **runs**, not prose it reinterprets. |

Prose invites improvisation; a script guarantees the same bytes every time. A skill
that hand-waves a destructive step in prose is a defect.

## Scripts

Bundle a script when you need determinism, token savings (the model runs it instead
of re-deriving logic), or repeated exact behavior.

- Say explicitly whether to **run** or **read** each script — opposite costs:
  running keeps logic out of context, reading pulls it in.
- Reference scripts by a path relative to the skill directory so it resolves
  wherever the skill is installed. Never hardcode an absolute repo path.
- Scripts must **handle errors and fail loudly** — exit non-zero with a clear
  message. The model trusts a silent success.
- **Document every magic number / "voodoo constant."** A bare `sleep 7` with no
  comment is a defect; state why the value is what it is.
- Only reference scripts you actually create and that actually work. Run
  `shellcheck` and a dry run.

## Tools and MCP

- Recommend **one default tool** per job, not a menu. "Use `rg` to search" beats
  "you can use grep, ag, or rg."
- Refer to MCP tools by their **fully-qualified name** (`Server:tool`, e.g.
  `Linear:create_issue`). A bare tool name is ambiguous across servers.

## Lifecycle gotchas

These shape what you put in a body, because the body is *sticky*:

- An invoked `SKILL.md` **stays in the conversation for the rest of the session** —
  a recurring token cost. Write the body as **standing instructions** that remain
  useful after the immediate task, not one-shot scratch notes.
- **After compaction**, Claude Code re-attaches recent skill invocations, keeping
  roughly the first ~5k tokens of each. A large skill is truncated. **Front-load the
  essentials** and re-invoke a big skill after compaction if you still need its
  tail.
- A **new top-level skill directory** is discovered on session restart; edits to an
  existing `SKILL.md`'s text are picked up mid-session.

## Anti-patterns

- Vague descriptions ("helps with our code") — the skill never fires.
- Summarizing the whole workflow in the description instead of stating triggers.
- First/second-person descriptions ("I help you…", "you can use this to…").
- Body over ~500 lines, or deeply nested references the model never reaches.
- A menu of tool options instead of one default.
- Undocumented "voodoo constants"; scripts that swallow errors.
- Reserved words ("claude"/"anthropic") or a `name` that mismatches the directory.
- Overfitting the description to your test prompts so it fires only on exact
  wording. Test with varied real prompts (`reference/evals.md`).
