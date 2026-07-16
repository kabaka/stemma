---
name: citation-verification
description: The blocking gate that counters hallucinated or fabricated citations before any research report ships — every load-bearing claim is re-fetched, confirmed to exist and to support the claim, then dated and confidence-tagged via a citation ledger. Use when you ask to verify citations or sources, fact-check the references, confirm "are these sources real", check that a quote or statistic traces to its source, or finalize and ship any research deliverable, report, or literature review. Covers the citation-ledger artifact (per claim: claim, source URL, fetched-date, supports yes/partial/no, confidence) and the gate rule that a report can't emit until the ledger is complete and its confidence can't exceed its citations'. Preloaded by the research-synthesizer agent; available on demand to the researcher.
---

# Citation Verification (the gate)

This is a **hardened, blocking gate** — not advice. Before any research deliverable
ships, **every load-bearing claim is independently re-fetched and confirmed** to
(a) exist at a real source and (b) actually support the claim as stated. Then it is
dated and confidence-tagged. Claims that cannot be confirmed are **labeled
"unconfirmed" and never asserted**. The gate exists because fabricated and
misattributed citations are a primary failure mode of LLM research, and a cited
source that doesn't say what you claim is a correctness defect (`AGENTS.md`
priority 1) — as serious as a broken build.

It is owned by `research-synthesizer` and runs on fan-in, after gathering
(`research-method`) and before emit. The `researcher` may load it on demand to
pre-verify its own findings.

## The rule (non-negotiable)

> **No report emits until its citation ledger is complete, and the report's
> confidence may not exceed the confidence of the citations it rests on.**

Two halves, both binding:

1. **Completeness.** Every load-bearing claim has a ledger row with a verdict. A
   missing row blocks the report — you cannot ship a claim you didn't check.
2. **Confidence ceiling.** A claim's assertion strength is capped by its weakest
   supporting citation. If the source only *partially* supports it, the report says
   "partially supported"; if no source confirms it, the report says "unconfirmed."
   The report **cannot be more confident than its evidence.**

A "load-bearing claim" is any statement a reader would act on or that changes the
report's conclusion — facts, figures, quotes, attributions, capability claims,
comparisons, recommendations. Throat-clearing and framing are not load-bearing;
do not pad the ledger, but when in doubt, treat it as load-bearing.

## The citation ledger (the artifact)

The ledger is the gate's evidence. Produce one row **per load-bearing claim**. It is
a structured contract, not prose — keep it exact:

| Field | Required | Meaning |
| --- | --- | --- |
| `claim` | yes | The exact load-bearing statement as it will appear in the report. |
| `source_url` | yes | The specific URL (or precise citation) that supports it. Not a homepage — the page that actually contains the support. |
| `fetched_date` | yes | The date you **re-fetched and read** the source to verify (not when the source was written). |
| `supports` | yes | `yes` / `partial` / `no` — does the fetched source actually support the claim *as stated*? |
| `confidence` | yes | `high` / `medium` / `low` — your confidence the claim is true and correctly attributed, given what you read. |
| `note` | when not `yes` | Why it's `partial`/`no`/low — the gap, the conflict, or the caveat. Required whenever the claim survives in weakened form. |

Example rows:

```text
claim:        "Claude Code skills load context in three progressive levels."
source_url:   https://code.claude.com/docs/en/skills#progressive-disclosure
fetched_date: 2026-06-16
supports:     yes
confidence:   high

claim:        "Tool X shipped feature Y in version 3.0."
source_url:   https://vendor.example/changelog
fetched_date: 2026-06-16
supports:     partial      # changelog shows Y in 3.1, not 3.0
confidence:   low
note:         Source contradicts the version; claim must be corrected to 3.1 or dropped.
```

## The verification procedure

For **each** load-bearing claim, in order:

1. **Re-fetch the source.** Do not trust the gatherer's summary or your own memory —
   open the cited URL and read the relevant passage. Re-fetching is the whole point:
   it is what catches a hallucinated URL or a misremembered quote.
2. **Confirm existence.** If the URL doesn't resolve, doesn't exist, or is a
   plausible-looking fabrication, set `supports: no`, `confidence: low`. **A
   non-existent source can never support a claim.**
3. **Confirm support.** Read the passage. Does it support the claim **as stated**,
   not just the general topic? Topical-but-not-supporting is `partial` or `no`.
   Over-claiming beyond what the source says is a defect — set `partial` and note the
   gap.
4. **Date it.** Record `fetched_date`. For volatile claims (versions, prices,
   "current" state), phrase the surviving claim as true *as of* that date.
5. **Tag confidence** and write the `note` for anything below `yes`/`high`.
6. **Cross-check the consequential ones.** For claims that drive the report's
   conclusion, confirm against a second independent source where feasible (see
   `research-method` on independence).

## Resolving each verdict

| `supports` | What happens to the claim |
| --- | --- |
| `yes` | Assert it, with the citation. Confidence flows from the `confidence` tag. |
| `partial` | **Weaken to what the source actually supports**, or split into the supported part + an "unconfirmed" remainder. Never assert the unsupported portion. |
| `no` | **Do not assert it.** Either drop it, or relabel it explicitly "unconfirmed as of <date>" / "sources conflict." A `no` row may **never** appear in the report as a confident claim. |

"Unconfirmed" is an honest, shippable outcome — surfacing a gap is correct. Asserting
through a gap is the failure this gate prevents.

## Gate semantics (how it blocks)

- **The synthesizer cannot emit the report while any load-bearing claim lacks a
  ledger row.** Incomplete ledger ⇒ gate closed.
- **The report's confidence is the floor of its citations'.** If the conclusion
  rests on a `partial`/`low` claim, the conclusion inherits that hedge — you cannot
  launder weak evidence into a confident finding by aggregating.
- **`no` rows cannot become assertions.** They are dropped or explicitly labeled
  unconfirmed.
- **The ledger ships with (or is referenced by) the deliverable** as its audit
  trail — the human arbiter can see what was checked, when, and how strongly.

This is mechanism #4 in the product's reliability stack: the blocking check that
keeps hallucinated and misattributed citations out of every research deliverable.

## Where this connects

- **The gather/synthesize workflow** this gate sits at the end of:
  `research-method`.
- **Confidence and dating conventions** for volatile claims: `research-method`
  (source-quality and dating sections).
- **Why an unsupported citation is a top-priority defect:** `aidlc-methodology` and
  the correctness principle in `AGENTS.md`.
