<!-- ai-dlc:link-check-ignore-file -->

# Decision Records — Stemma's arbiter gates

This directory holds the **Decision Records** the maintainer (the sole **arbiter**)
produces at the AI-DLC phase-transition gates. A gate is **open only when** a record
for that transition exists with `chosen_option: approve`. Absence of a matching
record = closed gate = the AI must not proceed. See [`AGENTS.md`](../../AGENTS.md)
and the `aidlc-workflow` skill for the full contract.

## Stemma runs the gates as documented discipline (no wired hook)

The AI-DLC kit ships a fail-closed `jq` git-hook that mechanically blocks
merge/push/tag/publish until a matching record exists. **Stemma does not wire it.**
As a solo maintainer on a local-first static site you own your own `git` and publish
commands, so the gate is honored by **discipline plus the committed record**, not by
intercepting the command. The hook script is kept for reference under
[`../../.claude/templates/hooks/`](../../.claude/templates/hooks/) if you ever want
to enable mechanical enforcement — but the record is what matters, and it is still
**required**, never optional.

## The four gates

1. **`inception-to-construction`** — requirements + units of work approved.
2. **`design-fork`** — architecture/plan approved, before implementation.
3. **`construction-to-merge`** — the implemented unit approved for integration.
4. **`to-operations`** — the change authorized for release/publish (the Vite build
   → GitHub Pages deploy).

## How to record one

Copy [`../../.claude/templates/artifacts/decision-record.md`](../../.claude/templates/artifacts/decision-record.md),
fill every field, and save it here as `DR-NNNN-<short-title>.md`. Keep the machine
fields (`transition`, `chosen_option`, `target`, `risk_tier`) as exact values so the
record stays auditable (and hook-readable, should you ever enable the hook). Put
free-text reasoning in `rationale`, never in `chosen_option`.

**Right-size, never skip.** Complexity triage scales the *ceremony depth* — a trivial
unit's record may be a couple of terse lines; a high-risk unit (anything touching the
clinical-safety guardrails) records alternatives considered and a risk note, and may
graduate to an ADR under [`../../docs/`](../../docs/). But every unit crosses a gate:
triage reduces challenge, never the arbiter decision.
