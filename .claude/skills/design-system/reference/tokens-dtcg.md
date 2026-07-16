# Design tokens — DTCG three-tier schema

The W3C **Design Tokens Community Group (DTCG)** format is the interchange format
for design tokens (`$value` / `$type`); it reached its first stable version in
late 2025 — verify against the current DTCG spec. Tokens live in `*.tokens.json`
files. This reference gives the schema, the three-tier model, and a worked
example. Read it when authoring the token layer of a visual contract.

## DTCG essentials

- A **token** is a JSON object with a **`$value`** and a **`$type`**.
- **`$type`** declares the kind: `color`, `dimension`, `fontFamily`,
  `fontWeight`, `duration`, `cubicBezier`, `number`, `shadow`, etc. `$type` may be
  set on a group and inherited by its children.
- **`$description`** (optional) documents intent.
- **Aliases / references** use the `{group.token}` syntax as the `$value` — e.g.
  `"$value": "{color.blue.500}"`. Aliasing is how higher tiers point at lower
  tiers.
- A **group** is any nesting object; group keys must not start with `$` (those are
  reserved for DTCG metadata).

```json
{
  "color": {
    "$type": "color",
    "blue": {
      "500": { "$value": "#2563eb", "$description": "primitive brand blue" }
    }
  }
}
```

## The three tiers

UI elements must reference **only the semantic tier** (and component tokens that
themselves alias semantic). This indirection is what makes theming and a11y
variants a one-tier swap.

| Tier | Names describe… | Example | Referenced by |
| --- | --- | --- | --- |
| **1. Primitive** | the raw value | `color.blue.500`, `space.4` | semantic tier only |
| **2. Semantic** | the meaning/role | `color.text.default`, `color.action.primary` | component tier + UI |
| **3. Component** | the element slot | `button.primary.bg`, `card.padding` | a single UI element |

### The swap rule (load-bearing)

**Dark/light and accessibility variants (e.g. high-contrast) swap the SEMANTIC
tier; primitives stay fixed.** You do not duplicate primitives per theme — you
re-point semantic aliases at different primitives. One source of raw values, many
themes.

## Worked example

Primitive tier (`primitives.tokens.json`) — fixed across all themes:

```json
{
  "color": {
    "$type": "color",
    "blue":  { "500": { "$value": "#2563eb" }, "700": { "$value": "#1d4ed8" } },
    "slate": { "0": { "$value": "#ffffff" }, "900": { "$value": "#0f172a" },
               "100": { "$value": "#f1f5f9" }, "400": { "$value": "#94a3b8" } }
  },
  "space": { "$type": "dimension",
    "2": { "$value": "8px" }, "4": { "$value": "16px" } }
}
```

Semantic tier — **light** theme (`semantic.light.tokens.json`):

```json
{
  "color": {
    "$type": "color",
    "text":    { "default": { "$value": "{color.slate.900}" } },
    "surface": { "default": { "$value": "{color.slate.0}" },
                 "raised":  { "$value": "{color.slate.100}" } },
    "action":  { "primary": { "$value": "{color.blue.500}" } }
  }
}
```

Semantic tier — **dark** theme swaps ONLY the aliases (primitives unchanged):

```json
{
  "color": {
    "$type": "color",
    "text":    { "default": { "$value": "{color.slate.0}" } },
    "surface": { "default": { "$value": "{color.slate.900}" } },
    "action":  { "primary": { "$value": "{color.blue.700}" } }
  }
}
```

Component tier (`components.tokens.json`) — aliases semantic, theme-agnostic:

```json
{
  "button": {
    "primary": {
      "bg":   { "$value": "{color.action.primary}", "$type": "color" },
      "text": { "$value": "{color.surface.default}", "$type": "color" }
    }
  },
  "card": { "padding": { "$value": "{space.4}", "$type": "dimension" } }
}
```

## Authoring rules

- **Never let a UI element read a primitive directly.** If a screen references
  `color.blue.500`, that is a defect — route it through a semantic token.
- **One semantic name per role**, reused everywhere that role appears. Inventing a
  new color per screen is exactly the inconsistency this skill prevents.
- **Keep `$type` correct** — graders and token tooling rely on it; a `color` typed
  as a string is invalid.
- **If a stack binding names a real token file** (`token_source` in
  `.ai-dlc/stack-binding.json`), reconcile against it rather than inventing a
  parallel set; see `binding-schema.md`. With no binding, deliver this abstract
  three-tier shape and note that it is unbound.
