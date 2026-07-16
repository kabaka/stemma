# The three phases, in depth

AI-DLC moves a **unit of work** through three phases. AI drives the work inside each
phase; you arbitrate at the boundaries. You do not run the whole project through one
phase at a time — each unit of work flows through Inception → Construction →
Operations on its own bolt cadence, and units run in parallel.

This file defines *what each phase is* and *what comes out of it*. For the
step-by-step procedure of running a phase, see the **`aidlc-workflow`** skill.

## Inception — WHAT / WHY

The phase that turns fuzzy intent into a buildable plan for **your** product.

- **What AI does:** takes your business intent and turns it into concrete
  **requirements**, then decomposes them into **units of work** sized to be built in
  parallel within a bolt. AI surfaces the assumptions it is making and the open
  questions it needs you to answer — it does not paper over ambiguity.
- **Ceremony — Solo Mob Elaboration:** specialist agents propose the requirements and
  units of work and contest each other's reading of your intent (a second analyst
  pass, an adversarial challenge). You answer the clarifying questions and validate.
  This is where ambiguity is resolved *before* anyone builds.
- **What comes out:** agreed requirements and a set of **units of work**, each with
  its Unit-of-Work contract (see `bolts-and-units.md`), signed off by you. That
  sign-off is the **Inception → Construction** arbiter decision point.

## Construction — HOW

The phase that turns an agreed unit of work into working software.

- **What AI does:** proposes a **logical architecture** and **design**, then writes
  the **code** and **tests** — including security and resilience concerns — and any
  **infrastructure as code**. AI proposes and builds; it does not unilaterally decide
  the design or merge its own work.
- **Ceremony — Solo Mob Construction:** specialist agents propose the architecture,
  plan, implementation, and tests, and red-team each other's choices (dual planners,
  an adversarial reviewer, a security pass, a code review). You validate the technical
  decisions and decide.
- **Two arbiter decision points sit inside this phase:**
  - the **design fork** — you approve the architecture/plan *before* implementation
    begins, and
  - the **merge** — you approve the implemented unit *before* it is integrated.
- **What comes out:** an implemented, tested unit of work (with its IaC), approved by
  you for integration.

## Operations — run it

The phase that deploys, runs, and observes the change.

- **What AI does:** manages **deployment**, **infrastructure**, and **monitoring**,
  applying the context accumulated across the unit's lifecycle, while you keep
  oversight. Incidents route to root-cause analysis.
- **No ceremony.** The methodology names no mob ceremony for Operations, and the team
  invents none. Operations is governed by **standing human oversight**, not a
  ceremony — the constant is you watching, not a scheduled gathering.
- **Arbiter decision point:** the **deploy/release authorization** — you authorize
  each change for deployment.

## How the phases connect

The phase boundaries are exactly the arbiter decision points: Inception ends when you
approve requirements and units of work; Construction has an internal design gate and
ends at the merge approval; Operations begins when you authorize the deploy. Between
those gates, AI works freely. See `ceremonies-and-arbiter.md` for the decision points
and the Decision Record they produce.
