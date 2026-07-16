# Gate-2 producer flow and the visual-QA tool catalog

Two parts: **Part A** is how the binding is produced and confirmed; **Part B** is
the catalog of tools that consume it and the discipline they run under.

## Contents

- [Part A — the producer flow](#part-a--the-producer-flow)
- [Part B — the visual-QA tool catalog](#part-b--the-visual-qa-tool-catalog)
  - [The tool catalog](#the-tool-catalog)
  - [Fail-closed app-exec discipline](#fail-closed-app-exec-discipline)
  - [Residual-risk note](#residual-risk-note)

## Part A — the producer flow

For a **`ui_bearing`** unit, the binding is produced at Construction's existing
**design fork (Gate 2)** — no new gate, agent, ceremony, record-type, or
artifact-type is introduced.

1. **Detect.** The `architect` auto-detects the stack from lockfiles/manifests using
   `reference/detection-heuristics.md`.
2. **Propose.** The `architect` writes a **PROPOSED** `.ai-dlc/stack-binding.json`
   and includes it in the **architecture handoff artifact** — the same handoff that
   carries the `design-system` and `ux-design` contracts for `ui_bearing` units
   (see `architecture-design` SKILL.md step 2 and its handoff table). The binding
   **rides inside** that handoff; it is not a separate artifact-type.
3. **Contest.** During Solo Mob Construction the challenge agents may contest the
   proposed binding (e.g. `security` flags an out-of-allowlist top-level `command`,
   a `planner` flags a wrong surface). A **detected-but-unconfirmed** binding is a
   **proposal**, nothing more.
4. **Confirm.** The **human arbiter** confirms the binding **inside the existing
   Gate-2 Decision Record** (`chosen_option: approve`). Approving the architecture
   handoff approves the binding that rides in it. There is **no separate binding
   gate, no new Decision-Record type, and no new artifact-type.**

Until the arbiter approves Gate 2, the binding is unconfirmed. The visual-QA tools
treat a freshly written or edited binding as needing human confirmation before any
app/browser run (see Part B fail-closed discipline) — confirmation at Gate 2 is what
authorizes a later run, and a *changed* binding must be re-confirmed.

For non-`ui_bearing` units, the `architect` produces **no binding** (or an
`absent: true` / `surface: none` one); downstream tools skip clean.

## Part B — the visual-QA tool catalog

The tools (`.ai-dlc/scripts/visual-qa/`) consume the confirmed binding. They are
deterministic **Gate-2/Gate-3 evidence** — the tools produce evidence; the human
arbiter decides. Described at **capability level** (stack-neutral), not by brand.
This catalog promises **only what exists**: **seven** shipped tools — three
exec-free deterministic checks plus four browser tools that route through the
fail-closed app-exec harness.

### The tool catalog

**Three exec-free deterministic checks** consume the binding directly. None of
them executes a process, a shell, or a browser:

1. **`contrast-check.mjs`** — verifies each `token_pairs` `[fg, bg]` pair meets the
   WCAG contrast threshold, reading the bound `token_source` (DTCG tokens). *(The
   Slice-1 **off-token-lint** — `.ai-dlc/scripts/off-token-lint.mjs`, which flags
   colors/values not sourced from `token_source` — is a sibling exec-free check you
   may also reach for; the contrast capability itself is `contrast-check`.)*
2. **`patch-coverage.mjs`** — reports test coverage of **changed lines only**,
   computed as the intersection of a caller-provided coverage artifact and a
   caller-provided unified diff. It runs no tests and shells no `git`.
3. **`changelog-check.mjs`** — verifies a Keep-a-Changelog `Unreleased` section
   reflects a caller-provided commit list. It shells no `git`.

**Four browser tools** audit a **rendered** UI and therefore route through the
**fail-closed app-exec harness** (see below) rather than executing directly. Each
**SKIPs honestly** when the browser or a needed dependency is absent, or the run is
unconfirmed:

1. **`axe-audit.mjs`** — WCAG accessibility audit (axe-core) on each `audit_paths`
   route.
2. **`responsive-check.mjs`** — responsive-layout / horizontal-overflow check across
   the declared `breakpoints`.
3. **`pixel-diff.mjs`** — screenshot pixel-diff against repo-local committed
   baselines (`baseline_dir`).
4. **`reachability-runner.mjs`** — drives each declared `route` and asserts it
   renders (end-to-end reachability evidence).

The harness is the shipped, tested **gate** for that browser execution; the binding
tells it which build/export command and which stack to target, stack-neutrally. It
runs **build → serve-static → audit** (detailed below), never a long-lived consumer
dev-server daemon.

**Every tool SKIPs cleanly when `absent: true` or `surface: none`.** On an absent
or non-visual binding each tool emits a clean skip — no findings, no failure, no
fabricated stack — never a hard error.

### Fail-closed app-exec discipline

The three exec-free checks (off-token-lint, `contrast-check`, `patch-coverage`,
`changelog-check`) run freely. **The four browser tools that run a build and a
browser are fail-closed.** The execution model is **build → serve-static → audit**:
the harness runs the consumer's **build/export command** (argv, `shell: false`,
fail-closed) which emits static files into a containment-checked, repo-local
`static_dir` and **exits**; then the **kit-owned static server** serves that dir on
`127.0.0.1:<ephemeral KIT-chosen port>` and the managed chromium audits it. The
**kit chooses the port/origin** — there is no binding-supplied url, port, or
ready-log.

- **Launcher allowlist enforced** — the top-level `command` (a **string**) must be
  an allowlisted launcher (`node`/`npm`/`pnpm`/`yarn`/`npx`) **or** a repo-local
  `node_modules/.bin/*` path; anything else (a bare name off the allowlist, an
  absolute path, `/bin/sh`, `../../usr/bin/env`) aborts. Top-level `args` is a
  validated array of plain strings (see `schema.md`).
- **Env allowlist enforced** — only known-safe top-level `env` keys pass; a
  **non-allowlisted key ABORTS** the whole launch (never silently dropped), and the
  hard-blocked loader/proxy vars (`NODE_OPTIONS`, `LD_PRELOAD`, `DYLD_*`,
  `PLAYWRIGHT_*`, `*_PROXY`, …) are **refused**.
- **Containment-checked output** — `static_dir`, `output_dir`, and `baseline_dir`
  must resolve inside the repo/output root; traversal or escape aborts.
- **Loopback-only auditing** — the **kit** serves the built `static_dir` on a
  kit-chosen ephemeral `127.0.0.1` port and audits only there; `audit_paths` /
  `routes` are **path-only** and composed onto that kit-chosen origin. The binding
  never supplies the origin/port, so it can never point auditing off-origin.
- **Human-confirmed per session, never auto-run from a fresh/changed binding** — a
  newly pulled or edited `stack-binding.json` must be **human-confirmed** before any
  build/browser run; the tools never auto-execute on the strength of the binding
  alone.
- **Any validation failure ABORTS** — it never degrades to an unsafe default
  (no "launcher not allowed, fall back to bash"; no "path escaped, write to /tmp";
  no "not loopback, audit it anyway"). Fail closed, every time.

### Residual-risk note

Running the four browser tools **runs the consumer's own code** — the build/export
command, whatever the top-level `command` starts. The allowlists, containment
checks, and loopback-only auditing constrain *what the binding can redirect*, but
they are **not a sandbox** and do not contain the app's or build's own behavior.
This is an honest **residual-risk disclosure, not a guarantee of isolation**: only
run the visual-QA tools on a repository you already trust to build and run
locally — one you would already `npm install` and build on your own machine.
