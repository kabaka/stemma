# The arbiter gate & Decision Record

Detail on the four blocking gates, the Decision Record artifact, and the
blocking-gate semantics. The human is the **sole arbiter** at every gate.

## The four gates

A gate is a phase-transition point where "AI proceeds only after human validation"
takes concrete form. Between gates AI proposes and contests freely; **at** a gate
work is **blocked** until the human records a decision.

| # | Transition | What is approved | Enforcement |
| --- | --- | --- | --- |
| 1 | **Inception → Construction** | Requirements + units of work. | Discipline only — no command to intercept. |
| 2 | **Construction · design fork** | Architecture / plan, *before* implementation. | Discipline only — no command to intercept. |
| 3 | **Construction → merge** | The implemented unit, for integration. | **Hook-enforced** (command-level). |
| 4 | **→ Operations (deploy/release)** | The change, for deployment. | **Hook-enforced** (command-level). |

These are the **only** points where work is blocked pending a recorded human
decision. The two intra-Construction forks (Gate 2 design, Gate 3 merge) are why
Construction has two gates, not one.

**Hook-enforced vs. discipline-only.** Gates **3 and 4** map to concrete commands,
so the installed hook can intercept and block them (see "Enforcement" below). Gates
**1 and 2 are conceptual** — there is no command that marks the Inception →
Construction transition or the design fork, so **the hook cannot reach them.** They
rely on the recorded Decision Record and on the orchestrator's discipline, not on
interception. State this honestly: the methodology gate exists at all four points;
*mechanical* enforcement exists only at 3 and 4.

## Decision Record — fields

The artifact the arbiter produces at each gate:

| Field | Meaning |
| --- | --- |
| `decision_id` | Stable identifier. |
| `transition` | Which of the four gates. |
| `unit_of_work` | The unit(s) this decision covers. |
| `chosen_option` | What the human decided (e.g. "approve plan A", "request changes"). |
| `rationale` | Why — the business/technical reasoning the human owns. |
| `approver` | The human arbiter (one human in the solo model). |
| `date` | When recorded. |
| `risk_tier` | Carries the triage tier (see `triage.md`) so depth is auditable. |

For **high-risk** units, the record additionally carries recorded alternatives and
an explicit risk note (see `triage.md`); consider also writing an ADR.

## Blocking-gate semantics

Methodology meaning (not mechanism):

- A gate is **open only when** a Decision Record exists, under `.ai-dlc/records/`,
  for that transition with `chosen_option == approve`.
- **Absence of a record = closed gate = AI must not proceed.**
- A non-approve record (`request-changes` / `reject` / "do not approve") leaves the
  gate **closed**; the prior phase iterates and a new record is produced.

## Enforcement vs. authority — keep these separate

- **Authority:** the **human is the sole arbiter.** Agents propose and contest;
  they never decide. The record carries the human's reasoning and approval.
- **Enforcement (Gates 3–4 only):** a real **Claude Code hook** (wired by the
  installer) intercepts the **command-level** transitions and blocks them unless a
  matching approve-record exists. It enforces exactly:
  - **Gate 3 (merge/integration):** `git merge`, `gh pr merge`, or `git push` to a
    protected branch (`main`/`master`/`release/*`).
  - **Gate 4 (deploy/release):** `git tag` create, `npm publish`, or `deploy` /
    `release` as a command word.

  Non-transition commands pass through untouched.
- **Enforcement (Gates 1–2):** **none mechanical.** No command marks these
  transitions, so the hook cannot reach them; they rely on the recorded Decision
  Record and orchestrator discipline. Do not claim the hook enforces all four gates.

### What the hook treats as a valid approve-record (Gates 3–4)

A gated command is allowed **only** when a Decision Record under `.ai-dlc/records/`
matches, by **exact value**:

- `transition` == the matched gate class (Gate 3 merge, or Gate 4 deploy/release), **and**
- `chosen_option` == `approve`, **and**
- `target` == the current target — the branch, tag, or release the command acts on.

A stale record, a record for the wrong transition, or a
`request-changes` / `reject` / "do not approve" record does **not** open the gate.

**`jq` is required.** The hook depends on `jq` to read records; if `jq` is absent it
**fails closed** — it denies the command with a remediation message rather than
letting the transition through.

The hook **checks for** the human's decision; it never **makes** one. It is fine to
document **what the hook enforces** — this contract (the gate classes, the matched
commands, the record fields, the jq requirement) — in consumer-facing material; that
is the user's safety guarantee. What stays out of the docs is internal
implementation detail, not the enforced contract. (Rationale and the two-tier eval
strategy: ADR-0005.)
