<!-- ai-dlc:link-check-ignore-file -->
<!--
  AI-DLC — GitHub Copilot repository instructions.
  Installed by the AI-DLC installer at `.github/copilot-instructions.md`.

  Canonical source: AGENTS.md at your repo root. DO NOT duplicate orchestrator
  guidance here — edit AGENTS.md and let Copilot read it. This file exists only
  to (a) point Copilot at the canonical doc and (b) state honestly what Copilot
  does and does not support, since Copilot has no skill or hook primitive.

  Paths below (AGENTS.md, .claude/agents/) resolve in YOUR repo after install,
  not in the AI-DLC source repo — hence the link-check-ignore marker above.
-->

# AI-DLC — GitHub Copilot

This repository uses **AI-DLC**, a Claude-Code-first development-lifecycle kit. The
**canonical orchestrator definition is [`AGENTS.md`](../AGENTS.md)** at the repo
root, which GitHub Copilot reads directly (alongside this file). Read it: it defines
the Orchestrator role, the core principles, the delivery rules, the AI-DLC lifecycle
loop (Inception → Construction → Operations), and the human-as-arbiter gate.

**Do not duplicate that guidance here.** When the operating model changes, it changes
in `AGENTS.md` — this file only records what Copilot specifically supports.

## What Copilot gets

- **The orchestrator definition** — Copilot reads `AGENTS.md` natively, so you get
  the full Orchestrator role, principles, delivery rules, and lifecycle loop.
- **The specialist agent roster** — Copilot reads
  [`.claude/agents/`](../.claude/agents/) directly (the Claude sub-agents format), so
  the AI-DLC lifecycle agents (`requirements-analyst`, `architect`, `planner`,
  `implementer`, `test-engineer`, `code-reviewer`, `debugger`, `devops`, `security`,
  `documentation`, `researcher`, `research-synthesizer`) are available to Copilot
  with no duplication.

## What Copilot does NOT get (no overclaiming)

Copilot is **not** at parity with Claude Code. Specifically:

- **No automatic skill loading.** AI-DLC's procedural playbooks live in
  `.claude/skills/` and are loaded on demand by Claude Code. Copilot has **no skill
  primitive** — these skills do not auto-activate. Treat the agent definitions and
  `AGENTS.md` as your guidance; consult a skill's `SKILL.md` manually if you need its
  procedure.
- **No arbiter-gate hook.** Claude Code installs a real hook that **blocks**
  phase-transition actions until a human Decision Record exists. Copilot has no
  equivalent enforcement. The arbiter gate here is **instruction only** — honor it by
  discipline; it is not mechanically enforced on this platform.

## Working agreement

Follow `AGENTS.md`. You (the human) are the **product owner and sole arbiter**: you
decide at every phase transition. Because the gate hook does not run on Copilot,
record your phase-transition decisions deliberately rather than relying on
enforcement.

For the full, honest per-tool support matrix, see the AI-DLC cross-platform
degradation contract (`product/docs/cross-platform.md` in the AI-DLC kit).
