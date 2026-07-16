# Stack binding — `.ai-dlc/stack-binding.json`

The `design-system` skill is **stack-neutral**: it defines the abstract
token/inventory/aesthetic shape and has **no endorsed default stack**. To render
*concrete* guidance for a real project, it reads an **optional** repo-local
binding. This reference defines the binding schema, how the skill consumes it, and
the degrade-clean behavior when it is absent. Read it when a project does (or
should) carry a binding.

> **Producer vs consumer:** the binding is **produced by the `stack-binding`
> skill** at Gate 2 (the `architect` detects it; the arbiter confirms it). The
> `design-system` skill only **reads** it. `stack-binding` is the **canonical
> schema home**; this file is a **consumer-facing reference** covering the six
> read-side fields below. The execution fields (the top-level
> `command` / `args` / `env` / `static_dir` / `audit_paths` / `output_dir`) are NOT
> duplicated here — they live in `stack-binding`'s `reference/schema.md`, which is
> **canonical** for them.

## Location

`.ai-dlc/stack-binding.json` at the repo root.

## Schema

```json
{
  "ui_framework": "string | null",
  "token_source": "string (path to DTCG tokens) | null",
  "source_globs": ["string", "..."] ,
  "token_pairs":  [["fg", "bg"], "..."],
  "surface": "web | mobile | tui | cli | none",
  "absent": false
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `ui_framework` | string \| null | The UI framework/idiom to phrase concrete guidance in (e.g. `react`, `swiftui`, `flutter`). `null` = unknown. |
| `token_source` | string \| null | Path to the project's DTCG `*.tokens.json` (or token dir). Reconcile against it instead of inventing tokens. `null` = none yet. |
| `source_globs` | array \| null | Globs locating the UI source to inventory screens/elements from. `null`/omitted = none provided. |
| `token_pairs` | array \| null | Foreground/background token pairs to emit contrast-check criteria for, as `[fg, bg]`. `null`/omitted = none specified. |
| `surface` | enum | Primary surface: `web` \| `mobile` \| `tui` \| `cli` \| `none`. Drives which conventions apply. |
| `absent` | boolean | Explicit "no usable binding" flag. `true` = treat as absent even though the file exists. |

All fields are optional in practice; a partial binding is valid — resolve the
fields that are present and treat missing ones as `null`.

## How the skill consumes it

**Binding present and usable** (`absent` is falsy and at least one field is set):

- Phrase token/styling guidance in the `ui_framework`'s idiom.
- If `token_source` is set, **reconcile** the three-tier token contract against
  that real file (see `tokens-dtcg.md`) — do not author a parallel token set.
- If `source_globs` are set, build the screen/element inventory from that source
  rather than guessing the surface.
- If `token_pairs` are set, emit a **contrast acceptance criterion per pair**
  (e.g. `[color.text.default, color.surface.default]` → "≥ 4.5:1") for the
  `test-engineer`.
- Use `surface` to pick conventions (e.g. `tui` skips hover; `mobile` adds touch
  target sizing).

## Degrade-clean behavior (binding absent)

Treat the binding as **absent** when **any** of these hold: the file does not
exist, it fails to parse, or `absent` is `true`, or every meaningful field is
`null`/empty. In that case:

1. **Do not block and do not invent a stack.** There is no endorsed default.
2. **Emit the stack-neutral visual contract** — the abstract three-tier tokens,
   the inventory + state matrices, the empty/loading/error patterns, and the
   aesthetic brief, all in framework-agnostic terms.
3. **Append exactly one note:** *"Bind your stack in
   `.ai-dlc/stack-binding.json` for concrete, checkable guidance."*

The contract is always delivered; the binding only makes it concrete. Never let a
missing or malformed binding degrade into a failure or a fabricated stack.

## Example binding

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
  "absent": false
}
```
