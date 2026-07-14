---
name: observability-practice
description: How to design what to measure and instrument your software so you can tell what it is doing in production — the three signals (metrics, logs, traces) and the correlation that makes them useful, SLIs/SLOs/SLAs and error budgets (Google SRE), and OpenTelemetry as the default instrumentation standard. Use when designing observability, deciding what to measure, instrumenting a service, adding metrics/logs/traces or a trace_id, defining an SLI/SLO/SLA or an error budget, choosing or wiring OpenTelemetry/OTel, or running a pre-release operability check. Do NOT use for the deploy/release/CI-CD/rollback/IaC MECHANICS — that is `delivery-operations` / the `devops` agent. The `observability` agent's playbook.
---

# Observability Practice (design what to measure)

This is the **design** playbook for observability: deciding *what to measure* and
*how to instrument* so that, once the software runs, you can ask "what is it doing
and why?" and get an answer. It owns instrumentation design, the signal model,
SLIs/SLOs/error budgets, and the OpenTelemetry standard.

**Scope boundary — read this first.** This skill is about *design and
instrumentation*. The **deploy-time consumption** of observability — watching a
rollout, wiring alerts into the pipeline, the never-log-secrets deploy check — lives
in `delivery-operations` (the `devops` agent). If your question is "how do I ship
this / roll it back / gate the deploy," go there. If it is "what should this service
emit and what is good enough," stay here.

## The three signals — and why correlation is the point

The conventional framing is the **"three pillars"**: metrics, logs, traces. Treat
"three pillars" as a useful shorthand, **not** the goal. Three *siloed* stores you
query separately is a weak outcome; the value is **correlation** — being able to
pivot from one signal to another about the *same* event.

- **Metrics** — cheap, aggregable numbers over time: request rate, error rate,
  latency (the RED signals for a request path), saturation, queue depth. Best for
  "is something wrong, and how much?" Low cardinality; you alert on these.
- **Logs** — structured, timestamped event records with context. Best for "what
  exactly happened on *this* request?" Emit structured (key/value or JSON), not
  free-text prose you later regex.
- **Traces** — the causal path of one request as it crosses functions and services,
  as a tree of spans with timings. Best for "where did the time go / where did it
  fail across the system?"

**Correlation is what makes them worth the cost.** A `trace_id` stamped on the trace,
carried into every log line for that request, and attached to exemplars on the
latency metric lets you start from a slow-latency spike, jump to the offending
trace, and read the exact log line where it failed — one event, three views. Design
for that: propagate a shared request/trace id through all three signals. Without
correlation you have three disconnected haystacks; with it you have one navigable
story.

## SLIs, SLOs, SLAs, and the error budget (Google SRE)

Measure reliability the way the people experiencing it do. Define these explicitly
(terms per the Google SRE practice):

- **SLI — Service Level Indicator.** A *quantitative measure* of a service aspect,
  expressed as a ratio of good events to total: e.g. "fraction of HTTP requests
  served < 300 ms" or "fraction of requests that return non-5xx." Pick SLIs that
  track what the *user* feels (latency, correctness, availability), not internal
  host trivia.
- **SLO — Service Level Objective.** A *target* for an SLI over a window: e.g.
  "99.9% of requests succeed over 28 days." The SLO is the line that defines "good
  enough." Set it deliberately — 100% is the wrong target; it is unachievable and
  forbids all risk.
- **SLA — Service Level Agreement.** A *contract* with consequences (credits,
  penalties) if reliability falls below an agreed level. The SLA is a business
  commitment and is normally **looser** than the internal SLO, so you breach the SLO
  (your early-warning line) well before you breach the SLA (the one with teeth). Many
  internal services have SLOs but no SLA.
- **Error budget.** `1 − SLO`. If the SLO is 99.9% over 28 days, the budget is 0.1%
  of events allowed to fail. The budget is **the** decision tool: while budget
  remains, you can spend it on shipping change and taking risk; when it is exhausted,
  the rational response is to slow feature rollout and spend effort on reliability.
  This ties directly to deploy decisions (`delivery-operations`): a depleted budget
  is a signal to hold a risky release.

One good SLO with a real SLI beats a wall of dashboards nobody reads. Start with the
critical user journey, define its SLI, set an SLO, and let the error budget inform
how aggressively you ship.

## OpenTelemetry — the default instrumentation standard

**Default to OpenTelemetry (OTel) for instrumentation.** It is the vendor-neutral,
CNCF standard for generating and exporting metrics, logs, and traces with a single
set of APIs/SDKs and a common wire protocol (OTLP). Instrumenting against OTel
keeps you portable across backends — you can change where signals are stored and
visualized without re-instrumenting your code.

- **One standard for all three signals.** OTel models metrics, logs, and traces
  together and propagates context (trace/span ids, baggage) across service
  boundaries — which is exactly the correlation the three-signals section demands.
- **Instrument as you build, not as a retrofit.** Adding instrumentation while the
  code is fresh is far cheaper than reverse-engineering it after an incident. Make
  emitting a span/metric/log part of building the unit of work, the same way tests
  are.
- **Design correlated signals so you can ask new questions later.** Rich, correlated
  telemetry lets you answer questions you didn't anticipate at deploy time *without
  shipping new code* — you query existing high-context data instead of adding a log
  line and waiting for the next release. That is the practical payoff of doing it up
  front.
- **Use auto-instrumentation first, then enrich.** Lean on OTel's
  language/framework auto-instrumentation for the baseline (HTTP, DB, RPC), then add
  hand-written spans and attributes for domain-specific operations that matter to
  your SLIs.

## Pre-release operability checklist (RECOMMENDED, NON-BLOCKING)

Before a unit of work ships, sanity-check that it can be operated. **This is a
recommended self-check, not a hard gate.** It does **not** add a fifth arbiter gate:
the kit's four arbiter gates (Inception→Construction, the design fork, merge, and
deploy/release) are **unchanged**, and nothing here blocks a build or a deploy. Treat
a "No" as a prompt to discuss, not a stop sign.

```text
[ ] (recommended) Critical paths emit the three signals — a trace, a metric, and a
    structured log — correlatable by a shared trace/request id.
[ ] (recommended) At least one SLO exists for the change's key user journey, backed
    by a concrete SLI (a good/total ratio you can actually compute).
[ ] (recommended) Instrumentation uses OpenTelemetry (OTLP export), not a one-off
    vendor-locked shim, so signals stay portable.
[ ] (recommended) No secrets or PII in logs, traces, or span attributes — tokens,
    credentials, and personal data are redacted at the source.
```

If a critical path ships with none of these, say so honestly and let the arbiter
weigh it — but do not convert this checklist into a blocking gate.

## Where this hands off

- **Deploy-time consumption** — watching the rollout, wiring these alerts into the
  pipeline, the never-log-secrets deploy check, rollback triggers tied to SLO
  breaches → `delivery-operations` (the `devops` agent). This skill designs the
  signals; that skill consumes them at release time.
- **A failed deploy or production incident** → `debugger` for RCA
  (`rca-investigation`); good observability is what makes that RCA fast.
- **Secrets / PII handling depth** (what counts as sensitive, redaction strategy) →
  `security-review`; this skill only states the never-log-secrets rule.

## Cross-references

- Deploy/release mechanics, rollback, CI/CD, IaC, the deploy arbiter gate:
  `delivery-operations`. Lifecycle and the four gates: `aidlc-workflow`. Concepts:
  `aidlc-methodology`.
- Adjacent skills: `delivery-operations` (consumes these signals at deploy time),
  `rca-investigation` (post-failure diagnosis), `security-review` (secrets/PII).
