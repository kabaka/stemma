<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — <short title>

The artifact the **human arbiter** produces at a phase-transition gate. A gate is
**open only when** a Decision Record exists for that transition with
`chosen_option` set to **`approve`** (the exact canonical value). Absence of a
matching record = closed gate = AI must not proceed. The installed arbiter-gate
hook reads the **machine fields** below; it never makes the decision for you.

Copy this file to your repo (the installer lands it under
`.ai-dlc/templates/artifacts/`), fill every field, and store the completed record
under **`.ai-dlc/records/`** (the path the hook scans; the installer creates it).

## Machine fields (the hook reads these — keep the exact keys and values)

The arbiter-gate hook authorizes a gated action **only** when it finds a record
under `.ai-dlc/records/` whose machine fields satisfy, by **exact value**:

- `transition:` **equals** the gate class for the action, and
- `chosen_option:` **equals** `approve`, and
- `target:` **references the current target** of the action (the branch being
  merged/pushed, the tag being created, or `release`/`deploy`/`operations` for a
  deploy/release/publish). This freshness check stops a stale record from a
  finished unit from authorizing a new transition.

A record with `chosen_option: request-changes` or `reject`, a different
`transition`, or a non-matching `target` does **not** open the gate. Put your
free-text reasoning in `rationale:`, never in `chosen_option:` (the hook matches
`chosen_option` exactly, so "approve, pending X" would NOT be read as approval).

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | <stable identifier, e.g. DR-0001> |
| `transition`   | <one of: `inception-to-construction` \| `design-fork` \| `construction-to-merge` \| `to-operations`> |
| `chosen_option`| <one of: `approve` \| `request-changes` \| `reject` — exact value; a gate opens **only** on `approve`> |
| `target`       | <the action this authorizes: the branch (e.g. `main`), the tag (e.g. `v1.2.0`), or `release`/`deploy`/`operations` for a deploy/release> |
| `unit_of_work` | <id(s) of the unit(s) this decision covers> |
| `rationale`    | <why — your free-text business/technical reasoning as arbiter (NOT in `chosen_option`)> |
| `approver`     | <the human arbiter (one human, the solo model)> |
| `date`         | <YYYY-MM-DD when recorded> |
| `risk_tier`    | <trivial \| standard \| high-risk — makes ceremony depth auditable> |

> Only the **command-level** gates — `construction-to-merge` (merge/push to a
> protected branch) and `to-operations` (tag/publish/deploy/release) — are
> enforced by the hook, because only they take the form of a Bash command. The
> conceptual gates `inception-to-construction` and `design-fork` are
> discipline-only: record them here for auditability, but no hook can block them.

## High-risk addendum (required when `risk_tier: high-risk`)

For high-risk units, also record:

- **Alternatives considered** — the options weighed and why they lost.
- **Risk note** — the explicit risk being accepted and any mitigation.
- Consider promoting the decision to a full ADR (see your project's `docs/decisions/`).

## The four gates

1. **inception-to-construction** — requirements + units of work approved.
2. **design-fork** — architecture/plan approved, before implementation.
3. **construction-to-merge** — the implemented unit approved for integration.
4. **to-operations** — the change authorized for deploy/release.
