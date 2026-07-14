---
name: stack-binding
description: Detects a repo's UI stack from lockfiles/manifests and produces the repo-local `.ai-dlc/stack-binding.json` that off-token-lint and the visual-QA tools consume. Use when you need to detect/bind the stack, write the `.ai-dlc/stack-binding.json`, propose the binding at Gate 2 for a `ui_bearing` unit, or set up visual QA / the design kit for this repo (react/vue/svelte/flutter/swiftui/ratatui, web/mobile/tui surfaces). Covers the binding schema (including the `command`/`args`/`static_dir`/`audit_paths`/`output_dir` execution fields the visual-QA harness reads), lockfile→field detection heuristics, the architect-proposes-arbiter-confirms-at-Gate-2 flow, and the visual-QA tool catalog. The binding is UNTRUSTED input — tools revalidate every field. Do NOT use for design tokens/states or the visual contract (that is `design-system`), system structure or tech-choice trade-offs (that is `architecture-design`), or what-to-build / acceptance criteria (that is `requirements-elaboration`).
---

# Stack Binding

The producer-side home for `.ai-dlc/stack-binding.json` — the repo-local file that
turns the **stack-neutral** `design-system` contract and the **visual-QA tools**
into *concrete* guidance for one real project. It records which UI framework,
token source, source globs, surface, and (for visual QA) which **build/export
command, static output directory, audit paths, and output directory** the tools
target. The visual-QA model is **build → serve-static → audit**: a one-shot build
command that EXITS emits a static `static_dir`, the kit serves that dir on
`127.0.0.1:<ephemeral port>`, and the browser tools audit that kit-chosen origin —
there is **no dev-server daemon and no binding-supplied URL/port**.

This is a **kit convention** — our faithful operationalization of the existing
Construction **design fork (Gate 2)**, **not** a new gate, agent, ceremony, or
AWS-named scheme. For a `ui_bearing` unit the `architect` **detects** the stack,
**proposes** a binding, and the **human arbiter confirms it inside the existing
Gate-2 Decision Record**. No new record-type, artifact-type, or installer prompt.

**The binding is UNTRUSTED input.** The arbiter confirms it at Gate 2, but every
consuming tool **revalidates every field at consume-time** (defense in depth) — the
execution fields especially. See `reference/schema.md`.

## Boundaries — stay in your lane

- **stack-binding (this skill)** = **detect and bind the stack**: produce/validate
  `.ai-dlc/stack-binding.json` (the schema, the detection heuristics, the Gate-2
  producer flow, and the visual-QA tool catalog that consumes it).
- **`design-system`** = the **visual contract**: design tokens, the UI-element
  inventory with state matrices, empty/loading/error patterns, the aesthetic. It
  **reads** the binding; it does not produce it. Tokens and `token_pairs` come from
  *its* contract, never from a lockfile.
- **`architecture-design`** = system **structure**, module boundaries, data/
  interface contracts, and **tech-choice trade-offs**. It owns *what the system is*;
  this skill only records *which stack a UI-bearing unit already uses* for tooling.
- **`requirements-elaboration`** = **what to build** and the acceptance criteria.
  Not a concern here.

When in doubt: lockfiles, manifests, build commands, and audit paths are here; tokens
and states are `design-system`; boundaries and tech choices are
`architecture-design`.

## The schema (summary)

`.ai-dlc/stack-binding.json` at the repo root. Two groups of fields:

**Read-side** (shared with `design-system`'s consumer reference, kept consistent):

| Field | Meaning |
| --- | --- |
| `ui_framework` | framework/idiom to phrase guidance in (`react`, `swiftui`, `flutter`, …) |
| `token_source` | path to the DTCG `*.tokens.json` / token dir |
| `source_globs` | globs locating UI source to inventory |
| `token_pairs` | `[fg, bg]` token-name pairs (from the **design-system contract**) |
| `surface` | `web` \| `mobile` \| `tui` \| `cli` \| `none` |
| `absent` | boolean — explicit "no usable binding" flag |

**Execution-side** (Slice-3; consumed by the visual-QA harness; live ONLY here).
All are **top-level** — there is **no `run` wrapper object**:

| Field | Meaning |
| --- | --- |
| `command` / `args` / `env` | how to run the one-shot **build/export** command (it EXITS, not a dev server) — `command` is a **string** on the **launcher allowlist** (`node`/`npm`/`pnpm`/`yarn`/`npx` or a contained `node_modules/.bin/*` path); `env` is an **env-key allowlist** |
| `static_dir` | repo-local dir the build emits static files into; the kit **serves it on `127.0.0.1:<ephemeral port>`** and audits there (containment-checked read) |
| `audit_paths` | **PATH-ONLY** route strings the auditor composes onto the kit-chosen loopback origin |
| `output_dir` / `baseline_dir` | containment-checked write/read targets for tool artifacts |

The **full canonical schema**, the field-by-field rules, the allowlists/hard-blocks,
the CUT decisions, and a worked example: **read `reference/schema.md`.**

## The producer flow (summary)

For a `ui_bearing` unit, at Construction's Gate-2 design fork:

1. The `architect` **auto-detects** the stack from lockfiles/manifests (see
   `reference/detection-heuristics.md`) and writes a **PROPOSED**
   `.ai-dlc/stack-binding.json`.
2. The proposed binding **rides inside the architecture handoff** — exactly like the
   `design-system` and `ux-design` contracts do (see `architecture-design` step 2
   and its handoff table). It is **a proposal until approved.**
3. The **human arbiter CONFIRMS** it inside the **existing Gate-2 Decision Record**
   (`chosen_option: approve`). No new gate, agent, record-type, or artifact-type.

Detected-but-unconfirmed is a proposal, never silently trusted — the top-level
`command` and `audit_paths` are *surfaced* for confirmation even when auto-detected
from `scripts.build`. The full producer flow is **Part A** of
**`reference/gate2-producer-flow.md` (read it).**

## The visual-QA tool catalog (summary)

The binding is consumed by **off-token-lint** (Slice 1) and by **seven visual-QA
tools** that run the app over loopback and audit it. They are deterministic
**Gate-2/Gate-3 evidence**, not a gate or agent — the tools produce evidence; the
human arbiter decides. App/browser execution is **fail-closed** and **human-confirmed
per session**. The capability-level catalog and the fail-closed discipline are
**Part B** of **`reference/gate2-producer-flow.md` (read it).**

## Proportionality — degrade clean for non-visual surfaces

Mirror `design-system`'s degrade-clean rule. When a unit has no visual surface —
backend service, library, data pipeline, pure CLI — the binding is
`absent: true` and/or `surface: none`. Every downstream tool **SKIPS cleanly**:
off-token-lint and each visual-QA tool detect the absent/none binding and emit a
clean skip (no findings, no failure, no fabricated stack), never a hard error. The
visual contract and tooling are *concretized* by a present binding; a missing one is
never a defect. Right-size: non-`ui_bearing` units carry no binding at all.

## References (read these; one level deep)

- **`reference/schema.md`** — *read* for the canonical binding schema, the
  execution-field allowlists/hard-blocks, the CUT decisions, and the worked example.
- **`reference/detection-heuristics.md`** — *read* for the lockfile/manifest →
  field mapping, the ambiguity/monorepo rule, and the determinism guarantee.
- **`reference/gate2-producer-flow.md`** — *read* for Part A (the architect-proposes /
  arbiter-confirms-at-Gate-2 producer flow) and Part B (the 7-tool visual-QA catalog
  and its fail-closed app-exec discipline + residual-risk note).
