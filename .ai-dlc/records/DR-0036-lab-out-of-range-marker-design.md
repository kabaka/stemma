<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — lab/vital out-of-range marker (design fork)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0036 |
| `transition`   | `design-fork` |
| `chosen_option`| `approve` |
| `target`       | `main` |
| `unit_of_work` | lab-out-of-range-marker |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-22 |
| `risk_tier`    | high-risk (touches clinical-safety guardrail #1 — reverses a documented "no in/out-of-range flag" decision on the labs/vitals surface) |

## The unit

The maintainer requested that lab (and vital) values falling outside their reference
range be annotated/marked "where appropriate in the UI/reports," explicitly asking that
"all experts' views are considered appropriately." This **reverses a documented decision**:
both `docs/ROADMAP.md:106-107` and repeated code comments (`src/domain/timeline.ts`,
`LabTrend.tsx`, `PrintReports.tsx`, `CcdaReview.tsx`) currently state the surface shows the
value next to the user's own range with **no in/out-of-range flag** because "interpreting a
value against a range is a clinician's job (guardrail #1)."

## The guardrail-#1 question, resolved

`medical-domain-expert` ruling (grounded in FHIR R4 `Observation`, CLSI EP28-A3c / IFCC):
the old comments **conflated two different acts**. A deterministic positional comparison of a
recorded value against the user's **own co-recorded** `refLow`/`refHigh` is the FHIR
`referenceRange` axis — a **factual restatement of two facts the user already holds** — and is
permitted. It is categorically distinct from the FHIR `interpretation` axis (the coded H/L/HH
"abnormal" flag), which is a **clinical assessment** and remains forbidden under guardrail #1
(no manufactured risk number, no probability, no diagnosis). Stemma may state the positional
relationship to the number the user entered; it may **not** inherit a lab's clinical authority
to call a value "abnormal."

The line held in the design: **positional wording only** ("above range" / "below range" /
"within range"), attributed to the user's own range; **never** the interpretation vocabulary
("high" / "low" / "abnormal" / "normal" / "critical" / "elevated" / "flag" / "alert").

## Approved design (from `software-architect` + `medical-domain-expert`)

- **Pure domain primitive** in `src/domain/timeline.ts` (the pure leaf read-model layer; no
  upstream domain consumer — confirmed by import-graph check):
  `type RangePosition = 'within' | 'above' | 'below'` and
  `rangePosition(value: number, refLow?: number, refHigh?: number): RangePosition | undefined`.
  A standalone function was chosen over a derived field on `MeasurementPoint` /
  `MeasurementSeriesSummary` so (1) it also serves `CcdaReview`, which reads the raw
  `Measurement` and not a point; (2) each call site must pass the point's **own** bounds
  inline, making the "never back-apply the latest range to a historical point" invariant
  visible in the calling code; (3) the pure core's `Measurement` recorded-fact type stays
  untouched.
- **Must-fix comparison rules** (all deterministic, unit-tested): strict `<` / `>` only — a
  value **equal** to a bound is `within` (FHIR bounds are inclusive); `Number.isFinite` guards
  on value **and** each bound — never truthiness, since `refLow: 0` is a valid bound; one-sided
  ranges compare only the present bound and say nothing about the absent side; no bound → no
  marker; an inverted range (`refLow > refHigh`, both finite) is incoherent transcription → no
  marker.
- **Per-point computation.** Every surface computes against **that point's** co-recorded
  bounds, never another sample's. `PrintReports` shows only the latest value, so
  latest-value-vs-latest-bounds is correct there.
- **Marker component** `src/ui/components/RangePositionMark.tsx` — mirrors `ProvenanceMark`:
  visible positional **text** ("above range" / "below range"), `null` for `within`. Uses the
  `.badge` pill **shape only** with a single **neutral** treatment (`--text-dim` /
  `mono-dim`-style), **identical for above and below**. Deliberately **not** the
  `SEVERITY_META` red/amber palette: severity color would smuggle the forbidden
  `interpretation` axis back in through hue. Meaning is carried by text, not color (WCAG
  1.4.1) — the strongest form of color-independence.
- **Honest caveat** shown *with* the marker surface (not only in a distant footer): the range
  is the user's own transcription; reference ranges depend on lab/method/age/sex; a value
  outside a range is not by itself a diagnosis; discuss results with a clinician (guardrail #2,
  referral-oriented; guardrail #3, boundary is first-class).
- **Display-only, hard constraint.** `rangePosition` must **never** be imported by or feed
  `patterns.ts`, `screening.ts`, `recommendations.ts`, or any count/severity aggregate. The
  moment it drives advice or a pattern it becomes an engine-formed clinical judgment — a
  guardrail-#1 violation. Structurally enforced: `timeline.ts` is a leaf imported only by UI.
- **Load-bearing comment rewrites (must-fix).** The ~6 "no in/out-of-range flag" comments in
  `timeline.ts` and the top-of-file comments in `LabTrend.tsx` / `PrintReports.tsx` /
  `CcdaReview.tsx` are rewritten to state the now-true narrower rule (positional restatement
  permitted; interpretation / severity / color-only signaling / engine consumption forbidden),
  plus a matching `docs/ROADMAP.md` amendment. Leaving them stale would make the codebase
  self-contradictory. `clinical-safety-reviewer` confirms the revised comments and the exact
  UI strings before merge.

## Alternatives considered

- **Do nothing / keep the "no flag" stance.** Rejected: the maintainer explicitly requested the
  marker, and the expert review found the original blanket prohibition over-broad — it forbade a
  factual restatement the user's own paper lab report already prints.
- **Reuse `SEVERITY_META` (amber "Discuss") coloring for the badge.** Rejected on
  `software-architect`'s point: a severity-keyed color is itself an interpretation signal;
  neutral styling with positional text is safer and still useful.
- **Clinical H/L wording** ("High"/"Low"/"Abnormal"). Rejected: that is the FHIR
  `interpretation` axis / HL7 `ObservationInterpretation` coded vocabulary — a clinical
  assessment guardrail #1 reserves for a clinician.
- **Derived field on the point/summary types.** Rejected — see design rationale above.

## Risk note

Accepted risk: a positional marker could be misread as a clinical "abnormal" verdict.
Mitigations: strictly positional text; neutral (non-severity) styling; the co-located caveat;
display-only isolation from the engine; and the `clinical-safety-reviewer` +
`accessibility-reviewer` gate on the exact strings and styling before merge.

## Review-gate follow-ups (recorded for completeness)

Applied during Construction after the first review pass, all re-approved:

- **Accessibility (`accessibility-reviewer`).** `RangePositionMark` bakes a leading space
  (self-spacing at every call site) so screen readers/copy never read "72 mg/dLabove range"
  (WCAG 1.4.1). The `LabTrend` table wrapper uses `overflow-x: auto` instead of `hidden` so
  wide rows scroll rather than clip (WCAG 1.4.10 Reflow). No blocking failures were found;
  contrast passes in both the dark theme and the print override.
- **Code review (`code-reviewer`).** `CcdaReview` now shows the reference bound whenever
  **either** bound exists (was gated on both), so a one-sided-range marker never appears
  unaccompanied; and it gained the same co-located caveat the other two surfaces carry,
  rendered once when a lab/vital is staged. Test coverage for the marker on the `CcdaReview`
  surface (one-sided high/low, within, no-range, caveat present/absent) was added.
- **Rebase reconciliation.** This unit was rebased onto `origin/main`; upstream #53 had
  removed `LabTrend`'s own `<ClinicalBoundary/>` (it is always embedded in the timeline
  surface, which carries the page-level boundary). Guardrail #3 still holds via that
  page-level boundary plus the marker's own co-located caveat. This record was renumbered
  from DR-0033 to **DR-0036** because 0033 was already taken upstream by the SMART-reconnect
  unit.

## Next gate

`construction-to-merge` (DR-0037).
