# AI-DLC triggering & behavior evals

> **Stemma note.** These are the **kit's original routing/behavior evals**, retained
> as a template for how to verify agent/skill triggering. They reference the *generic*
> AI-DLC roster and bundle-only ADR paths (e.g. `docs/decisions/0005-…`, which does
> not exist here) — **retune them to Stemma's roster before use.** In particular the
> generic roles map to Stemma names: `architect` → `software-architect`, `security` →
> `security-privacy-reviewer`, `documentation` → `technical-writer`, and Stemma adds
> `clinical-safety-reviewer`, `medical-domain-expert`, `medical-coder`,
> `accessibility-reviewer`, `frontend-engineer`. These evals are not wired into
> `npm run check`.

This directory holds the **eval records** for the AI-DLC product's agents and
skills, plus the **manual procedure** for actually running them against a model.

Per [ADR-0005](../../docs/decisions/0005-baked-in-mechanisms-and-two-tier-eval-strategy.md)
there are **two tiers**, and they verify different things:

| Tier | What it is | Runs in CI? | Verifies triggering/behavior? |
| ---- | ---------- | ----------- | ----------------------------- |
| **1 — record linter** | `scripts/validate-evals.mjs` lints these `*.jsonl` records for schema + anti-fakes | **Yes** | **No** |
| **2 — model-in-the-loop evals** | A human runs the records below against a model and grades each | **No** | **Yes** |

> [!IMPORTANT]
> **CI green does NOT mean triggering was verified.** The Tier-1 linter checks
> only that the eval records are *well-formed and honest* — required fields, unique
> ids, no skill-name-in-query, and that every triggering target has both a
> `positive` and a `near-miss-negative`. It never runs a model and makes **no
> behavioral claim whatsoever**. Whether an agent or skill actually fires on a
> realistic prompt — and behaves correctly once fired — is established **only** by
> the Tier-2 manual loop on this page. Do not treat a passing pipeline as proof of
> routing.

## The record files

- `agents-routing.jsonl` — one or more `positive` + `near-miss-negative` per
  consumer-facing **agent** (14 agents).
- `skills-routing.jsonl` — the same for each **trigger-critical skill** (the
  cross-fire-prone ones: design vs planning, review vs RCA, the security lens vs
  the security agent, gather vs synthesize, inline docs vs doc sets, workflow vs
  methodology, etc.).
- `mechanisms-behavior.jsonl` — `behavior` records for the five baked-in
  mechanisms from ADR-0005 (arbiter gate, complexity triage, citation gate,
  don't-edit-the-oracle, phase-handoff contract).

### Record shape

One JSON object per line (JSONL). Blank lines and lines starting with `#` are
ignored, so suites can be annotated.

| Field | Meaning |
| ----- | ------- |
| `id` | Unique identifier across all records. |
| `target` | The agent or skill under test (its directory/frontmatter `name`). |
| `kind` | `positive` (should trigger `target`), `near-miss-negative` (plausible but must route elsewhere), or `behavior` (judge the output once engaged). |
| `prompt` | A realistic consumer request. For the two triggering kinds it **must not name** `target`. |
| `expectation` | The pass criterion a human/judge applies. For `near-miss-negative`, it names the **correct** target. |

## Tier 1 — run the linter (deterministic, CI)

```sh
node scripts/validate-evals.mjs
```

It fails if a record is malformed, an `id` repeats, a triggering prompt names its
target, or a triggering target is missing a `positive`/`near-miss-negative`.
**A pass means the suite is honest and worth running — nothing more.**

## Tier 2 — the manual model-in-the-loop procedure

This is the only tier that establishes whether routing and behavior are correct.
It follows the **"Claude A authors / Claude B tests"** discipline from the
`skill-evaluation` method: the session that *wrote* the descriptions must not also
grade them, or it unconsciously triggers what it knows is meant.

### Two sessions

1. **Authoring session (Claude A).** Whoever wrote/last-edited the agent or skill
   descriptions. Does **not** grade.
2. **Fresh tester session (Claude B).** A clean session — in this repo, the
   Orchestrator dispatches a separate agent — with **no memory** of the authoring.
   This is the honest signal.

### Procedure

For each record:

1. **Set up.** Give the tester session the full consumer roster (all agent and
   skill descriptions) exactly as a real consumer install would expose them. Do
   **not** reveal `target` or `expectation`.
2. **Run the `prompt`** verbatim as if a consumer typed it.
3. **Observe and record what actually happened:**
   - *Triggering records (`positive` / `near-miss-negative`):* which agent was
     delegated to / which skill loaded?
   - *Behavior records:* engage the `target` and capture the output.
4. **Grade with an LLM judge** (a third, separate session is cleanest). Give the
   judge the `prompt`, the observed result, and the `expectation` — **not** the
   author's intent — and ask for a binary pass/fail plus a one-line reason.
   - `positive` passes iff the observed route is `target`.
   - `near-miss-negative` passes iff the observed route is **not** `target`
     (ideally the corrected target named in `expectation`).
   - `behavior` passes iff the output satisfies the `expectation`.
5. **Diagnose failures by layer** (per `skill-evaluation`):
   - A **triggering** miss → a `description` problem; fix in
     `description-engineering` terms (front-loaded trigger, disambiguating
     boundary, literal keywords). **Do not** edit the body.
   - A **behavior** miss → a body/skill-procedure problem. Do not edit the
     description.

### Where to record pass-rates

After each run, append a dated entry to a `results/` log in this directory (create
it on first run), e.g. `results/2026-06-16.md`:

```text
Date: 2026-06-16
Model / harness: <model id>, <how the roster was presented>
Tester session: <fresh / separate agent id>
Judge: <separate session>

Triggering (agents-routing.jsonl + skills-routing.jsonl):
  positives:           28/30 passed
  near-miss-negatives: 25/30 passed
  Failures: architect-near-1 (routed to architect, not planner) — ...

Behavior (mechanisms-behavior.jsonl):
  6/6 passed

Actions: opened <issue/PR> to tune <target>'s description boundary.
```

Track the **pass-rate per target over time** so a description regression (a target
that used to route cleanly and now cross-fires) is visible. These logs — not CI —
are the behavioral record. Re-run after any description edit and before any
release that changes agent/skill descriptions.

## Why this split exists

There is **no model in CI** for this repo, so a CI suite that *claimed* to verify
triggering would be a fake under the repo's delivery rules (ADR-0005, option (d),
rejected). The linter is deliberately honest about its narrow job; the real
behavioral signal comes from a human running Tier 2 and logging the result.
