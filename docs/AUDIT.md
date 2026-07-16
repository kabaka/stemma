# Stemma codebase audit — 2026-07-16

An honest, evidence-anchored assessment of the entire application, commissioned after the
AI-DLC orchestration layer was restored (PR #15). Its purpose is to replace *claims* about the
codebase with *verifiable facts*, so the "rebuild vs. fix-forward" decision is made on evidence.

## Method (so you can trust — or check — every line below)

Six specialist reviewers from the restored review team audited the **full codebase** (not a diff),
in parallel, each required to (a) anchor every finding to `file:line`, (b) give a blunt per-area
verdict, and (c) independently check whether prior `GAP-ANALYSIS.md`/commit claims are actually true
in the code. Reviewers regenerated the catalog, ran the real gate, computed contrast math from
scratch, and — for correctness — **wrote, ran, and deleted disposable tests to prove or disprove each
hypothesis** rather than trust arithmetic. `npm run check` was green throughout (339/339 tests,
92.19% stmt / 80.73% branch coverage). **Green is not the same as correct**: the correctness pass
proved four real defects the suite never exercises.

## Bottom line

**The app is not catastrophic and not "rotten." It is a fundamentally sound core with a cluster of
localized, provable defects — squarely a fix-forward situation, not a rebuild.**

| Lens | Verdict | One-line |
| --- | --- | --- |
| Clinical accuracy | **SOUND** | Criteria faithful to cited guidelines; epidemiology matches its sources to the decimal; **no fabrication found**; guardrail #1 (no risk number) holds in code, not just prose. |
| Security & privacy | **SOUND** | Only network egress is the user-triggered NLM lookup (never PHI); XSS sinks escaped; least-privilege CI. Findings are hardening, not holes. |
| Clinical-safety guardrails | **SOUND** | Guardrails 1/2/4/5, layering, determinism all hold (verified by regeneration + rerun). One real gap: ReportsView has no boundary. |
| Test trustworthiness | **FIXABLE** | Design is honest (no tautologies, no gamed proxies, determinism enforced, conformance validators with teeth). Real coverage gaps, one misleading test. |
| Accessibility | **FIXABLE** | Real tested a11y architecture, AA contrast — but "meaning never by colour alone" is **false for clinical category** on 3 high-traffic surfaces. |
| Correctness | **FIXABLE** (BLOCK) | Four **proven** silent defects reaching the pattern engine; architecture and most logic sound. |

## Recommendation — fix-forward, selectively

Of the three paths you named:

- **Discard to prototype and rebuild — not warranted, and net-negative.** The evidence says the
  expensive-to-get-right parts are *already* right: a pure, deterministic domain core; the five
  clinical-safety guardrails enforced in code; a genuine local-first/no-exfiltration posture; and
  clinical content that a domain expert verified against NCCN/Bethesda/USPSTF with **zero fabrication**.
  A rebuild throws all of that away to escape ~4 localized bugs — and would re-run the same dice on
  the domain logic that currently passes independent clinical review.
- **Retroactive dishonest ADRs — off the table.** Non-negotiable; it poisons the record you're
  trying to make trustworthy. (Honest ADRs documenting decisions made *now*, including that the prior
  process was broken, are a different thing and are welcome.)
- **Fix-forward — the right call.** Every defect below is localized, understood, and independently
  fixable. Most ship-blockers are a bug plus the one test that should have caught it.

This audit report, committed to the repo, *is* the honest map that decision needs.

## Ship-blockers — fix before the next release (P0)

All four proven by a disposable test the correctness reviewer wrote and ran. None is a guardrail
violation (no risk number was manufactured); all are correctness defects in relationship/record logic
that feed the clinically load-bearing pattern engine.

1. **Reload after import silently blanks Patterns & Screening.** `src/store/useStore.ts:129-139,321-322`.
   `migratePersisted()` never re-points `riskRoot`/`tlPerson`/`selectedId` to the rehydrated record, and
   the persist `merge` spreads stale `current` first. Invisible for hand-built trees (proband is always
   `'you'`), but any **GEDCOM import or native restore → close tab → reopen** leaves the vantage pointing
   at a person who doesn't exist; `detectPatterns`/`screeningsFor` hit their `if (!root) return []` guards
   and render **empty, with no error** — looks exactly like data loss. Proved with a true fresh-module
   rehydration (probandId `I1` → `riskRoot` came back `'you'`). *Owner: implementer + test-engineer.*
2. **Half-siblings are labeled "Cousin" everywhere, including clinician-facing print reports.**
   `src/domain/graph.ts:156`. A half-sibling is same-generation with `degree=2`, so it falls through the
   sibling branch into `` `${sp}Cousin` ``. Proved: an actual half-sibling returns
   `{rel:"Paternal Cousin", degree:2, r:0.25}`. `r=0.25` understated as a cousin (`r≈0.125`). No "Half-"
   label exists in the codebase. *Owner: implementer + test-engineer.*
3. **Per-lineage HBOC referral silently downgrades when only one of the proband's parents is recorded.**
   `src/domain/graph.ts:102-113`. `side` is computed only `if (father && mother)`, so recording one
   parent (a normal in-progress state) blanks `side` for the **entire tree**. Proved: an identical
   paternal-lineage breast-cancer cluster yields `severity:'referral'` with both parents recorded but
   silently drops to `'discuss'` with only the father recorded (`side:['—','—']`). This defeats the
   NCCN per-lineage clustering the code's own comments call critical. *Owner: implementer +
   test-engineer; re-review with clinical-safety-reviewer + medical-domain-expert.*

## Full findings by lens (condensed; every item carries its `file:line`)

### Correctness — FIXABLE (BLOCK). Also found beyond the P0s above:
- **[Med-High]** `graph.ts:137-142` — `degree===null` conflates true in-laws with distant blood
  relatives; a great-great-grandparent (`r=0.0625`) and a second cousin (`r=0.03125`) are both labeled
  "By marriage." Contract violation vs. the `Degree` type's own "non-blood" doc.
- **[Med]** `record.ts:279-283` — `isValidUnion` has no referential-integrity check; a crafted native
  backup could smuggle a person as their own parent past validation (cycle guard prevents a hang, so
  no DoS — but it's a silent integrity gap in a boundary the comments claim is hardened).
- **[Low-Med]** `export/gedcom.ts:36-53` — a 3+-parent union silently drops the extra parent with no
  warning (the import path is careful to warn on every lossy step; export isn't).
- **[Low]** `patterns.ts:289` — age-of-onset alerts `slice(0,3)` in record order, not by urgency.
- **Verified clean (hunted, not found):** cycle/self-union termination, deletion+union pruning,
  falsy-zero handling (disciplined — uses `!= null`/`??` with explicit guard comments), export
  determinism, SVG escaping.

### Test trustworthiness — FIXABLE (design sound; gaps concrete)
- **[High]** `graph.test.ts:85-90` — a **misleading test**: titled "respects gender identity in labels"
  but Ray and Maya are the same generation, so the label is `Cousin` unconditionally and gender is never
  exercised. The one genuinely misaligned oracle.
- **[High]** `graph.ts` `relLabel` sibling/uncle/aunt/nephew/niece branches execute (coverage looks high)
  but **nothing asserts them** — swap the `pick()` argument order and all 339 tests still pass. (This is
  exactly why bug #2 above survived.)
- **[High]** `patterns.ts:334-343` `genericRec` + the "Close family" band (`:375`) — patient-facing
  advisory text, **dark end-to-end** (no fixture reaches it).
- **[High]** `useStore.ts` — the five mutator no-op guards and the rehydration happy-path are untested
  (this is why bug #1 survived).
- **[High]** `pedigree-svg.ts` `esc()` + its `dangerouslySetInnerHTML` consumer in `ReportsView.tsx` are
  both untested. `App.tsx`/`Sidebar.tsx` at **0%** (nav, palette toggle).
- Coverage: 92.19% stmt / 80.73% branch. No tautologies, no `.skip`, no gamed proxies, no domain mocking.

### Accessibility — FIXABLE (architecture real; colour-independence broken for category)
- **[High]** Clinical **category** conveyed by colour alone on the pedigree glyph
  (`PedigreeView.tsx:672-675,739-747`), and with **no text alternative at all** in the findings list
  (`PatternsView.tsx:118-129`) and highlight popover (`PedigreeHighlight.tsx:344-366`). The Okabe-Ito
  "colourblind-safe" palette is real but **off by default** (`useStore.ts:132,148`).
- **[High]** `ConditionPicker.tsx:86-99` — a code comment claims a fix "for screen readers **and
  colourblind users**," but the label is `visually-hidden` (SR-only). Asserted-but-not-real.
- **[High]** `components.css:942-951` — primary nav collapses to 5 unlabeled colour-only pills at ~200%
  zoom (no icon fallback). **[Med]** nav "current page" state is colour-only (`:87-90`) though the app's
  own `font-weight:600` fix is used on three other controls.
- **[Med]** Modal doesn't `inert`/`aria-hidden` the background for AT (self-disclosed in ROADMAP:188-192,
  still open). View switches move neither focus nor announcement.
- **Sound:** zero interactive `<div>`s, tested focus trap + restoration, gender shape-encoded per NSGC,
  every measured contrast clears AA (one thin token `--text-faint` at 4.81:1), severity/screening/
  provenance/band colours all paired with text.

### Clinical-safety — SOUND (two real gaps)
- **[Med]** `ReportsView.tsx` renders raw FHIR/Phenopacket/SVG clinical content (incl. a live shaded
  pedigree via `dangerouslySetInnerHTML:227-228`) with **no ClinicalBoundary** — the only on-screen
  analysis surface the prior fix pass never checked.
- **[Low-Med]** `fhir.ts:242` and `phenopacket.ts:138-139` read `new Date()` as a fallback *inside* the
  export function (dormant — every caller injects `now`/`asOfYear` today, but it's the exact rule-8
  footgun; `native.ts` shows the clean pattern).
- Guardrails 1/2/4/5, layering, falsy-zero, and the generated-catalog rule all **verified** (catalog
  regenerated → zero diff).

### Security & privacy — SOUND (hardening only)
- **[Med]** No in-app Content-Security-Policy (defense-in-depth for the two `dangerouslySetInnerHTML`
  sinks, which are currently safely escaped). **[Med]** the honest at-rest caveat lives in README/ARCH
  docs but **not in the running app**. **[Low]** GitHub Actions pinned to mutable tags, not SHAs; no
  `dependabot.yml` for the actions ecosystem.
- Proven clean: single `fetch` (NLM vocab, query-only, no PHI, click-triggered), one partialized
  `localStorage` key, no telemetry/analytics anywhere, GEDCOM export line-injection-safe, import
  prototype-pollution-guarded, `npm audit --omit=dev` 0 vulns, least-privilege CI/deploy permissions.

### Clinical accuracy — SOUND (sensitivity gaps only)
- **[Med]** HBOC engine omits pancreatic + male-breast + Ashkenazi-Jewish NCCN any-age indications
  (`patterns.ts:93-170`) — additive coverage, not wrong. **[Low-Med]** single-relative young-onset
  threshold `<50` with "meets common criteria" wording is slightly broad for the isolated 46–49 case.
- Confirmed against source: Revised Bethesda (PMID 14970275), heritabilities (Mucci 2016, exact
  matches), ICD-10 FY2026 codes valid, premature-CVD thresholds sex-based, screening organ-keyed not
  gender-keyed. **No invented prevalence, criterion, or attribution.**

## Cross-cutting convergences (independent lenses agreeing — the strongest signals)

- **The Reports/Preview surface is the single weakest spot** — flagged by clinical-safety (no boundary),
  test-engineer (SVG→`dangerouslySetInnerHTML` untested), security (wants CSP), and accessibility.
- **`graph.ts` `relationInfo` is both the buggiest module and the weakest-tested** — correctness proved
  three defects there; test-engineer independently found its labels are covered-but-never-asserted and
  its one gender-label test is misleading. Fix the code and the oracle together.
- **The store rehydration path** — a correctness ship-blocker *and* an independently-noted coverage hole.

## Prior-claims verification (the trust question)

| Prior claim | Verdict | Checked by |
| --- | --- | --- |
| `GAP-ANALYSIS.md` is an honest document | **TRUE** | clinical-accuracy + clinical-safety, independently |
| Catalog generated, never hand-edited (0 dropped) | **TRUE** (regenerated → 0-byte diff) | clinical-safety |
| Three guardrail erosions re-asserted | **TRUE** in current code | clinical-safety |
| Least-privilege CI + honest at-rest caveat | **TRUE** | security |
| `npm run check` green, N tests | **TRUE** (reran, 339/339) | multiple |
| Clinical boundary on "every on-screen analysis surface" | **OVERSTATED** — missed ReportsView | clinical-safety |
| "WCAG 2.1 AA" / "colourblind-safe, never colour alone" | **OVERSTATED** — false for category | accessibility |

**Governance finding (important):** `.ai-dlc/records/` contains only its README — **zero historical
Decision Records exist**. No prior "gap addressed"/"guardrail re-asserted" commit went through the
arbiter gate the project's own governing docs call non-negotiable. The *code* those commits produced
mostly checks out on independent review — but "it passed a gate" was never true, and should not be
inferred from an agent-review mention in a commit body. This is the process hole the PR #15 restoration
closes going forward.

## Prioritized remediation backlog

- **P0 (before next release):** the three ship-blockers — store rehydration (#1), half-sibling label
  (#2), one-parent side-blindness (#3) — each with the missing oracle test. `graph.ts:137-142` degree
  mislabel is a strong P0-adjacent.
- **P1:** ReportsView ClinicalBoundary; category colour-independence (apply the app's own text-label
  pattern on the 3 surfaces); the untested `esc()`→`dangerouslySetInnerHTML` chain; export `new Date()`
  fallback removal; `App.tsx`/`Sidebar.tsx` test coverage; nav 200%-zoom fallback.
- **P2:** in-app at-rest caveat + CSP meta; SHA-pin Actions + `dependabot.yml`; HBOC sensitivity
  (pancreatic/male-breast/AJ); union referential-integrity validation; modal `inert`; the misleading
  `graph.test.ts` gender test; `prefers-reduced-motion`.

Each is a self-contained unit of work sized to a bolt. Run them through the restored `/roadmap-task`
loop (the P0/clinical items at standard-to-high tier, with the clinical-safety + medical-domain
reviewers in the gate).

## What this means for the decision

Fix-forward. The foundation the audit could have condemned — the domain engine, the guardrails, the
privacy model, the clinical grounding — is the part that came back **SOUND** under adversarial review.
What's broken is a short, concrete list. That is a codebase to repair, not to burn down.
