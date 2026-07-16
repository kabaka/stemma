# Bolts and units of work

AI-DLC renames two Agile concepts to reflect an AI-accelerated cadence. Use these
terms consistently when you talk about your own work.

## Bolt (replaces *sprint*)

A **bolt** is the AI-DLC cadence: an intense work cycle measured in **hours to days**,
not weeks. You scope a unit of work "to a bolt."

**A bolt is an intent and a vocabulary, not an enforced timer.** The methodology names
the cadence but prescribes **no machinery** that cuts work off at a deadline — there
is no bolt-timer, burndown, or automatic cutoff in AI-DLC. So in practice a bolt is:

- the **intended hours-to-days window** you record for a unit of work
  (`bolt_time_box` on its contract, below), and
- the **vocabulary** you use to talk about cadence ("this bolt", "scoped to a bolt").

If you ever want a hard timer or cutoff, that is an **extension you add** — label it
as such. It is not part of the methodology, and you should not assume the kit enforces
one.

## Unit of Work (replaces *epic*)

A **unit of work** is the output of Inception: a **parallelizable chunk of value**,
sized to fit a bolt. It is the thing that flows through the three phases, and it is
the **Inception → Construction handoff** — Construction consumes exactly what
Inception produced. Treat it as a real artifact, not a loose phrase.

### The Unit-of-Work contract

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Stable identifier for the unit. |
| `title` | yes | One-line name of the value delivered. |
| `scope` | yes | What is in this unit — the WHAT, concretely. |
| `acceptance_criteria` | yes | Testable conditions that define "done"; they drive the tests. |
| `non_goals` | yes | What is deliberately excluded — prevents scope creep; keeps the unit parallelizable. |
| `dependencies` | yes (may be empty) | Other units this one needs; supports parallelization decisions. |
| `bolt_time_box` | yes | The intended bolt window (hours–days). A planning intent, not a gate. |
| `risk_tier` | yes | trivial / standard / high-risk — sets ceremony depth (see `ceremonies-and-arbiter.md`). |
| `arbiter_signoff` | yes | Reference to the Inception Decision Record approving this unit. |

`non_goals` is what keeps a unit "sized to be parallelizable" — an explicit boundary
so two units don't grow into each other. `dependencies` is what lets you run units in
parallel safely. `risk_tier` and `arbiter_signoff` connect the unit to the ceremony
depth and the decision points described in `ceremonies-and-arbiter.md`.

## Agile mapping

| Traditional Agile | AI-DLC term | Key shift |
| --- | --- | --- |
| Sprint | **Bolt** | Weeks → hours/days |
| Epic | **Unit of Work** | Sized for parallel, AI-driven development |
