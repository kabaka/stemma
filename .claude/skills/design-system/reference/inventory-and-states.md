# UI element inventory & state matrices

The single highest-leverage move against **half-styled elements** is to specify
**every state** of **every interactive UI element**, not just its resting look.
This reference gives the inventory method, the full state-matrix template, and the
global empty/loading/error patterns. Read it when building the inventory part of a
visual contract.

> "UI element" here means a UI control — a button, form field, card, menu — **not**
> a *system component* in the `architecture-design` sense. Keep the vocabulary
> straight to avoid colliding with component boundaries.

## Step 1 — screen & element inventory

1. **List every screen / view** the unit of work renders.
2. **List every interactive element** on each: buttons, links, inputs, selects,
   checkboxes/radios, toggles, tabs, menus, cards (if clickable), rows, chips,
   tooltips-on-trigger, etc.
3. **List the static-but-themed elements** too (headings, body text, dividers,
   surfaces) so they bind to semantic tokens rather than ad-hoc values.

A missing element in the inventory becomes an unstyled element in the build.

## Step 2 — the full state matrix

For **every interactive element**, specify all of these states. A state may
legitimately be "n/a" (a static label has no `loading`), but it must be
*explicitly* marked n/a — never silently omitted.

| State | When it applies | What to specify |
| --- | --- | --- |
| **default** | resting | base tokens (bg, text, border, radius, spacing) |
| **hover** | pointer over (n/a on touch-only) | the delta from default (elevation, bg shift) |
| **active** | pressed / mid-click | pressed treatment (inset, darker) |
| **focus** | keyboard/AT focus | a **visible focus ring** (pairs with `ux-design` WCAG) |
| **disabled** | not interactable | reduced-emphasis tokens + `cursor`/`aria-disabled` |
| **loading** | async in flight | spinner/skeleton **in place**; element stays sized |
| **selected** | chosen/active tab/checked | the chosen treatment vs unselected |
| **error** | invalid/failed | error tokens + message slot (not color alone) |

### State-matrix template (fill one per element)

```text
Element: Primary button
- default:  bg {button.primary.bg}, text {button.primary.text}, radius {radius.md}
- hover:    bg {color.action.primary-hover}
- active:   bg {color.action.primary-active}, translateY 1px
- focus:    2px ring {color.focus.ring}, offset 2px
- disabled: bg {color.action.disabled}, text {color.text.muted}, no pointer
- loading:  inline spinner, label hidden, width preserved, aria-busy
- selected: n/a (stateless action)
- error:    n/a (no validation on a trigger)
```

Repeat for inputs, toggles, tabs, cards, rows — every interactive element in the
inventory.

## Step 3 — global empty / loading / error patterns

Define these **once, app-wide**, as first-class reusable patterns. Improvising
them per screen is how apps reach "task completion impossible". Each is a testable
requirement: *every async view renders all three.*

### Empty state

- Explain **what belongs here** and **why it is empty** (first run vs filtered to
  nothing).
- Offer the **primary first action** (create, import, connect).
- Never a blank region or a bare "No data".

### Loading state

- Use **skeletons** that preserve final layout (no content jump on load), or a
  determinate progress indicator for long operations.
- **Communicate system status** ("Loading orders…") for anything > ~1s.
- Keep the surface sized and interactive affordances disabled, not removed.

### Error state

- **Name what failed** in plain language (not a raw stack/code alone).
- Offer a **recovery action**: retry, go back, edit input, or contact.
- Distinguish **transient** (retry) from **terminal** (change something) errors.
- Pair color with text/icon — meaning never by color alone (defers to `ux-design`
  WCAG, which this complements visually).

## Step 4 — turn it into testable criteria

Express the inventory as oracle-gradeable acceptance criteria for the
`test-engineer`, e.g.:

- "Every interactive element in the inventory defines all eight states (or marks
  a state explicitly n/a)."
- "Focus state renders a visible ring on every interactive element."
- "Every view that loads data renders the empty, loading, and error pattern."
- "Disabled elements are non-interactive and expose `aria-disabled`/equivalent."

These ride in the visual contract; the human arbiter judges the *look* of the
states at Gate 2.
