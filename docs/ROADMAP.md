# Stemma — Productionalization & Product Roadmap

This is the plan of record. It captures what the productionalization cycle delivered,
what remains, and how the product grows from here. It synthesizes the product vision in
[`../prototype/uploads/Lineage-expansion-ideation.md`](../prototype/uploads/Lineage-expansion-ideation.md)
(referenced below as **ideation §N**) into sequenced, buildable work.

Development is **AI-driven (AI-DLC)**: there is no human engineering team. The maintainer
drives AI agents against this roadmap. See [`AI-DLC.md`](./AI-DLC.md) for the development
model and the skills/agents that support it, and [`ARCHITECTURE.md`](./ARCHITECTURE.md)
for the technical design and decision log.

---

## 1. Where the prototype started

The prototype (`prototype/`) was a single 1,700-line `.dc.html` file running on Claude's
internal `dc-runtime` (a React engine driven by `<x-dc>` templates and `{{ }}` bindings) —
not a buildable, testable, or deployable app. Notably, it was already conceptually
advanced: a Person-graph data model, a hereditary-**pattern** detector (not a fabricated
risk number), gender-inclusive identity with an organ inventory, provenance tags, and
even FHIR/Phenopacket export. The job of productionalization was therefore less "invent
the app" and more "get it onto a real, maintainable, deployable footing and split the
monolith into typed, tested modules."

## 2. What this cycle delivered (Flow 1)

| Area | Status | Notes |
| --- | --- | --- |
| Framework | ✅ | React 18 + TypeScript (strict) + Vite 5; off the `dc-runtime` entirely. |
| Architecture | ✅ | Layered: pure `domain/` engine, `data/`, `integrations/`, `export/`, `import/`, `store/`, `ui/`. See ARCHITECTURE.md. |
| Domain port | ✅ | Kinship math, the pattern engine, screening, catalog — ported to typed modules, part of a **202-test** suite. |
| Condition catalog | ✅ | 115 curated conditions generated from the prototype + **verified ICD-10-CM** (23 high-signal) & SNOMED codes. |
| Long-tail vocabulary | ✅ | `VocabularyProvider` port + NLM Clinical Tables provider (CORS, no key) — the app is **not** capped at 115 conditions. |
| Standards export | ✅ | FHIR R4, Phenopacket v2, GEDCOM 5.5.1, pedigree SVG — all generated client-side. |
| Linting / formatting | ✅ | ESLint 9 (flat) + Prettier; `npm run check` is the gate. |
| Tests | ✅ | Vitest + Testing Library; 229 tests across domain, store, exports, imports, integrations, and UI. |
| CI/CD | ✅ | GitHub Actions: `check` + build on PRs; Pages deploy on `main`. |
| GitHub Pages | ✅ | Static build with the correct `base`; deploy workflow in place. |
| LICENSE | ✅ | MIT. |
| README / docs | ✅ | README, CONTRIBUTING, ARCHITECTURE, this ROADMAP. |
| Language cleanup | ✅ | "illustrative risk" framing replaced with the honest "organizing tool, not a diagnostic device" boundary as a first-class UI element. Renamed the product to **Stemma**. |

**Deliberately deferred** (documented, not built): a backend / sync, e2e-encrypted
multi-tenant hosting, live CanRisk/PubMed calls (CORS/licence-gated), record import
(OCR/FHIR-pull/DNA — GEDCOM-in has since shipped, see Phase 3 below), and the AI
summarization layer. These are the roadmap below.

## 3. Product roadmap

Sequenced so each phase is cheap after the one before it and expensive before it
(ideation §10). Phase 0 is done; the rest is AI-DLC work.

### Phase 0 — Production foundation ✅ (this cycle)
Real app, tested engine, exports, CI/CD, deploy, docs.

### Phase 1 — Trustworthy core ✅
- ✅ **Prevalence & heritability bound to sourced epidemiology** (ideation §3). The
  high-signal set's `base` values are now bound to published surveillance (CDC / SEER /
  NHANES / AHA / IHME) carrying a `prevSource` citation, and heritability (`herit`) is
  carried as a **cited population statistic, never a personal-risk number**. A
  data-provenance field (`prevSource` / `heritSource`) was added to `Condition`; the long
  tail stays illustrative and is labeled as such. Sourced via the `medical-domain-expert`.
- ✅ **Broadened coded coverage.** ICD-10-CM and SNOMED CT are now baked in for **72**
  conditions (was 23), plus **32 HPO** terms (open, redistributable) wired into the
  Phenopacket export for the genetics audience. All codes verified against live authorities
  (ICD-10-CM FY2026, SNOMED CT via `tx.fhir.org`, HPO via EBI OLS4) by the `medical-coder`.
- ✅ **Onset/provenance surfaced in the UI** (ideation §6). Each affected relative's record
  provenance (self-reported / records-confirmed / death-certificate) now shows in the
  pattern flags and per-condition findings — qualitative weighting, never a number —
  alongside onset, with a per-flag "Sourcing" summary.
- ✅ **Export layer tested against validators.** Self-contained FHIR R4 and Phenopacket v2
  conformance validators assert every export against the standards' structural rules (bound
  value sets, datatype formats, CURIE/reference integrity), each with negative controls.

### Phase 2 — Pedigree & records depth
- **Full 2022 NSGC pedigree** (ideation §5): union nodes, multiple partners, half-siblings,
  consanguinity (double line), adoption/donor (social vs genetic parent), twins (mono/di).
  Pan/zoom/collapse over a real graph.
- **Timeline upgrades** (ideation §6): attach documents/labs, medication start/stop with a
  derived "currently taking" list, numeric lab trends with reference ranges, allergies,
  immunization record, vitals.
- **Append-only history** with a visible "what changed" diff.
- **Care coordination**: screenings as a schedule with overdue flags, calendar export
  (`.ics`), and a printable "bring to your appointment" sheet.

### Phase 3 — Import pipelines (kill the retyping)
- **GEDCOM import** ✅ (ideation §4) — reuse an existing family tree for the relationship graph.
  Shipped as `src/import/` (`parseGedcom` + `buildRecordFromGedcom`), the inverse of the export
  layer. Scope is structural only — people and the parent/child graph; a genealogy file carries no
  health data, so conditions are still entered in Stemma after import. See
  [ARCHITECTURE.md §9](./ARCHITECTURE.md#9-the-import-layer) and
  [ADR-008](./ARCHITECTURE.md#adr-008--gedcom-import-is-structural-only-via-a-new-import-layer).
- **FHIR pull** from a patient portal / Apple Health (SMART on FHIR) (ideation §4).
- **Record OCR/parse** for uploaded documents (ideation §6).
- **Consumer DNA raw-file parse**, heavily caveated (ideation §3).

### Phase 4 — Validated risk depth (opt-in)
- Wire the external calculators the UI already points at: **CanRisk/BOADICEA**
  (licensed web-services key), **PREMM5/Amsterdam II**, **ASCVD/FH** (ideation §2). Always
  output absolute risk with a confidence range — never a bare multiplier. These need a
  backend proxy (keys, CORS) → Phase 5.

### Phase 5 — Backend, sync & the AI layer (self-hosted deployment)
- **Pluggable storage adapter #2**: an end-to-end-encrypted, zero-knowledge, per-person
  vault sync service (ideation §7, §8). Same UI and export layer over both backends.
- **Explicit, revocable proxy access** (partner emergency read) (ideation §7).
- **Local RAG AI layer** (ideation §8): summarize a history, draft a new-patient
  family-history form, prep appointment questions — grounded in the user's own data plus
  **PubMed** for citations, advisory and cited, never diagnostic, and never emitting a risk
  value the deterministic engine did not produce.

## 4. Third-party integration status

| Source | Use | Runtime-reachable from the static app? | Status |
| --- | --- | --- | --- |
| NLM Clinical Tables (ICD-10-CM) | Long-tail condition search | ✅ CORS, no key | **Live** |
| ICD-10-CM / SNOMED CT | Coded catalog | Baked in at authoring time | **Live (subset)** |
| HPO / Orphanet / OMIM | Genetics vocabulary | Baked in | **Live (HPO)** — Orphanet/OMIM deferred |
| IHME GBD / CDC | Prevalence & heritability | Baked in | **Live (high-signal subset)** |
| FHIR (portals, Apple Health) | Import & export | Export ✅; import needs SMART auth | Export live / import Phase 3 |
| GA4GH Phenopacket / Pedigree | Genetics export | ✅ client-side | **Live** |
| GEDCOM / GEDCOM X | Genealogy interchange | Export ✅; import ✅ (GEDCOM 5.5.1, client-side) | **Live** |
| RxNorm / openFDA / DailyMed | Medication normalization | Needs proxy | Phase 2–3 |
| CanRisk, PREMM5, ASCVD | Validated risk models | Needs backend (keys/CORS) | Phase 4 |
| PubMed | Evidence for the AI layer | Needs backend | Phase 5 |
| NPI Registry | Attach verified clinicians | Public API | Phase 2 |

**Design rule:** the app depends on *ports* (`src/integrations/`), not concrete services.
The static build ships client-safe providers; a self-hosted build can inject fuller ones
(a terminology server, a keyed calculator proxy) without touching the UI or engine.

## 5. Clinical-safety guardrails (non-negotiable)

These constrain every phase and are enforced in code and review:

1. The engine reports **patterns and referral criteria**, never a manufactured risk number.
2. Any AI/advice output stays **advisory and cited**, and may never emit a risk value the
   deterministic engine did not produce.
3. "Organizing tool, not a diagnostic device" is a **first-class UI element**, not a footer.
4. **No lock-in**: every record is exportable to an open standard. A personal health record
   must outlive the app.
5. **Local-first / private by default**: data stays in the browser; the only runtime network
   call is the optional vocabulary lookup.

## 6. Known cleanups / tech debt

- Prevalence `base` values are sourced for the high-signal set (Phase 1: a `prevSource`
  citation marks each bound value); the long tail remains illustrative until later passes.
- The seed record is fictional demo data; a first-run "start empty" path should be added.
- `prototype/` is retained for reference (screenshots, ideation doc); the catalog generator no
  longer depends on it (`scripts/conditions.source.json` is the source), so it can be pruned.

## 7. Review-driven follow-ups

Deferred items surfaced by the specialist review panel (architecture, medical, security,
accessibility, testing) — captured here so nothing is lost:

- **Long-tail codes don't yet drive detection** (Phase 3 enabler). A condition attached via ICD-10
  vocabulary search resolves to `cat:'other'` and does not count toward, e.g., the HBOC breast
  tally. Add a code→curated-concept alias so imported/coded data participates in the pattern engine.
- ✅ **HBOC now counts same-lineage** (Phase 1). NCCN family-history criteria are per-side, so
  the breast-cancer clustering trigger now counts relatives on the same lineage (maternal /
  paternal); 2+ breast cancers that don't concentrate on one recorded side downgrade to "discuss"
  with a prompt to record the side. Ovarian (any age) and breast < 50 stay side-independent
  referral triggers. **The same-lineage refinement was confirmed against NCCN v1.2025 by the
  medical-domain-expert** (footnote "o": close relatives are counted "on the same side of the
  family"), and the "discuss"-branch recommendation text was made severity-aware so it no longer
  says "meets criteria" (guardrail #1).
- **HBOC criteria sourcing & ancestry** (Phase 1, from the same sign-off). Cite the young-onset and
  same-side branches as referral *screening* thresholds, not "NCCN testing criteria met": Stemma
  flags breast cancer `< 50` (strict NCCN single-relative young-onset is `≤ 45`) and same-side `≥ 2`
  (strict NCCN is a `≥ 3` same-side aggregate) — both slightly more sensitive, erring toward safety.
  - ✅ **Pancreatic + male breast cancer** any-age NCCN indications added (audit-remediation cycle;
    NCCN Breast/Ovarian/Pancreatic v2.2026, `medical-domain-expert`-reviewed). Male breast is keyed
    on sex-assigned-at-birth, never gender (guardrail #4).
  - **Ashkenazi-Jewish ancestry** as an any-age BRCA testing indication remains **deferred** — it
    needs a new `Person.ancestry` data axis (schema + PersonForm UI + persistence + export), a
    high-risk unit with its own Decision Record and `security-privacy-reviewer` pass; it is
    deliberately **not** bolted onto the audit fixes (see [`AUDIT.md`](./AUDIT.md)).
  - **Male-breast ICD dual-coding**: the catalog `brca` entry carries the female-specific `C50.919`;
    a male-sab breast-cancer case should dual-code to the `C50.92x` family in FHIR/Phenopacket
    exports. Catalog/export follow-up — the engine is unaffected (keys on id + sab).
  - Optional refinement: gate the *pancreatic-only, unaffected-proband* referral to "discuss" unless
    the pancreatic relative is first-degree (NCCN qualifies only first-degree there); the engine
    currently errs toward referral, which is the safe direction for decision-support.
- ✅ **Lynch spectrum broadened** (Phase 1). Ovarian and upper-urinary-tract (renal pelvis /
  ureter urothelial) cancers now count toward the Lynch-spectrum tally. Ovarian intentionally
  seeds both HBOC and Lynch (different genes/pathways — a genetics evaluation disambiguates), with
  a dual-pathway caveat in the flag; upper-tract is a distinct catalog entry (`utuc`, C65/C66),
  kept separate from renal-cell (`kidneyca`) and bladder cancer.
- **Async storage seam before Phase 5.** Every store mutation is synchronous; a zero-knowledge
  remote vault is async. Design the repository/adapter interface (async hydrate/commit) before the
  backend, not after — the sync→async shift is the real work, not the storage bytes.
- **AI layer must consume the typed engine outputs** (`PatternFlag`/`FamilyFinding`), never
  re-derive from free text, to keep the "no number the engine didn't produce" guard enforceable.
- ✅ **GitHub Actions pinned to commit SHAs** (audit-remediation cycle), with a `dependabot.yml`
  for the npm + github-actions ecosystems and a build-time Content-Security-Policy on the shipped
  `dist` (`connect-src` limited to self + the NLM vocabulary host).
- ✅ **Background chrome hidden from AT while a modal is open** (audit-remediation cycle). The person
  add/edit modal is now portalled to `document.body` with the app root marked `inert`/`aria-hidden`
  while open, and focus is restored to the invoking control on close (the `inert` attribute is
  removed before the focus call, so restoration isn't silently swallowed).

### Conversion-gap follow-ups

From the prototype → app faithful-conversion audit ([`GAP-ANALYSIS.md`](./GAP-ANALYSIS.md)) — the
prototype features dropped or left half-wired during the port, ranked. The engine, catalog, and
kinship model came over faithfully; these are the real omissions, concentrated in what the app
_emits_ and _edits_.

- ✅ **[High] Printable clinical reports + a print stylesheet** (Phase 2, "bring to your
  appointment"). The three one-pagers the prototype printed are restored — a 3-generation NSGC
  pedigree, a family-history red-flag summary, and an IPS-style personal-health summary — behind a
  real `@media print` stylesheet that hides the dark app chrome and renders black-on-white, one
  sheet per page (`src/ui/components/PrintReports.tsx`, print block in `src/styles/components.css`).
  Each sheet restates the clinical boundary as a first-class bordered block (guardrail #3), reads
  only engine outputs (guardrail #1), and repeats the "screening keys off organs, not gender" line
  (guardrail #4).
- ✅ **[High] Native lossless backup + restore** (Phase 3 / no-lock-in). The complete record
  (conditions, onset/provenance, timeline, organs, identity) plus long-tail catalog extensions now
  serialise to a versioned JSON envelope (`src/export/native.ts`) and re-import through a validating
  parser (`src/import/native.ts`) that feeds the existing `replaceRecord`. Download + restore live
  in the Reports view. GEDCOM (structural-only) and FHIR/Phenopacket (lossy) don't cover it;
  this round-trips with no loss. Guardrail #5.
- ✅ **[High] Wire Timeline event editing into the UI.** Each event now has an inline **Edit**
  affordance backed by the store's `updateEvent`, and the event form carries a person picker so an
  event can be logged to — or reassigned to — any relative rather than only the currently-viewed
  person (`src/ui/views/TimelineView.tsx`).
- ✅ **[Med] Restore dropped read surfaces.** Overview "Recent activity" (3 newest proband events, a
  real list); the pedigree category-breakdown string — reworded to "N people · X (2), Y (1)" so its
  count never reads as an "N×" risk multiplier (guardrail #1); the drawer condition card's
  inheritance-pattern line (labelled for screen readers).
- ✅ **[Med, guardrail] Re-assert the eroded guardrail copy.** A shared `ClinicalBoundary` callout
  (bordered `role="note"`) now heads every on-screen analysis surface — Patterns, Overview, and
  Pedigree — instead of lede body text (#3); the drawer restates "Screening keys off organs present,
  not gender." at the organ inventory (#4).
- ✅ **[Low → done] Proband-relative generation labels** (`YOU / ▲ / ▼`) restored on the pedigree,
  with the "N generations above/below you" cue folded into each node's accessible name. Remaining
  low/cosmetic parity (batch as capacity allows): the drawer avatar glyph, click-condition-to-
  highlight, the timeline spine + type dots, the same-year sort tiebreaker, and the other minor
  items in GAP-ANALYSIS.md.
