<!-- ai-dlc:link-check-ignore-file -->

# Citation ledger — <report title>

The blocking gate's evidence for research deliverables. Produce **one row per
load-bearing claim**. The `research-synthesizer` owns this gate.

**Gate rule:** no report emits until its citation ledger is complete, and the
report's assertion strength can't exceed its citations'. A missing row blocks the
report — you cannot ship a claim you didn't check.

A "load-bearing claim" is any statement a reader would act on or that changes the
report's conclusion — facts, figures, quotes, attributions, capability claims.
When in doubt, treat it as load-bearing.

| Field          | Required        | Meaning |
| -------------- | --------------- | ------- |
| `claim`        | yes             | The exact load-bearing statement as it will appear in the report. |
| `source_url`   | yes             | The specific URL (or precise citation) that supports it — the page that actually contains the support, not a homepage. |
| `fetched_date` | yes             | The date you **re-fetched and read** the source to verify (not when the source was written). |
| `supports`     | yes             | `yes` / `partial` / `no` — does the fetched source support the claim **as stated**? |
| `confidence`   | yes             | `high` / `medium` / `low` — your confidence the claim is true and correctly attributed. |
| `note`         | when not `yes`  | Why it's `partial`/`no`/low — the gap, conflict, or caveat. Required whenever the claim survives in weakened form. |

## Rows

```yaml
- claim:        "<the exact statement as it appears in the report>"
  source_url:   "<specific URL or precise citation>"
  fetched_date: "<YYYY-MM-DD you re-fetched and read it>"
  supports:     yes        # yes | partial | no
  confidence:   high       # high | medium | low
  # note:       "<required when supports != yes or confidence is low>"

- claim:        "<next claim>"
  source_url:   "<...>"
  fetched_date: "<YYYY-MM-DD>"
  supports:     partial
  confidence:   medium
  note:         "<why partial — the gap or conflict; how the claim was weakened>"
```

## Gate checklist

- [ ] Every load-bearing claim has a row with a `supports` verdict.
- [ ] Each source was **re-fetched and read** at `fetched_date` (not trusted from
      memory or a gatherer's summary).
- [ ] No claim asserts more strongly than its weakest supporting citation.
- [ ] Every `partial` / `no` / low-confidence row has a `note`.
- [ ] Volatile claims (versions, prices, "current" state) are phrased as true *as
      of* their `fetched_date`.
