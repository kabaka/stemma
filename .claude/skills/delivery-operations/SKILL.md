---
name: delivery-operations
description: The Operations-phase playbook for shipping your software — deploy, release, infrastructure-as-code (IaC), CI/CD pipelines, and rollback — all under the human arbiter's deploy authorization. Use when deploying or releasing a change, building or fixing a CI/CD pipeline, writing or reviewing infrastructure/IaC (Terraform, containers, manifests), wiring deploy-time alerts and watching a rollout, planning a rollback, running a pre-deploy checklist, or asking "is this safe to ship / who approves the deploy / how do I roll this back?". For instrumentation, SLI/SLO/error-budget, and OpenTelemetry DESIGN, see `observability-practice`. Operations has NO mob ceremony — it is standing human oversight plus a per-change deploy Decision Record. The devops agent's playbook. For the full lifecycle and the four arbiter gates, see `aidlc-workflow`.
---

# Delivery & Operations (the Operations phase)

This is the operating procedure for the **Operations** phase of AI-DLC: getting a
built, merged unit of work *running* in front of users and keeping it healthy —
deploy, infrastructure-as-code, CI/CD, release, monitoring, and rollback. It owns
the *how* of shipping; the orchestrator (`AGENTS.md`) only summarizes it. For the
whole lifecycle and where Operations sits, read `aidlc-workflow`; for concepts
(phases, the arbiter principle), read `aidlc-methodology`.

**Operations has no mob ceremony in AI-DLC — human oversight is the constant.**
There is no "Mob Operations." Instead there is **standing human oversight** plus
**one blocking gate per change: the deploy/release Decision Record** (Gate 4). Do
not invent a ceremony here; the discipline below *is* the practice.

## The deploy arbiter checkpoint (Gate 4 — blocking)

Every deploy/release is the fourth and final arbiter gate. **The change is
authorized for deployment only when a Decision Record with `chosen_option =
approve` exists for it.** Absence of a record = closed gate = do not deploy. You
(the AI) prepare, propose, and contest; **the single human is the sole arbiter who
authorizes the release.** Enforcement is the real installed hook (see `CLAUDE.md`
and `aidlc-workflow`) — never deploy on the honor system.

The deploy Decision Record carries the standard fields (`decision_id`,
`transition` = deploy/release, `unit_of_work`, `chosen_option`, `rationale`,
`approver`, `date`, `risk_tier`). Right-size by `risk_tier` (see
`aidlc-workflow` triage), but **never skip the gate**:

- **Trivial** (reversible, narrow — e.g. a copy fix behind a flag): the record may
  be terse; the human may approve inline after a green pipeline.
- **Standard**: full pre-deploy checklist, the human reviews the plan + rollback
  path, records approve.
- **High-risk** (irreversible migration, data-loss risk, broad blast radius): the
  human records options considered and the rollback/abort plan explicitly; pull in
  `security` if it touches auth/crypto/secrets/another machine (see
  `security-review` for the escalation boundary); consider an ADR.

## Pre-deploy checklist (copy into your notes per release)

Run this before requesting the Gate 4 Decision Record. Stop and fix on any No.

```text
[ ] The unit cleared Gate 3 (merge) — code-reviewer approved, oracle tests green.
[ ] CI is actually green on the exact commit being deployed (not a stale run).
[ ] Build artifact is reproducible and pinned (image digest / lockfile), not "latest".
[ ] IaC change reviewed; a plan/dry-run was produced and read (e.g. terraform plan).
[ ] Config & secrets for the target environment exist and are sourced from the
    secret store — never hardcoded, never committed. (security-review if in doubt.)
[ ] Migrations are backward-compatible OR sequenced (expand → migrate → contract);
    a tested rollback/abort path exists.
[ ] Rollback plan is written and rehearsed: exact command/steps + how long to recover.
[ ] Observability is in place for what's changing — logs, a metric, an alert that
    would actually fire on this failure mode.
[ ] Blast radius understood: who/what breaks if this is wrong; is it behind a flag
    or a progressive rollout?
[ ] (recommended, non-blocking) license/SBOM compliance reviewed — see `dependency-compliance`.
[ ] Deploy Decision Record drafted (risk_tier set) and ready for the human arbiter.
```

If the change runs on another machine, touches auth/crypto/secrets, MCP config, or
untrusted input — **escalate to `security` before the gate** (see `security-review`).

## Release & rollback discipline

Default to **reversible, observable, incremental** releases. The recommended
default is a progressive rollout behind a flag or staged traffic; a big-bang deploy
is the exception, reserved for changes that genuinely cannot be split and only with
high-risk-tier sign-off.

- **Forward-only where you can, reversible where you can't.** Prefer additive
  changes (feature flags, expand/contract migrations) so a problem is a flag flip,
  not an emergency.
- **One change at a time.** Don't bundle an unrelated migration with an app deploy;
  a coupled rollback is a failed rollback.
- **Define "rolled back" before you ship.** The rollback plan names the trigger
  (what metric/error, what threshold), the command, and the recovery-time
  expectation. A rollback you haven't rehearsed is a hope, not a plan.
- **Migrations are the sharp edge.** Use **expand → migrate → contract** so old and
  new code coexist during rollout; never deploy a schema change that makes the
  currently-running version crash. Destructive/irreversible migrations are
  high-risk — they require the explicit options-considered Decision Record.
- **After rollback, diagnose before retry.** A failed deploy is an incident: hand
  it to `debugger` for post-failure RCA (see `rca-investigation`) before the next
  attempt. Don't re-deploy the same artifact hoping it sticks.

## Infrastructure-as-code (IaC) & CI/CD

**Infrastructure is code — it crosses the same gates as application code.** An IaC
or pipeline change is a unit of work: it goes through Construction (design, plan,
review) and its deploy crosses Gate 4. Do not treat infra edits as out-of-band.

- **Declarative and version-controlled.** All infra in the repo (Terraform/OpenTofu,
  Pulumi, k8s manifests, Helm, Dockerfiles). No click-ops drift; the repo is the
  source of truth.
- **Plan before apply.** Always produce and read a dry-run/plan
  (`terraform plan`, `kubectl diff`, `helm --dry-run`) and put it in front of the
  human before apply. An unread plan is an unapproved change.
- **Pin everything.** Image digests, action/runner versions, provider and module
  versions, dependency lockfiles — pin to a tag or SHA, never a moving branch or
  `latest`. (This is also a supply-chain control — see `security-review`.)
- **Least privilege for the pipeline.** CI credentials and deploy roles get the
  minimum scope to do the job; secrets come from the platform's secret store /
  OIDC, never committed. Flag any pipeline that can do more than it needs.
- **CI is the merge precondition, not the deploy gate.** Green CI is necessary but
  **not sufficient** to deploy — the human's Gate 4 Decision Record is. CI proves
  the build and tests; the arbiter authorizes the release.
- **Idempotent, fail-loud pipelines.** Re-running a job must not corrupt state;
  steps fail visibly and stop the pipeline rather than swallowing an error and
  shipping a broken artifact.

## Consuming observability at deploy time

This skill **consumes** signals at release time; it does not design them. For
instrumentation, the three signals and their correlation, SLI/SLO/error-budget
design, and OpenTelemetry, see `observability-practice`. At deploy time:

- **Watch the rollout.** During and just after deploy, watch the signals that would
  reveal *this* change failing; that watch window is what makes the rollback
  decision real rather than reactive. Tie the rollback trigger to a concrete SLO
  breach (defined in `observability-practice`), not a gut feel.
- **Wire alerts into the pipeline.** Alert on symptoms users feel — error-rate and
  latency SLO breaches over noisy host metrics — and connect those alerts to the
  deploy/rollback path so a breach during the watch window is actionable. An alert
  that never fires or always fires is dead weight; tie each to a runbook action.
- **Never log secrets or PII (deploy check).** Confirm the change does not emit
  credentials, tokens, or personal data into logs or traces before you ship; this is
  a pre-deploy verification, not an instrumentation-design task (see
  `security-review`).

## Where Operations hands off

- **Pre-merge / code quality** belongs to Construction (`code-review`), not here —
  Operations runs what Construction already approved.
- **A failed deploy or production incident** → `debugger` for RCA
  (`rca-investigation`); fix flows back through Construction, then a fresh Gate 4.
- **Security-sensitive surface** (auth, crypto, secrets, another machine, MCP,
  untrusted input, or a High+ finding) → escalate to `security` (`security-review`).

## Cross-references

- Lifecycle, the four arbiter gates, Decision Record schema, triage:
  `aidlc-workflow`. Concepts: `aidlc-methodology`.
- Adjacent skills: `code-review` (pre-merge gate), `rca-investigation`
  (post-failure diagnosis), `security-review` (the security lens + escalation
  boundary), `conventional-commits` (release/changelog hygiene).
