# Stack-binding schema — `.ai-dlc/stack-binding.json` (canonical)

This is the **canonical** definition of the binding schema. The consumer-facing
summary in `design-system/reference/binding-schema.md` covers the six **read-side**
fields and **points here** as canonical; the **execution-side** fields
(`command` / `args` / `env` / `output_dir` / `static_dir` / `audit_paths` /
`axe_tags` / `routes` / `breakpoints` / `baseline_dir` / `pixel_tolerance`) live
**only here** — do not duplicate them there.

## Contents

- [The binding is untrusted input](#the-binding-is-untrusted-input)
- [Location](#location)
- [Read-side fields](#read-side-fields)
- [Execution-side fields](#execution-side-fields)
  - [The execution model](#the-execution-model)
  - [Harness fields — running the build/export command](#harness-fields--running-the-buildexport-command)
  - [`audit_paths` — path-only routes](#audit_paths--path-only-routes)
  - [Browser-layer fields](#browser-layer-fields)
  - [Containment-checked dirs — `output_dir` / `static_dir` / `baseline_dir`](#containment-checked-dirs--output_dir--static_dir--baseline_dir)
- [CUT decisions (with security rationale)](#cut-decisions-with-security-rationale)
- [Example binding](#example-binding)

## The binding is untrusted input

**THE BINDING IS UNTRUSTED INPUT.** It is a JSON file in the repo; it can be
malicious, malformed, or drifted. The arbiter confirms it at Gate 2, but that
confirmation is **not** a substitute for validation: **every consuming tool must
validate every field at consume-time** (defense in depth). The arbiter is a human
who can miss a crafted value; the tool is the last line. Any validation failure
**aborts** the run — it never degrades to an unsafe default (see
`reference/gate2-producer-flow.md` Part B, fail-closed discipline).

## Location

`.ai-dlc/stack-binding.json` at the repo root.

## Read-side fields

These six fields MUST stay consistent with the summary in
`design-system/reference/binding-schema.md` (that file is the consumer's read-side
reference; this file is canonical). All are optional in practice — a partial binding
is valid; treat missing fields as `null`.

| Field | Type | Meaning |
| --- | --- | --- |
| `ui_framework` | string \| null | UI framework/idiom to phrase concrete guidance in (`react`, `vue`, `svelte`, `swiftui`, `flutter`, …). `null` = unknown. |
| `token_source` | string \| null | Path to the project's DTCG `*.tokens.json` or token dir. `null` = none yet. |
| `source_globs` | array \| null | Globs locating UI source to inventory screens/elements from. |
| `token_pairs` | array \| null | `[fg, bg]` token-name pairs to emit contrast criteria for. **From the `design-system` contract — NOT from lockfiles.** |
| `surface` | enum | Primary surface: `web` \| `mobile` \| `tui` \| `cli` \| `none`. |
| `absent` | boolean | Explicit "no usable binding" flag. `true` = treat as absent even if the file exists. |

`token_pairs` are `[fg, bg]` token-name pairs drawn from the **design-system
token contract** — they reference semantic token names (e.g.
`color.text.default`), never anything inferred from a manifest.

## Execution-side fields

These fields are consumed by the **visual-QA harness** and browser tools to build
and audit the app. They are the highest-risk part of the binding because they
influence process execution — hence the allowlist and containment models below.
They live ONLY in this canonical file.

### The execution model

There is **no dev-server daemon and no binding-supplied URL/port.** The flow is:

1. The harness (`.ai-dlc/scripts/lib/app-exec-harness.mjs`) runs the consumer's
   **build/export command** via a fail-closed **argv** harness (`shell: false`).
2. That command emits static files into a repo-local, containment-checked
   `static_dir` and **EXITS** — it is a one-shot build, not a long-lived server.
3. The kit's own static server (`.ai-dlc/scripts/visual-qa/static-server.mjs`) serves that
   dir on `127.0.0.1:<ephemeral port>`. **The kit chooses the port and origin**;
   the binding never supplies a host, port, URL, baseURL, or readiness log/probe.
4. The browser tools audit that kit-chosen loopback origin.

### Harness fields — running the build/export command

These are **top-level** fields (there is no `run` wrapper object):

```json
"command": "npm",
"args": ["run", "build"],
"env": { "CI": "1" },
"output_dir": ".ai-dlc/visual-qa-out"
```

| Field | Type | Rule |
| --- | --- | --- |
| `command` | **string** | **MUST be a bare launcher from the allowlist `node` / `npm` / `pnpm` / `yarn` / `npx`, OR a repo-local path starting `node_modules/.bin/` or `./node_modules/.bin/`.** Containment-checked; no absolute paths, no `..` traversal, no leading `-`. Anything else **aborts**. |
| `args` | string array | Each element ≤4096 chars, ≤64 entries, no control characters. Default `[]`. |
| `env` | object of strings | **ALLOWLIST model** — see below. |
| `output_dir` | string | Where the tools write artifacts (screenshots, diffs, reports). Default `.ai-dlc/visual-qa-out`. Containment-checked (write); the dir must already exist and the tool mkdtemps a fresh subdir under it (never clobbers). |

**`command` is a STRING, not an argv array.** The launcher is matched against the
allowlist (or validated as a contained `node_modules/.bin/*` path); a value outside
that is a hard validation failure that **aborts**. No `bash`, `sh`, `python`,
`make`, no absolute paths, no shell metacharacters (the harness runs `shell: false`).

**`env` is an ALLOWLIST that fails closed — it does NOT silently drop.** Only keys
in a fixed safe allowlist are honored: currently `CI`, `AIDLC_VISUAL_QA_HEADLESS`,
`PWDEBUG_OFF`. Any **non-allowlisted** binding key **ABORTS** the launch (an unknown
key may be load-bearing for an un-enumerated attack — fail closed rather than drop).
The following process/loader-influencing keys and patterns are additionally
**HARD-BLOCKED** (a refusal):

- exact: `NODE_OPTIONS`, `NODE_EXTRA_CA_CERTS`, `LD_PRELOAD`, `LD_LIBRARY_PATH`,
  `LD_AUDIT`, `PLAYWRIGHT_BROWSERS_PATH`, and the proxy vars
  (`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`/`FTP_PROXY`);
- prefixes: `NODE_`, `PLAYWRIGHT_`, `DYLD_`, `NPM_CONFIG_`, `GIT_`, `LD_`;
- suffix: `_PROXY`.

`NODE_OPTIONS` can inject `--require`/`--import` to run arbitrary code at startup;
`LD_*`/`DYLD_*` load attacker shared objects into the process; `PLAYWRIGHT_*` can
redirect the browser the tool launches to an attacker-supplied binary. **`PATH`,
`HOME`, `TMPDIR`, `LANG`, and similar** are NOT taken from the binding at all — they
come from a kit-controlled **minimal parent passthrough**, so the binding can never
repoint which `node`/`npm` resolves.

**Launch gating.** `absent: true`, or a non-visual `surface` (`cli` / `none` /
`tui` / `mobile`), **SKIPs** — no build command runs.

> Out of scope here: the **exec-free** stdlib checks also read a `coverage`
> (patch-coverage) and a `changelog` (changelog-check) object. They run no app and
> are not part of this execution-side reconciliation; they are noted only so the
> field set above is not mistaken for the whole binding.

### `audit_paths` — path-only routes

```json
"audit_paths": ["/", "/settings", "/dashboard"]
```

`audit_paths` are **PATH-ONLY** strings. Each MUST be a bare path:

- **NO scheme** (`http://`, `https://`, `file://`, `javascript:`),
- **NO host / authority** (`//evil.example`),
- **NO query or fragment** that could redirect off-origin.

The auditor **composes each path onto the KIT-chosen loopback origin**
(`http://127.0.0.1:<ephemeral port>`) and **re-validates at use**; the binding can
never point auditing at an external origin. `audit_paths` defaults to `["/"]` and is
**capped at 50** entries. Any value that is not a clean path **aborts** (it never
falls back to treating the string as a full URL).

### Browser-layer fields

Read by `browser-runner.mjs` and the four browser tools; all path-validated:

| Field | Tool | Type | Rule |
| --- | --- | --- | --- |
| `static_dir` | all browser tools | string | Repo-local dir the build/export command must emit static files into. Default `.ai-dlc/visual-qa-build`. Containment-checked (read); a `://` value is rejected as not-a-path; symlink escape rejected. If it wasn't produced → **SKIP**. |
| `axe_tags` | axe-audit only | string array | Optional WCAG tag-set override. Default `wcag2a` / `wcag2aa` / `wcag21a` / `wcag21aa`. Non-empty, ≤32. |
| `routes` | reachability-runner only | path-only array | User-reachable routes (PATH-ONLY, same rules as `audit_paths`). Falls back to `audit_paths`, then `["/"]`. Capped at 50. |
| `breakpoints` | responsive-check only | array of objects | `{label, width, height}`; width/height integers `100..10000`. Default mobile/tablet/desktop trio. Capped at 12. |
| `baseline_dir` | pixel-diff only | string | Repo-local dir of committed PNG **baselines** to diff against. Default `.ai-dlc/visual-baselines`. NEVER a URL (`://` rejected); containment-checked (read). NO baselines → **SKIP**. |
| `pixel_tolerance` | pixel-diff only | number | Fraction of pixels allowed to differ, in `[0,1]`. Default `0.01`. |

### Containment-checked dirs — `output_dir` / `static_dir` / `baseline_dir`

`output_dir` (write), `static_dir` (read), and `baseline_dir` (read) are all
**CONTAINMENT-checked**: the resolved absolute path MUST stay inside the repo (or
the designated output root). Reject any value that resolves outside via `..`
traversal, an absolute path, or a symlink escape. A path that escapes containment
**aborts** — the tool never reads or writes outside the repo/output root.

## CUT decisions (with security rationale)

These were deliberately excluded. Each line is the one-line reason:

- **NO binding-supplied baseline-fetch URLs.** The tool never fetches a baseline
  from a binding-chosen URL — that would be an SSRF / poisoned-baseline vector;
  baselines are repo-local only (`baseline_dir`, containment-checked, `://`
  rejected).
- **NO binding-chosen browser `executablePath`, Playwright config, reporter, or
  setup files.** The tool owns its own browser and config — a binding-chosen
  executable or config/setup file is arbitrary code execution under another name.
  (The `env` hard-block on `PLAYWRIGHT_*` and the loader vars closes the
  back-door equivalents.)
- **NO arbitrary interpreter / launcher.** `command` is a string limited to the
  allowlist (`node`/`npm`/`pnpm`/`yarn`/`npx`) or a contained
  `node_modules/.bin/*` path only — `bash`, `sh`, `python`, `make`, and absolute
  paths would let the binding run anything.
- **NO binding-supplied URL / `baseURL` / port at all.** There is no dev-server
  daemon and no navigation origin in the binding. The kit serves the build's
  static output on a **kit-chosen loopback port** (`127.0.0.1:<ephemeral>`) and
  audits only there — the binding supplies a repo-local `static_dir`, never a host,
  port, or URL, so it can never exfiltrate to or audit an external origin.

## Example binding

Consistent with the `design-system` `react`/`web` example, extended with the safe
top-level execution fields (`command`/`args`/`env`), `static_dir`, `audit_paths`,
`output_dir`, and `baseline_dir`:

```json
{
  "ui_framework": "react",
  "token_source": "design/tokens/",
  "source_globs": ["src/**/*.tsx"],
  "token_pairs": [
    ["color.text.default", "color.surface.default"],
    ["color.text.muted", "color.surface.raised"]
  ],
  "surface": "web",
  "absent": false,
  "command": "npm",
  "args": ["run", "build"],
  "env": { "CI": "1" },
  "static_dir": ".ai-dlc/visual-qa-build",
  "audit_paths": ["/", "/settings"],
  "output_dir": ".ai-dlc/visual-qa-out",
  "baseline_dir": ".ai-dlc/visual-baselines"
}
```

`command` runs the consumer's **build/export** (here `npm run build`) which emits
static files into `static_dir`; the kit then serves that dir on its own loopback
port and audits the listed `audit_paths`.

A non-visual unit instead carries `{ "surface": "none", "absent": true }` (or no
binding at all), and every tool skips clean.
