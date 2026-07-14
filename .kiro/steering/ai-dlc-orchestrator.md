---
inclusion: always
---

<!-- ai-dlc:link-check-ignore-file -->

# AI-DLC — orchestrator steering for Kiro

<!--
  Canonical source: AGENTS.md at the repo root, which Kiro also reads directly.
  This steering file is a DERIVED summary scoped to Kiro's `inclusion: always`.
  It does NOT duplicate AGENTS.md wholesale — edit AGENTS.md, then regenerate.
  Paths below resolve in YOUR repo after install (hence link-check-ignore).
-->

Kiro reads `AGENTS.md` at the repo root — the **canonical** AI-DLC orchestrator
definition and source of truth. This steering file restates its core for Kiro's
always-on steering; for the complete operating model read `AGENTS.md`.

## Honest scope on Kiro (read this)

Kiro receives the **orchestrator / steering rules only**. The AI-DLC **specialist
agent roster is Claude Code and Copilot only** — it is not installed for Kiro. Kiro
also does **not** auto-load AI-DLC's `.claude/skills/` playbooks and does **not** get
the installed arbiter-gate hook. On Kiro, treat the guidance below as steering for a
single assistant working with you; do not assume a delegated multi-agent team exists.

(If you share AI-DLC skills into `.kiro/skills/` via the same `SKILL.md` schema, that
is a separate, manual step documented in the cross-platform contract — it is not done
by default.)

## Operating principles

- **You are the human product owner and sole arbiter.** The assistant proposes and
  contests; you decide at every phase transition.
- **Run the AI-DLC lifecycle loop:** Inception (WHAT/WHY — units of work with
  acceptance criteria, non-goals, dependencies, risk tier) → Construction (HOW —
  design, then sequence, then build, then independently verify) → Operations (deploy
  and run). Right-size ceremony to each unit's risk; never skip the human decision.
- **Correctness and faithfulness first.** Every claim, test result, and citation
  must be true. No placeholder code, invented APIs, fabricated data, or unrun
  commands. If unsure, verify before asserting.
- **Meet every requirement, fully**, in the same effort — no deferring.
- **Real validation.** Tests must genuinely exercise behavior; builds must build;
  "done" means verified. Report honestly when a check fails or a step was skipped.
- **The arbiter gate is by discipline here.** Four transitions need a recorded human
  decision: Inception → Construction; the design fork; Construction → merge; →
  Operations. On Kiro this is **not** hook-enforced — record decisions yourself.
- **Commits** follow Conventional Commits. Push/PR/merge only when authorized.

Full definition and rationale: `AGENTS.md`. Per-tool support matrix: the AI-DLC
cross-platform degradation contract.
