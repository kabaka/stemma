# Reference: Authoring Agents for Your Repo

Depth behind the `extending-the-kit` playbook for the rare case where a new
**agent** is genuinely warranted (a new *role* no current agent fills). Default to
a skill first — see the playbook's "Default to skills, not agents." Read this
before drafting an agent.

## Contents

- [What a subagent is](#what-a-subagent-is)
- [Frontmatter](#frontmatter)
- [Routing — the description does the work](#routing--the-description-does-the-work)
- [Body — job-description style](#body--job-description-style)
- [Tools — least privilege](#tools--least-privilege)
- [Model tiering](#model-tiering)
- [Context isolation](#context-isolation)
- [Precedence and plugin caveats](#precedence-and-plugin-caveats)
- [Anti-patterns](#anti-patterns)

## What a subagent is

A subagent is a Markdown file with YAML frontmatter under `.claude/agents/`. The
body becomes the agent's **system prompt**. Claude Code runs it in a **fresh,
isolated context window**: the subagent sees only its system prompt, the delegation
message passed to it, `CLAUDE.md`, and git status — *not* the parent conversation or
files the parent read. Whatever it needs, restate in the body or the dispatch.

Two jobs as author: make it route reliably (the `description` — see
`reference/descriptions.md`) and give it exactly the tools and instructions for one
responsibility, no more.

## Frontmatter

```yaml
---
name: <role>                   # identity from THIS field; keep == filename (no .md)
description: <routing signal — see below>
tools: Read, Grep, Glob, Bash  # ALWAYS list explicitly — omitting inherits ALL
model: inherit                 # default; sonnet/opus/haiku/fable/full-id
---
```

- **`name`** (required) is the agent's identity and the `@name` handle. Keep `name`
  == filename (minus `.md`).
- **`description`** (required) is the routing/dispatch signal — describe *when* to
  delegate, not what the agent is. Details below.
- **`tools`** (consequential). **Omitting it inherits ALL tools, including every
  MCP tool — an over-grant and a failure for a drafted agent.** Always list an
  explicit least-privilege allowlist. The shipped validator warns on omission;
  treat that warning as a must-fix.
- **`model`** defaults to `inherit`. Set a tier when the job warrants it (below).

Other real fields — `disallowedTools`, `permissionMode`, `maxTurns`, `skills`,
`mcpServers`, `hooks`, `memory`, `background`, `effort`, `isolation`, `color` —
exist; use one only when needed and verify its behavior. Do not invent fields.

## Routing — the description does the work

Auto-delegation is keyed off the description. Write it as a *when to delegate*
signal:

- "Reviews migrations for our Postgres schema before merge" routes far better than
  "database expert".
- Add an imperative push for agents that should auto-fire: "**Use PROACTIVELY
  for…**" / "**MUST BE USED when…**".

**Caveat — do not architect around silent auto-routing.** It is unreliable. The
dependable triggers are explicit: `@agent-name` in a prompt, or `--agent` on the
CLI. In this kit the Orchestrator dispatches by name. Write strong descriptions to
*assist* delegation, not replace explicit dispatch.

## Body — job-description style

The body is a system prompt. Keep it high-level and short; push multi-step
procedures into a `skills:` entry (which preloads the full skill at startup) rather
than inlining them. A good reviewer body is ~80 words.

```markdown
# <Title>

<1–2 sentence identity: who this agent is and its single responsibility.>

## Identity
- Scope; what it does and explicitly does NOT do ("reviews only; never edits").

## <Domain section(s)>
- What to focus on, standards it enforces, the order to work in.

## Output format
- The exact shape of what it returns.

## Collaboration
- How its output feeds other agents; that it returns summaries + file paths.
```

Principles:

- **Single responsibility.** One agent, one job. Sprawling agents route ambiguously
  and overlap the existing roster — exactly what the playbook's overlap-refusal
  rule forbids.
- **Restate needed context.** The agent has no memory of the conversation. Put
  always-true constraints in the body; task-specific ones in the dispatch.
- **High-level body, procedure in a skill.** A long step-by-step body is a smell —
  move it to a skill and reference it via `skills:`. The body says *what role*; the
  skill says *how*. (Any `skills:` entry must point at an existing directory.)

## Tools — least privilege

Grant the minimum. The default (omit `tools` → inherit everything including MCP) is
generous; narrow it.

- **Read-only reviewers** get `Read, Grep, Glob` — and `Bash` only for read-only
  diagnostics like `git diff`. **Never give a reviewer `Write` or `Edit`** — a
  reviewer that can edit will edit instead of reporting.
- For an "inherit minus a few" shape, use **`disallowedTools`** (denylist) rather
  than re-listing the whole allowlist.
- `permissionMode: bypassPermissions` only in throwaway, isolated environments —
  never as a default convenience.
- For parallel **mutating** agents, set `isolation: worktree`.

Some tools are **never available to subagents**: `AskUserQuestion`,
`EnterPlanMode` / `ExitPlanMode` (unless `permissionMode: plan`), and
`ScheduleWakeup`. Don't list them; don't design an agent that must ask the user
mid-run — return a question to the parent instead.

## Model tiering

Default is `inherit`. Pick deliberately:

| Tier | Use for |
| --- | --- |
| **Haiku** | High-volume search / extraction / mechanical fan-out. |
| **Sonnet** | Default for code review, refactor, test authoring. |
| **Opus** | Subtle reasoning — security analysis, architecture, tricky correctness. |
| **Fable** | Longest-horizon autonomous work. |

Downshift mechanical fan-out workers to a cheaper tier; upshift only where reasoning
depth pays off. Verify the current tier names against Claude Code docs before
hardcoding a specific model id.

## Context isolation

- Each subagent gets a fresh window; its result returns to the parent. Subagents are
  best used as **context-collectors**: heavy reading/searching in their own window,
  **summarized aggressively** back to the parent. Raw dumps defeat the purpose.
- Nesting is allowed (subagents can spawn subagents in current Claude Code), but it
  is for *context management*, not parallelism. In this kit the Orchestrator stays
  the integrator.

## Precedence and plugin caveats

When the same agent name is defined in multiple places, resolution order is:
**managed > `--agents` flag > project `.claude/agents/` > user `~/.claude/agents/`
> plugin agents.** Note: **plugin-provided subagents IGNORE `hooks`, `mcpServers`,
and `permissionMode`** — don't rely on those fields in an agent shipped in a plugin.

Registering a promoted agent: if the repo installs the kit as a plugin, add the
agent's path to the `agents` list in `.claude-plugin/plugin.json`. A promoted agent
needs a session restart (or `/agents`) to be discovered.

## Anti-patterns

- Omitting `tools` on a drafted agent (silently over-grants all tools + MCP).
- Giving a read-only reviewer `Write`/`Edit`.
- Vague "what it is" descriptions instead of "when to delegate".
- Designing around silent auto-delegation instead of explicit dispatch.
- A new agent that overlaps an existing role (should have been a skill, or nothing).
- Long procedural bodies that belong in a skill.
- Assuming inherited context the agent cannot see.
