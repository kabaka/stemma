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
| Architecture | ✅ | Layered: pure `domain/` engine, `data/`, `integrations/`, `export/`, `store/`, `ui/`. See ARCHITECTURE.md. |
| Domain port | ✅ | Kinship math, the pattern engine, screening, catalog — ported to typed modules, part of a **148-test** suite. |
| Condition catalog | ✅ | 115 curated conditions generated from the prototype + **verified ICD-10-CM** (23 high-signal) & SNOMED codes. |
| Long-tail vocabulary | ✅ | `VocabularyProvider` port + NLM Clinical Tables provider (CORS, no key) — the app is **not** capped at 115 conditions. |
| Standards export | ✅ | FHIR R4, Phenopacket v2, GEDCOM 5.5.1, pedigree SVG — all generated client-side. |
| Linting / formatting | ✅ | ESLint 9 (flat) + Prettier; `npm run check` is the gate. |
| Tests | ✅ | Vitest + Testing Library; 148 tests across domain, store, exports, integrations, and UI. |
| CI/CD | ✅ | GitHub Actions: `check` + build on PRs; Pages deploy on `main`. |
| GitHub Pages | ✅ | Static build with the correct `base`; deploy workflow in place. |
| LICENSE | ✅ | MIT. |
| README / docs | ✅ | README, CONTRIBUTING, ARCHITECTURE, this ROADMAP. |
| Language cleanup | ✅ | "illustrative risk" framing replaced with the honest "organizing tool, not a diagnostic device" boundary as a first-class UI element. Renamed the product to **Stemma**. |

**Deliberately deferred** (documented, not built): a backend / sync, e2e-encrypted
multi-tenant hosting, live CanRisk/PubMed calls (CORS/licence-gated), record import
(OCR/FHIR-pull/GEDCOM-in/DNA), and the AI summarization layer. These are the roadmap
below.

## 3. Product roadmap

Sequenced so each phase is cheap after the one before it and expensive before it
(ideation §10). Phase 0 is done; the rest is AI-DLC work.

### Phase 0 — Production foundation ✅ (this cycle)
Real app, tested engine, exports, CI/CD, deploy, docs.

### Phase 1 — Trustworthy core
- **Bind prevalence & heritability to sourced epidemiology** (ideation §3). Replace the
  hand-set `base` values with IHME GBD / CDC figures and cite them. Add a data provenance
  field to `Condition`.
- **Broaden coded coverage.** Extend ICD-10-CM/SNOMED baked-in codes beyond the 23
  high-signal conditions; add HPO terms (open, redistributable) for the genetics audience.
- **Onset/provenance everywhere in the UI** (ideation §6) — surfaced consistently, with
  provenance weighting visible in reports.
- **Test the export layer against validators** (FHIR validator, Phenopacket schema).

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
- **GEDCOM import** (ideation §4) — reuse an existing family tree for the relationship graph.
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
| HPO / Orphanet / OMIM | Genetics vocabulary | Baked in | Phase 1 |
| IHME GBD / CDC | Prevalence & heritability | Baked in | Phase 1 |
| FHIR (portals, Apple Health) | Import & export | Export ✅; import needs SMART auth | Export live / import Phase 3 |
| GA4GH Phenopacket / Pedigree | Genetics export | ✅ client-side | **Live** |
| GEDCOM / GEDCOM X | Genealogy interchange | Export ✅; import Phase 3 | Export live |
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

- Prevalence `base` values are illustrative until Phase 1 binds them to sourced data.
- The seed record is fictional demo data; a first-run "start empty" path should be added.
- `prototype/` is retained for reference (screenshots, ideation doc); the catalog generator no
  longer depends on it (`scripts/conditions.source.json` is the source), so it can be pruned.

## 7. Review-driven follow-ups

Deferred items surfaced by the specialist review panel (architecture, medical, security,
accessibility, testing) — captured here so nothing is lost:

- **Long-tail codes don't yet drive detection** (Phase 3 enabler). A condition attached via ICD-10
  vocabulary search resolves to `cat:'other'` and does not count toward, e.g., the HBOC breast
  tally. Add a code→curated-concept alias so imported/coded data participates in the pattern engine.
- **HBOC should count same-lineage** (Phase 1). NCCN family-history criteria are per-side; the
  current `breast ≥ 2` is lineage-agnostic (low-harm over-trigger for a *referral*). Refine to
  same-side and cite NCCN.
- **Lynch spectrum** (Phase 1). Add ovarian and upper-urinary-tract cancers to the Lynch-spectrum
  set (a sensitivity gap), coordinating with HBOC so ovarian isn't double-counted.
- **Async storage seam before Phase 5.** Every store mutation is synchronous; a zero-knowledge
  remote vault is async. Design the repository/adapter interface (async hydrate/commit) before the
  backend, not after — the sync→async shift is the real work, not the storage bytes.
- **AI layer must consume the typed engine outputs** (`PatternFlag`/`FamilyFinding`), never
  re-derive from free text, to keep the "no number the engine didn't produce" guard enforceable.
- **GitHub Actions** are pinned to major tags (`@v4`); pin to commit SHAs for stricter supply-chain
  hygiene when the project hardens further.
