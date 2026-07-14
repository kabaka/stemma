---
name: ux-design
description: Use when the project has a user-facing interface and you need interaction/usability/accessibility design — screen flows, IA, usability, WCAG accessibility. Covers information architecture, interaction and flow design, usability heuristics, and a WCAG accessibility baseline (perceivable/operable/understandable/robust, keyboard nav, contrast, alt text, semantic structure). Use when designing screens, navigation, user flows, forms, states, error/empty/loading UX, or accessibility for a UI (web, mobile, desktop, TUI). Do NOT use for backend/CLI/library/data work with no human-facing interface; do NOT use for system structure/components/tech choices (that is `architecture-design`) or for what/why requirements and acceptance criteria (that is `requirements-elaboration`). UX-design is the interface/interaction lens those agents load on demand when a UI surface exists.
---

# UX Design

The **interaction/usability/accessibility lens** for work that has a user-facing
interface. The `requirements-analyst` loads this to shape *how a user experiences*
the thing they're specifying; the `architect` loads it so structure serves the
flows users actually walk. It is **bounded to UI surfaces** — if there is no human
sitting in front of a screen, this skill does not apply.

## Boundaries — load this only when there is a UI

- **Use it** when the unit of work renders something a person sees and operates: a
  web page, mobile/desktop app screen, form, dashboard, wizard, or a text UI (TUI)
  a human drives interactively.
- **Do NOT use it** for backend services, CLIs invoked by scripts, libraries,
  data pipelines, or APIs with no human-facing surface. Those have no interaction
  layer to design.
- **Not this skill, that one:** *what to build and why* (requirements, user
  stories, acceptance criteria) is `requirements-elaboration`. *System structure,
  components, data/interface contracts, tech choices* is `architecture-design`.
  This skill is **only** the interface/interaction lens layered on top of those.
- **Companion VISUAL lens:** `design-system` owns the visual layer — design tokens,
  UI-element inventory, state matrices, and aesthetic — distinct from this skill's
  IA / interaction / usability / WCAG scope, so the two do not overlap.

Stay in your lane: describe screens, flows, states, and accessibility — not the
service boundaries underneath them or the business rules above them.

## 1. Information architecture (IA)

Structure content and navigation so users can find and understand things.

- **Inventory then group.** List every piece of content/action the interface must
  expose; group by the user's mental model, not the backend's table layout.
- **Name by the user's words.** Labels, nav items, and categories use the
  vocabulary the audience already has (mirror their terms from requirements).
- **Shallow over deep.** Prefer broad, shallow navigation to deep nesting; a user
  should always know *where they are*, *how they got here*, and *how to get back*.
- **One primary action per screen.** Make the main task obvious; demote secondary
  actions visually. Don't present ten equal-weight choices.
- **Surface system state.** Where am I in a multi-step flow? Is something loading,
  saved, failed? IA includes making status legible, not just content placement.

## 2. Interaction & flow design

Design the path through a task, including every non-happy state.

- **Map the flow end to end.** For each user goal, sketch the screen-by-screen
  path: entry → steps → success. Note decision points and branches.
- **Design all states, not just the happy path.** Every view needs:
  **empty** (no data yet — guide the first action), **loading** (show progress,
  don't freeze), **error** (say what went wrong and how to recover), **success**,
  and **partial/edge** (long text, many items, slow network).
- **Forms:** ask for the minimum; label every field; validate inline with specific,
  actionable messages ("Enter a date after today", not "Invalid"); never lose the
  user's input on error; mark what's optional vs required clearly.
- **Feedback is immediate.** Every action gets a visible response within ~100ms
  (even if just a spinner). Confirm destructive actions; make them undoable where
  feasible rather than gating behind a modal.
- **Respect the back button / escape.** Don't trap users; preserve state on
  navigation; make cancel always available.

## 3. Usability heuristics (the working checklist)

Adapted from Nielsen's 10 heuristics — use as a review pass on any screen/flow:

- [ ] **Visibility of system status** — the UI always shows what's happening.
- [ ] **Match the real world** — words, icons, and order match user expectations.
- [ ] **User control & freedom** — clear exits, undo/redo, no dead ends.
- [ ] **Consistency & standards** — same thing looks/behaves the same everywhere;
      follow platform conventions instead of inventing.
- [ ] **Error prevention** — constrain inputs, confirm risky actions, use sensible
      defaults so mistakes are hard to make.
- [ ] **Recognition over recall** — show options; don't make users remember things
      across screens.
- [ ] **Flexibility & efficiency** — shortcuts/accelerators for frequent users
      without blocking novices.
- [ ] **Aesthetic & minimalist** — every element earns its place; remove noise.
- [ ] **Help users recover from errors** — plain-language messages that name the
      problem and the fix.
- [ ] **Help & documentation** — guidance available in context when needed.

## 4. Accessibility baseline (WCAG)

Accessibility is **not optional polish** — bake it in from the first sketch. Hold
the four WCAG principles (**POUR**): content must be **Perceivable, Operable,
Understandable, Robust**. Aim for **WCAG 2.2 Level AA** as the default bar.

### Perceivable

- **Text alternatives:** every informative image/icon has a meaningful `alt`;
  decorative images get empty `alt=""` so screen readers skip them.
- **Color contrast:** body text ≥ **4.5:1**, large text (≥24px or 19px bold) and UI
  components/graphics ≥ **3:1** against their background.
- **Don't rely on color alone** to convey meaning (errors, status) — pair it with
  text, icon, or shape.
- **Captions/transcripts** for audio and video content.

### Operable

- **Full keyboard access:** every interactive element is reachable and operable by
  keyboard alone, in a logical tab order, with **no keyboard traps**.
- **Visible focus indicator** on whatever currently has focus.
- **Targets are big enough** (≥ 24×24 CSS px, WCAG 2.2) and not crowded.
- **No content that flashes** more than 3×/second (seizure risk).
- **Enough time:** let users extend or disable time limits.

### Understandable

- **Clear, consistent labels and navigation**; predictable behavior (no surprise
  context changes on focus/input).
- **Error identification:** name the field in error and how to fix it; associate the
  message with the input programmatically.
- **Plain language**; explain jargon.

### Robust

- **Semantic structure:** real headings (`h1`→`h2`…, no skipping), landmarks
  (`<nav>`, `<main>`, `<header>`), lists for lists, `<button>` for buttons and
  `<a>` for links — not click-handlered `<div>`s.
- **Programmatic name/role/value:** every control exposes its name, role, and state
  to assistive tech. Use native HTML elements first; reach for ARIA only to fill
  gaps, and follow ARIA rules (no redundant or broken roles).
- **Labels tied to inputs** (`<label for>` / `aria-labelledby`); group related
  controls (`fieldset`/`legend`).

### Accessibility quick-check before handoff

- [ ] Keyboard-only walkthrough of every flow completes with visible focus.
- [ ] Headings/landmarks form a correct outline; controls use native semantics.
- [ ] All informative images have alt text; decorative ones are hidden.
- [ ] Contrast meets AA; meaning never depends on color alone.
- [ ] Every form field is labeled; errors are specific and programmatically linked.

## Handoff

Produce, as the interface layer of the unit of work: the **IA/navigation map**, the
**flow(s) with all states** (empty/loading/error/success/edge), the **usability
heuristic pass**, and the **accessibility baseline** met (WCAG AA, with the
quick-check satisfied). These feed the acceptance criteria the
`requirements-analyst` owns and the structure the `architect` owns — they do not
replace them. Make accessibility criteria **testable** so the `test-engineer` can
assert them (e.g. "all interactive elements keyboard-reachable", "contrast ≥ AA").
