# Detection heuristics — lockfiles/manifests → binding fields

How the `architect` auto-detects a **proposed** binding from what is already in the
repo. Detection feeds a **proposal** only — the arbiter confirms it at Gate 2 (see
`gate2-producer-flow.md` Part A). **Nothing here is silently trusted**, and
detection is **deterministic**: the same repo state always yields the same proposal.

## Mapping table

| Evidence in repo | Sets |
| --- | --- |
| `package.json` deps include `react` | `ui_framework: react`, `surface: web` |
| `package.json` deps include `vue` | `ui_framework: vue`, `surface: web` |
| `package.json` deps include `svelte` | `ui_framework: svelte`, `surface: web` |
| `package.json` deps include `@angular/core` | `ui_framework: angular`, `surface: web` |
| `package.json` deps include `solid-js` | `ui_framework: solid`, `surface: web` |
| lockfile present (`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`) | **determinism anchor** — a pin/repro signal that the dep set is locked; raises confidence in the framework + build-command proposal |
| `*.tokens.json` file or a `tokens/` directory | `token_source` (the path) |
| framework source convention (e.g. `src/**/*.{tsx,jsx,vue,svelte}`) | `source_globs` |
| `pubspec.yaml` (Flutter) | `ui_framework: flutter`, `surface: mobile` |
| `Package.swift` or `*.xcodeproj` (Swift / iOS) | `ui_framework: swiftui`, `surface: mobile` |
| Jetpack Compose (`androidx.compose.*` in Gradle) | `ui_framework: compose`, `surface: mobile` |
| `ratatui` in `Cargo.toml` (Rust) | `ui_framework: ratatui`, `surface: tui` |
| `github.com/charmbracelet/bubbletea` in `go.mod` (Go) | `ui_framework: bubbletea`, `surface: tui` |
| **no UI evidence at all** | `absent: true`, `surface: none` |

### Build command, static_dir, and audit paths

The visual-QA model is **build → serve-static → audit** (see `schema.md`): a
**one-shot build/export** command that EXITS emits static files into `static_dir`,
which the kit serves on its own loopback origin. Detection therefore targets the
**build** script, NOT a long-lived dev server.

- Top-level `command` / `args` are detected from the **build/export** script
  (`scripts.build` in `package.json`), normalized to the launcher allowlist
  (`node`/`npm`/`pnpm`/`yarn`/`npx`; see `schema.md`). There is **no `run` wrapper**
  and **no dev-server/`scripts.dev`/`scripts.start` detection** — a long-lived dev
  server never exits, so the harness (which serves a static build) cannot use it.
- `static_dir` is the repo-local dir the build emits into (e.g. `dist/`, `build/`,
  `out/`); propose the framework's conventional output dir.
- `audit_paths` may be seeded from obvious route conventions, defaulting to `["/"]`.
- **ALWAYS surfaced for arbiter confirmation, NEVER silently trusted.** A detected
  `command`, `static_dir`, or `audit_paths` is a proposal the human sees and approves
  at Gate 2; it is not executed on the strength of detection alone. If a `scripts.build`
  launcher falls outside the allowlist, propose it flagged (do not auto-normalize away
  a surprising launcher) so the arbiter sees the real command.

### `token_pairs` — not from lockfiles

`token_pairs` come from the **`design-system` token contract**, NOT from any
lockfile or manifest. Detection never invents `token_pairs`; leave them to the
design-system contract.

## Ambiguity rule — propose, never silently pick

When the repo is a **monorepo** or shows **multiple frameworks** (e.g. a React app
and a Vue app, or a web package plus a Flutter package):

- Propose a **best guess** for the unit's surface, AND
- **Surface the alternatives to the arbiter** (the other frameworks/packages found,
  with where each was detected) so the human chooses.
- **NEVER silently pick** one and discard the rest. Ambiguity is reported, not
  resolved unilaterally.

## Determinism

Detection is a pure function of repo state: **same repo state → same proposal**, byte
for byte. No timestamps, no network, no ordering nondeterminism — so two runs (or a
re-detect after the arbiter asks "show me again") produce the identical proposed
binding, and any diff reflects a real change in the repo.
