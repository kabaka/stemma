# AI-DLC design-QA tools

Deterministic, safe design-QA tooling installed into your repository by
`npx ai-dlc init`. These tools help your UI stay **on-token** (visually
consistent) and let the kit gather **rendered-UI evidence** for the Construction
gates. They live under `.ai-dlc/scripts/` and run with plain Node — no global
install.

> Run every tool with `node .ai-dlc/scripts/...` from your repository root.
> Requires Node >= 18. The exec-free tools need no dependencies beyond the Node
> standard library.

## The exit-code contract — SKIPPED is **not** a PASS

Every tool shares one `0 / 1 / 2 / 3` contract. The critical rule: a caller (a CI
gate, a reviewer, a wrapper) **must** distinguish "the UI met the bar" from "we
could not gather the evidence."

| Exit | Name       | Meaning                                                                                   |
| ---- | ---------- | ----------------------------------------------------------------------------------------- |
| `0`  | `PASS`     | The tool actually evaluated **>= 1** input and it met the bar. **The only green.**        |
| `1`  | `FINDINGS` | The tool evaluated inputs and found problems (each listed).                                |
| `2`  | `ERROR`    | Bad invocation, or an unreadable/malformed binding, token, or artifact.                   |
| `3`  | `SKIPPED`  | **Evidence-incomplete — NOT a pass.** No inputs to evaluate, non-visual surface, or absent/unconfirmed binding. |

A clean `PASS` is emitted **only** when the tool had something to evaluate and it
met the bar — an empty input set SKIPs rather than reporting a hollow green.
**Treat exit `3` as evidence-incomplete, never as success.**

## Repo-local binding: `.ai-dlc/stack-binding.json`

The tools read an **optional** repo-local binding — the single source of truth
for how your repository is wired for design QA (which UI stack, which source
files, which token file, which routes, and the app build command). When the
binding is absent or declares a non-visual `surface` (`cli` / `none`), the tools
SKIP honestly (exit `3`). The binding is **untrusted input**: every path a tool
derives from it is resolved and **containment-checked inside `--repo`** — a `../`,
absolute, or symlink-escaping path is rejected with `ERROR (exit 2)` and nothing
outside the root is read.

## Exec-free tools (no RCE surface)

These read only files and caller-provided artifacts. They never execute a
process, a shell, or a browser, so they carry **no RCE surface** and run
identically on macOS, Linux, and Windows.

### `off-token-lint.mjs` — off-token linter

Statically scans your source for **hardcoded design values that should be design
tokens** — raw hex/`rgb()`/`hsl()` colors, raw `px`/`rem`/`em` spacing, and
hardcoded `font-family` names — and reports them as findings.

```sh
node .ai-dlc/scripts/off-token-lint.mjs [--repo <path>]
```

`PASS (0)` requires that it actually scanned **>= 1** source file and found
nothing off-token. No binding, a non-visual surface, or no scannable sources →
`SKIPPED (3)`.

### `visual-qa/contrast-check.mjs` — WCAG contrast on token pairs

Computes the WCAG 2.x contrast ratio for each `token_pairs` entry in the binding
and reports any pair below threshold (`4.5:1` normal, `3:1` large text).

```sh
node .ai-dlc/scripts/visual-qa/contrast-check.mjs [--repo <path>]
```

### `visual-qa/patch-coverage.mjs` — changed-line coverage

Reports the test coverage of **changed lines only**, as the intersection of a
**caller-provided** coverage artifact and a **caller-provided** unified diff. It
does not run tests and does not shell out to `git` — you produce both inputs.

```sh
node .ai-dlc/scripts/visual-qa/patch-coverage.mjs --repo <path> \
  --coverage <lcov|json> --diff <unified-diff-file> [--threshold 0..100]
```

### `visual-qa/changelog-check.mjs` — Unreleased-section freshness

Verifies that a Keep-a-Changelog `## [Unreleased]` section exists and carries
real entries, given a **caller-provided** commit list. It does not shell out to
`git` — you pass the commits.

```sh
node .ai-dlc/scripts/visual-qa/changelog-check.mjs --repo <path> \
  [--changelog <path>] [--commits a,b,c]
```

## App / browser execution: the fail-closed harness

Auditing a **rendered** UI — an accessibility audit, a responsive check, a pixel
diff, or a reachability sweep — means **running your app and a browser**, which is
genuinely a remote-code-execution surface. Every such launch routes through one
shipped, tested gate: `lib/app-exec-harness.mjs`. Four browser tools ship and
route through it — `axe-audit.mjs`, `responsive-check.mjs`, `pixel-diff.mjs`, and
`reachability-runner.mjs`.

### The execution model: build → serve static → audit loopback

The harness runs your binding's **build/export command** (the validated
`command` + `args` argv pair — never a split run-string) to completion. That
command emits **static files into a repo-local `static_dir`** (default
`.ai-dlc/visual-qa-build`, containment-checked). The kit then serves that
directory itself on **`127.0.0.1` at an ephemeral kit-chosen port**, and the
browser tools audit only that **loopback** origin. The navigation origin is the
kit's, never the binding's; off-origin requests are aborted.

### Fail-closed by default — confirmation is required per session

The harness **never launches on import** and is **default-deny**: with no current
confirmation it emits `SKIPPED (3)`, **never a pass**. A security refusal is
`ERROR (2)`, never a silent skip. Built-in defenses: no shell ever (`spawn` with
an argv array, `shell:false`); a fixed executable allowlist
(`node`/`npm`/`pnpm`/`yarn`/`npx` or a repo-contained `node_modules/.bin/*`); a
kit-controlled minimal child env that hard-blocks loader/process-hijack vars
(`NODE_OPTIONS`, `LD_PRELOAD`, `DYLD_*`, `PLAYWRIGHT_*`, …); a hard wall-clock
timeout with process-group tree-kill; cwd pinned to the repo root; and a refusal
to run as root.

**Confirmation is bound to the binding hash.** The confirmation token **is** the
SHA-256 over every execution-relevant field, re-hashed immediately before spawn.
A changed or **freshly-pulled** binding produces a different hash, invalidates the
confirmation, and aborts — the harness **never auto-runs on the strength of a
binding alone**. Confirm a launch two ways:

- **Interactive TTY** — confirm the launch at your terminal.
- **Operator token** — `--confirm-exec <hash>` or `AIDLC_VISUAL_QA_CONFIRM=<hash>`,
  where the value must equal the exec hash the harness computes for that exact
  binding. A stale token (from a since-changed binding) will not match.

### Orchestrate, don't bundle — install your own browser toolchain

The kit does not bundle a browser or a build toolchain; it orchestrates **your
own pinned toolchain** and resolves Playwright, axe, pixelmatch, and the like from
**your repo's** `node_modules`. Before any browser audit, install your pinned
toolchain and the browser binary:

```sh
npx playwright install chromium
```

A missing module or browser is an honest `SKIPPED (3)` with the remediation
echoed — never a false pass.

### The four browser tools

All take `--repo <path>` and `--confirm-exec <token>` (or
`AIDLC_VISUAL_QA_CONFIRM=<token>`), and read rendered routes from the binding as
**path-only** values against the kit-served loopback base.

```sh
node .ai-dlc/scripts/visual-qa/axe-audit.mjs            [--repo <path>] [--confirm-exec <token>]
node .ai-dlc/scripts/visual-qa/responsive-check.mjs     [--repo <path>] [--confirm-exec <token>]
node .ai-dlc/scripts/visual-qa/pixel-diff.mjs           [--repo <path>] [--confirm-exec <token>]
node .ai-dlc/scripts/visual-qa/reachability-runner.mjs  [--repo <path>] [--confirm-exec <token>]
```

- **`axe-audit.mjs`** — drives managed Chromium to each `audit_paths` route,
  injects axe-core (`@axe-core/playwright`), runs WCAG 2 A/AA (overridable via
  `axe_tags`); any violation is a finding.
- **`responsive-check.mjs`** — loads each route at each `breakpoints` viewport
  (default mobile/tablet/desktop) and detects horizontal overflow / off-viewport
  elements.
- **`pixel-diff.mjs`** — screenshots each route and diffs it against a
  **repo-local committed baseline PNG** (`baseline_dir`, default
  `.ai-dlc/visual-baselines`) via `pixelmatch` / `pngjs`; a diff above
  `pixel_tolerance` (default `0.01`) is a finding. Baselines are always
  repo-local, never URLs.
- **`reachability-runner.mjs`** — drives each declared `routes` entry (falling
  back to `audit_paths`, then `/`) and asserts each renders (2xx/3xx, non-empty
  `<body>`, no uncaught page error). End-to-end reachability evidence.

## Residual risk: an RCE surface, by design (T3)

The off-token linter and the exec-free checks carry **no** RCE surface. **The
harness-gated path is different, and we say so plainly.** Routing a launch through
the harness **runs your own application** plus whatever your `package.json`
scripts and config evaluate. The allowlists, the minimal env, the timeout, the
cwd pin, and the binding-bound confirmation constrain **what the binding can
redirect** — but a portable Node tool **cannot OS-sandbox** the app's own
behavior. This is an honest **residual-risk disclosure (a T3 risk), not a
guarantee of isolation**: only run harness-gated app/browser execution on a
repository you would already `npm install` and run on your own machine.
