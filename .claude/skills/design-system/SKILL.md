---
name: design-system
description: The visual design-system lens for UI-bearing work — design tokens, a UI element inventory with full state matrices, global empty/loading/error patterns, and a committed aesthetic, producing a testable visual contract for the human to judge. Use when a unit of work renders a visible interface and you need design tokens, a design system, a screen or UI element inventory, state matrices (default/hover/active/focus/disabled/loading/selected/error states), empty/loading/error patterns, a visual/styling contract, or a chosen aesthetic / typography / color / motion direction — and when an app ships inconsistent, unstyled, half-styled, or hierarchy-broken visuals. Do NOT use for information architecture, interaction flows, usability, or WCAG behavior (that is `ux-design`), or for system structure, modules, or tech choices (that is `architecture-design`). The human arbiter judges whether it looks good — this skill never self-certifies aesthetics.
---

# Design System

The **visual design-system lens** for any unit of work that renders something a
person sees. The `requirements-analyst` loads it to specify *how the thing should
look and feel*; the `architect` loads it at Construction's **Gate-2 design fork**
so the **visual contract** rides inside the existing architecture handoff. Its job
is to kill the three recurring UI failures of AI-built apps: **visual
inconsistency**, **unstyled / half-styled elements**, and **broken hierarchy** —
by forcing tokens, states, app-wide status patterns, and a committed aesthetic
*before* code.

This is a **kit convention** — our faithful operationalization of the existing
Construction design fork (Gate 2), **not** a new gate, phase, or ceremony, and
**not** an AWS-named artifact. The visual contract is an **interface/data
contract** within the existing architecture handoff. **The human arbiter decides
aesthetics at Gate 2; this skill never self-certifies "it looks good."**

## Boundaries — stay in your lane

- **design-system (this skill)** = the **visual** layer: design tokens, the UI
  element inventory with state matrices, global empty/loading/error patterns, the
  committed aesthetic, and the testable visual contract.
- **`ux-design`** = information architecture, interaction & flow, usability
  heuristics, and **WCAG behavior** (keyboard nav, semantics, focus order). It
  owns *how it works*; this skill owns *how it looks*.
- **`architecture-design`** = system **structure**, modules, data/interface
  contracts, tech choices. It owns the machine; this skill owns the surface.

No overlap. When in doubt: pixels, tokens, and states are here; flows and
usability are `ux-design`; boundaries and services are `architecture-design`.

## When to load

Load for any unit of work that renders a visible interface — web, mobile,
desktop, or TUI. Do **not** load for backend services, libraries, data pipelines,
or pure-CLI/script work with no human-facing visual surface (a CLI with rich
formatted output is borderline — load only if visual styling is in scope).

## The method (the spine)

Work the four steps in order; each produces part of the visual contract.

### 1. Design tokens — three tiers, DTCG format

Define the visual vocabulary as **W3C Design Tokens Community Group (DTCG)**
tokens — the interchange format (`$value` / `$type`, in `.tokens.json` files),
which reached its first stable version in late 2025; verify against the current
DTCG spec. Use **three tiers**:

1. **Primitive** — raw values (`color.blue.500 = #2563eb`, `space.4 = 16px`).
   Brand-neutral, never referenced directly by UI elements.
2. **Semantic** — meaning-mapped aliases (`color.text.default`,
   `color.surface.raised`, `color.action.primary`). UI elements consume **only**
   these.
3. **Component** — element-scoped (`button.primary.bg`, `card.padding`), aliasing
   semantic tokens.

**Theme/a11y variants (dark/light, high-contrast) swap the SEMANTIC tier only;
primitives stay fixed.** That single rule is what keeps theming consistent instead
of re-hardcoding colors per screen. Full schema + worked example:
read `reference/tokens-dtcg.md`.

### 2. UI element inventory — with full state matrices

Inventory every screen and every interactive **UI element** (button/form/card —
i.e. a UI control, **not** a *system component* in the `architecture-design`
sense). For each interactive element, specify **every state**, not just the
resting look:

> **default · hover · active · focus · disabled · loading · selected · error**

Specifying *states* (not just the default appearance) is precisely what prevents
half-styled elements — the resting button looks fine, but the disabled/loading/
error variants were never designed, so they ship broken. The full state-matrix
template lives in `reference/inventory-and-states.md` (read it).

### 3. Global empty / loading / error patterns

Define **app-wide**, first-class patterns for the three non-happy states so they
are designed once and reused, not improvised per screen:

- **Empty** — first-run / no-data: explain what goes here and offer the first
  action; never a blank void.
- **Loading** — skeletons or progress that preserve layout; communicate system
  status; never a frozen screen.
- **Error** — system-status messaging that names what failed **and** offers a
  recovery action (retry / go back / contact).

These directly attack the "task completion impossible" UX failure. Patterns and
templates: read `reference/inventory-and-states.md`.

### 4. Aesthetic brief — commit, and ban the defaults

Commit to a **specific aesthetic** using cultural/visual vocabulary (reference
real movements, products, or eras), and **explicitly ban the AI defaults**. Per
Anthropic frontend-aesthetics guidance:

- **Ban** Inter / Roboto / Arial / system fonts; **ban** purple-on-white
  gradients and other tell-tale defaults.
- **Steer typography, color, motion, and background individually** — one decision
  each, not a vibe.
- Use **weight extremes** and **3×+ size jumps** for hierarchy.
- **One dominant color + a single sharp accent** — not a rainbow.

Full brief and the ban-list: read `reference/aesthetic-brief.md`. **The human
arbiter judges the result at Gate 2** — the skill commits to a direction and shows
evidence; it never declares the result good.

## Stack-neutral + binding-aware

This skill defines the **abstract** token / inventory / aesthetic shape. There is
**no endorsed default stack** (binding decision: stack-neutral). To render
*concrete* stack guidance, it consumes an **optional** repo-local binding at
`.ai-dlc/stack-binding.json` (schema + consumption rules:
read `reference/binding-schema.md`).

- **Binding present** → resolve concrete guidance from it (the real token file,
  the framework's styling idiom, the actual `token_pairs` to contrast-check).
- **Binding absent or `absent: true`** → **degrade clean**: emit the stack-neutral
  contract (tokens/states/patterns/aesthetic as above) plus a one-line note:
  *"Bind your stack in `.ai-dlc/stack-binding.json` for concrete, checkable
  guidance."* Never block on a missing binding; never invent a stack.

> Auto-detection and **production** of the binding is done by the `stack-binding`
> skill at Gate 2 — the `architect` detects the stack and proposes the binding,
> the arbiter confirms it. This skill only **reads** the binding if it is present.

## Testable outputs — the handoff

Every accessibility, contrast, and visual claim must be expressed as a
**testable acceptance criterion** an oracle can grade — not prose like "looks
balanced". Examples:

- "All eight states are defined for every interactive element in the inventory."
- "Body text token pair `color.text.default` on `color.surface.default` meets
  contrast ≥ 4.5:1; verify each pair in `token_pairs`."
- "Every async view renders the empty, loading, and error pattern."
- "No banned font (`Inter`/`Roboto`/`Arial`/system) appears in the resolved
  tokens."

Hand these criteria to the `test-engineer`, who folds them into the oracle so the
deterministic checks can assert them. The visual contract is an **interface/data
contract** in the architecture handoff — the design choice itself (which
aesthetic, which direction) is surfaced for the **human arbiter at Gate 2**.

## What you produce

For a UI-bearing unit of work, deliver the **visual contract**: (1) the DTCG
three-tier tokens (or their abstract shape if unbound), (2) the UI element
inventory with full state matrices, (3) the global empty/loading/error patterns,
(4) the committed aesthetic brief with the ban-list honored, and (5) the testable
acceptance criteria for the `test-engineer`. These ride inside the architecture
handoff and feed the acceptance criteria the `requirements-analyst` owns — they do
not replace either. The arbiter approves the look at Gate 2.
