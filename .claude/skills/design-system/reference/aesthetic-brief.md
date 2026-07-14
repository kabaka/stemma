# Aesthetic brief — commit, and ban the defaults

AI-built UIs converge on a recognizable, generic "default" look that signals
low effort and erodes trust. This brief forces a **committed aesthetic** and
**explicitly bans the tell-tale defaults**, informed by published
frontend-aesthetics guidance. Read it when writing the aesthetic section of a
visual contract.

> **The human arbiter judges the result at Gate 2.** This brief commits to a
> direction and produces evidence; it never declares the result "good".

## 1. Commit to a specific aesthetic

Do **not** describe a vague "clean, modern" vibe. Name a **specific** direction
using cultural/visual vocabulary the reader can picture:

- Reference real **movements, eras, products, or disciplines** — e.g. Swiss
  International typographic style; brutalist editorial; warm 70s print; technical
  terminal/monospace; glassy spatial UI; high-contrast newsprint.
- State the **mood and the audience** it serves in one or two sentences.
- This is a **decision**, recorded in the contract — not a mood board to defer.

## 2. Ban the defaults (hard list)

These are the AI tells. Banning them is a **testable** criterion ("no banned font
appears in the resolved tokens"):

- **Fonts:** ban **Inter, Roboto, Arial, and system-ui/-apple-system** as the
  primary typeface. Choose a typeface with character that fits the committed
  aesthetic.
- **Color/background:** ban **purple-on-white gradients** and the generic
  pastel-gradient hero. No "blurple" default.
- **Generic everything:** no unstyled default form controls, no equal-weight
  link soup, no default Bootstrap/Tailwind-starter look left unthemed.

## 3. Steer each axis individually

Make **one deliberate decision per axis** — not a single "vibe" that hand-waves
all four:

| Axis | Decide |
| --- | --- |
| **Typography** | the typeface(s), the weight scale, and the type scale (see hierarchy below) |
| **Color** | one dominant color + a single sharp accent; the neutral ramp; semantic colors |
| **Motion** | duration/easing tokens; what animates (and what must not); reduced-motion respect |
| **Background** | surfaces, depth/elevation strategy, texture or its deliberate absence |

## 4. Hierarchy: extremes, not mush

Weak hierarchy ("broken hierarchy" — the third failure mode) comes from timid,
evenly-spaced choices. Force contrast:

- **Weight extremes** — pair a heavy display weight against a light/regular body;
  avoid a wall of one medium weight.
- **3×+ size jumps** between hierarchy levels (e.g. 48px display vs 16px body),
  not a gentle 18/16/14 gradient that reads as flat.
- **One dominant color + a sharp accent** — the accent is rare and load-bearing
  (a single CTA, a key status), never sprinkled everywhere.
- **Generous, intentional whitespace** as a structural element, not leftover gap.

## 5. Produce evidence, not a verdict

The aesthetic section of the visual contract should contain:

- The **named aesthetic** + mood + audience.
- The **chosen tokens** that encode it (typeface, type scale, dominant+accent
  color, motion durations) — feeding the DTCG token layer (`tokens-dtcg.md`).
- The **ban-list confirmation** as testable criteria for the `test-engineer`.
- Where useful, a **rendered sample** (a key screen) for the arbiter to react to.

Then **stop**. Surface it for the human arbiter at Gate 2 — the decision of
whether it looks good is theirs, never the skill's.
