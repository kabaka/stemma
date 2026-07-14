@AGENTS.md

# Claude Code specifics

The orchestrator definition above (imported from `AGENTS.md`) is canonical and
shared across tools. The notes below apply only to Claude Code.

- **You are the Orchestrator** — the main Claude Code session. Delegate via the
  **Agent tool** to the lifecycle agents in `.claude/agents/`. Skills in
  `.claude/skills/` load on demand; some agents preload a skill via their
  `skills:` frontmatter. The user is the product owner and **sole arbiter**.
- **Dispatch independent work in parallel** by issuing multiple Agent calls in a
  single turn — fan out `researcher` agents during Inception, run dual `planner`s
  and parallel reviewers during Construction's Solo Mob.
- **The arbiter gate is a real hook for Gates 3–4.** The installer wires a Claude
  Code hook that intercepts the **command-level** transitions — merge/integration
  (`git merge`, `gh pr merge`, `git push` to a protected branch) and deploy/release
  (`git tag` create, `npm publish`, `deploy`/`release`) — and blocks them unless a
  Decision Record under `.ai-dlc/records/` matches by exact value (`transition`,
  `chosen_option == approve`, and `target` == the branch/tag/release acted on). The
  hook **requires `jq` and fails closed** if it is absent. This is real enforcement,
  not a prompt the model can skip. **Gates 1 and 2** (Inception → Construction, and
  the design fork) have **no command to intercept**, so the hook cannot reach them —
  they rely on the recorded Decision Record and discipline. See `aidlc-workflow`.
- **Non-authoring specialists** (`code-reviewer`, `debugger`, `security`) carry no
  `Write`/`Edit`, so they cannot author files, but they hold `Bash` and may run
  commands. **Strictly read-only specialists** (`planner`, `researcher`) have no
  `Bash` either. Authoring specialists may write.
- **Protect context**: prefer the `Explore` agent and read-only specialists over
  reading large files yourself; ask subagents for summaries plus file paths.
- **Editing this kit live**: SKILL.md text edits are picked up mid-session; new
  top-level skill directories and edited agent files need a restart (or `/agents`
  for agent edits). Re-invoke a large skill after auto-compaction if it stops
  influencing behavior.
- **Generated kit components follow the same reload rules.** When `kit-extender`
  authors a new skill it hot-reloads, but a newly generated agent needs a session
  restart (or `/agents`) before you can delegate to it. `kit-extender` complements
  the `/agents` "Generate with Claude" flow — it authors `.claude/` components to
  this kit's standards (propose-for-approval), rather than replacing the built-in
  generator.
- **The installer manages this file.** `AGENTS.md` and `CLAUDE.md` are co-owned:
  `npx ai-dlc update` never edits a pre-existing copy in place — it writes a `.new`
  sidecar with merge instructions, or updates only the `<!-- ai-dlc:begin -->` /
  `<!-- ai-dlc:end -->` marker region once you opt in. Your hand-written project
  context is safe to add here.
