# Lineage — expansion plan

A direction for growing the prototype into either a client-side GitHub Pages tool or a self-hosting-first private deployment. Organized as: the foundational decisions first, then data, pedigree, UI, exports, architecture, and a sequenced first phase.

---

## 1. Model Person as the atom, not the proband

The prototype currently blends two things: a family-history/hereditary-risk tool (Pedigree + Risk Projection) and a personal medical-history tracker (My Timeline). They share one clean foundation if **Person** is the core entity rather than the proband:

```
Person ── demographics (natal sex, gender identity, chosen name, DOB/DOD, organ inventory)
       ── relationships (typed edges: genetic parent, social parent, partner, donor, twin{mono/di})
       ── conditions   (each with onset age, provenance, coding)
       ── events        (the timeline: dx, meds, procedures, labs, immunizations, vitals)
```

Everything already built becomes a view over that one graph:

- **Pedigree** — a layout over the relationship edges.
- **Risk** — a computation over the graph from a chosen person's vantage.
- **Timeline** — one person's events, sorted.

This lets every relative carry their own conditions, onset ages, and timeline instead of being an inert node, and it lets you re-root a risk computation on any person *within a single family record* (e.g. reason about a parent's risk using that family's data). It is a schema decision, so it belongs first — it is the one choice that is expensive to reverse later.

Scope note: this is about how one person's record is structured. It does **not** imply merging separate people's records into a shared dataset — see §7 for why those are kept apart.

---

## 2. Rework the risk model: detect patterns, don't manufacture numbers

The current model is `RR = 1 + (Σ degree-weights of affected blood relatives) × sensitivity`, with degree weights 1.0 / 0.5 / 0.25 and Elevated/Moderate/High bins. It is labeled illustrative, but a value that reads as relative risk is the app's sharpest edge because people act on numbers. Its specific weaknesses:

- **Base rate is absent from the multiplier.** One affected first-degree relative bumps hypertension (≈50% lifetime) and Huntington's (≈0.01%) by the same factor. That is backwards — familial clustering is far more informative for rare, high-penetrance disease. The `base` field exists in the catalog but never enters the math.
- **Inheritance pattern is shown but never computed on.** An affected parent under autosomal dominant is a ~50% transmission event; under multifactorial it is a modest liability shift. The model treats them identically.
- **No denominator or family size.** Two affected of three relatives ≠ two of forty, and an absence of affected relatives in a small family is not reassurance — small pedigrees are simply uninformative, and the tool should say so.
- **No age.** Onset age in relatives, and current age relative to it, is often the whole story ("father's MI at 48; you're 38"). None of it is modeled.
- **A bare multiplier with no absolute risk** is precisely the framing clinicians and geneticists distrust. 2× a 0.5% risk is noise; 2× a 12% risk is a conversation.

**Direction — make pattern detection the default surface, real calculators the opt-in depth:**

- **Default: pattern detector.** Reframe from "here is your risk number" to "here is what this family pattern means and whether it meets referral criteria." Detect published red-flag patterns (≥2 relatives with related cancers, young onset, a recognizable dominant pattern, a known-pathogenic family condition) and surface the specific criterion met, e.g. "meets criteria for a genetics referral." Defensible, and more useful than a manufactured multiplier.
- **Opt-in depth: validated models, per domain.** Where real models exist, defer to them rather than reinventing — the BOADICEA / CanRisk family for breast/ovarian (hosted tool plus a license-gated web-services API), Amsterdam II / revised Bethesda pattern logic for colorectal. Always output **absolute risk with a confidence range**, never a bare multiplier.

Retire the homemade multiplier. For a tool the family will actually trust, a number that looks authoritative but isn't is the worst option. Treat the "organizing tool, not a diagnostic" boundary as a first-class UI element, not a footer.

---

## 3. Data sources — bind the catalog to real vocabularies and epidemiology

`conditions.js` is a hand-built catalog with rough `base` prevalences (some look like placeholders — `afib base:25` is not a lifetime prevalence). Mapping onto standard vocabularies and sourced epidemiology makes it credible and maintainable.

**Condition identity and coding:**

- **ICD-10-CM** — for anything handed to a US clinician or billing system (a live ICD-10 tool is already available in this environment).
- **SNOMED CT** — the clinical interoperability lingua franca and what maps cleanly into FHIR; note UMLS/SNOMED redistribution terms.
- **HPO (Human Phenotype Ontology)** — open and permissive (Jackson Lab / OBO Foundry), the right vocabulary for talking to geneticists and for phenotype-driven matching. Lean on this one because it is genuinely free to redistribute.
- **OMIM / Orphanet** — the Mendelian and rare-disease layer, and the authority on inheritance pattern and rare-disease epidemiology. Orphanet is open; OMIM is free for academic use but licensing-gated for redistribution.

**Prevalence and heritability (to replace hardcoded `base`):** IHME Global Burden of Disease (open, citable global rates), CDC / NCHS (US-specific), and published twin-study heritability estimates rather than an implicit pattern label.

**Genetics layer (if genome/array data is ever ingested):** ClinVar (variant significance), gnomAD (population allele frequencies), ClinGen (gene-disease validity), and the PGS Catalog for polygenic scores (REST API plus the `pgsc_calc` pipeline). Consumer arrays are not clinical-grade — caveat heavily.

**Medications (the backbone of the tracker use case):** RxNorm (NLM, open) to normalize drug names and strengths; openFDA / DailyMed for labels and interactions.

**People and evidence:** the NPI Registry to attach verified clinicians to events (live tool available), and PubMed to ground condition and risk statements in citations (live tool available) — a natural fit for a RAG-backed deployment where each surfaced claim carries its evidence.

---

## 4. Interop standards — the import/export layer that makes it real

Hand-entering family structure and records is the main friction; import and standards-based export are what turn a personal tool into something a clinician will accept.

- **HL7 FHIR** — the clinician/EHR target: `FamilyMemberHistory`, `Condition`, `Patient`, `MedicationStatement`, `Observation`, `AllergyIntolerance`, `Immunization`. R4 is the deployed baseline (R5/R6 exist). Many patient portals and Apple Health expose FHIR (SMART on FHIR / SMART Health Cards), so it is both an export target and an import source for pulling existing records instead of retyping them.
- **GA4GH Pedigree standard + Phenopackets v2** — the geneticist/researcher target, and the current standard specifically for pedigree and family health history (tested in GA4GH connectathons). Emit a Phenopacket for a genetic counselor to take an export seriously.
- **GEDCOM / GEDCOM X** — genealogy interchange; let people import an existing Ancestry/FamilySearch tree to get the tedious relationship graph for free.

Design principle: everything exportable to an open standard. For a personal health record, no-lock-in is an ethical requirement — the data should outlive the app.

---

## 5. Rebuild the pedigree on the 2022 gender-inclusive standard

The current chart uses square = male / circle = female. The authoritative nomenclature — Bennett et al., NSGC, 2022 revision — was rewritten specifically for sex and gender inclusivity: it separates **sex assigned at birth** (what the genetics needs) from **gender identity and chosen name** (what accuracy and respect need), adds notation for trans and nonbinary individuals, and drops the forced binary geometry. Almost no consumer pedigree tool implements it, so it is both correct and a real differentiator.

The clinical benefit that falls out: **key risk and screening off an organ inventory, not gender.** A trans woman may still need prostate screening; a trans man may still need cervical screening. So carry, per person: natal/karyotypic sex where known, gender identity and chosen name for display, and an **organ inventory** (present/absent/altered for the organs that drive screening — breasts, ovaries, uterus, cervix, prostate, and so on). The screening engine reads the inventory; the pedigree displays identity.

Structural growth for the pedigree itself, since real families are not trees:

- Union nodes, multiple partners, half-siblings, and **consanguinity** (double line — it changes recessive risk and is part of the standard).
- **Adoption and donor conception** — distinguish social parent from genetic parent, which matters for both the risk math and for representing the family honestly. Twins with mono/di-zygotic distinction.
- Pan / zoom / collapse over a real graph rather than a fixed tree layout.

---

## 6. UI features beyond the pedigree

- **Provenance on every fact** — self-reported vs confirmed-by-records vs death-certificate. Family history is unreliable, and clinicians actively weight source; a per-fact confidence tag is cheap and disproportionately valuable.
- **Age-of-onset everywhere**, feeding proximity alerts ("relative diagnosed at 48; you're 38").
- **Timeline upgrades** — attach documents/labs/images to events; medication start/stop with a derived "currently taking" list; numeric **lab trends** with reference ranges; allergy list; a printable immunization record; vitals.
- **Import pipelines** — OCR/parse uploaded records, FHIR pull from a portal or Apple Health, GEDCOM for family structure, consumer DNA raw-file parse (heavily caveated).
- **Append-only history** — treat records as versioned with a visible "what changed" diff; health facts get corrected constantly, and the audit trail is the feature.
- **Switch proband** — recompute the risk/screening view from any member's vantage within a family record.
- **Care coordination** — screenings as an actual schedule with overdue flags, calendar export (live Calendar tool available), and a printable "bring to your appointment" sheet.
- **Colorblind-safe by default** — the colorblind palette prop already exists; make it first-class and never encode meaning in color alone.

---

## 7. Keep separate people's records separate

There is no need to merge one person's health data with another's when they share no descendants and no relatives — the two family graphs never share a node, so there is no genetic or epidemiological reason to co-locate them, and commingling only adds privacy exposure.

The legitimate version of a shared "single source of truth" destination is a **shared front door, not a shared dataset**: one deployment serving isolated per-person vaults, each encrypted under its own key. A compromise of the instance then yields separate ciphertext blobs rather than exposed histories — the privacy concern is largely an artifact of per-instance keys, so keys go per person. Individual ownership also keeps each record maintained; a jointly-owned "dump everything here" store tends to become the drawer nobody tends.

The one cross-person capability worth building is **explicit, revocable proxy access** — granting a partner emergency read access to a health summary, for when one person is in an ER or post-op and the other has to hand a clinician the full picture. That is a sharing primitive layered on top of separate, individually-owned records, not a merge.

---

## 8. Architecture — local-first, one core, two backends

The GitHub-Pages-vs-server choice is not exclusive if the core is local-first with a pluggable storage/sync layer:

- **Storage adapter #1 — local-only** (IndexedDB / OPFS): the GitHub Pages build; data never leaves the browser, the cleanest privacy story.
- **Storage adapter #2 — self-hosted API**: sync and multi-device, and the multi-tenant host from §7. Make it **end-to-end encrypted by default** — server stores ciphertext, keys derived from a passphrase, zero-knowledge, per-person vaults.

Same UI and same export layer over both backends, so moving between them is not a rewrite.

**AI layer (self-hosted deployment):** local RAG over a person's own record — summarize a history, draft the family-history section of a new-patient form, prep questions for an appointment — grounded in their data plus PubMed for evidence, against a private model. Keep it advisory and cited, never diagnostic, and never allow it to emit a risk value the deterministic engine did not produce. This is the kind of capability a private, self-hosted deployment justifies that a cloud health app cannot.

---

## 9. Export reports — the clinician/geneticist deliverable

Different audiences need different documents from the same graph:

- **Three-generation pedigree** (PDF/SVG) in correct 2022 NSGC nomenclature — literally what a genetic counselor draws at intake; the most defensible high-value output.
- **Family-history red-flag summary** — §2's pattern detection as a document: flags meeting published referral criteria, each with the specific criterion cited.
- **FHIR bundle** (FamilyMemberHistory + Condition + Patient + …) for portals and EHRs.
- **Phenopacket** for geneticists and research.
- **Personal health summary** — an International-Patient-Summary-style one-pager (problems, meds, allergies, immunizations, recent labs) to hand any new provider or an ER.
- **Two registers** of the same data — plain-language patient-facing and clinician-facing — generated from one source.

The PDF and FHIR/Phenopacket exports are the point where the project stops being a personal tool and becomes something a professional accepts.

---

## 10. Suggested first phase

1. **Refactor to the Person-graph core** (§1). Everything else is cheap after it and expensive before it.
2. **Replace the risk number with pattern detection and referral flags** (§2). The correctness and liability call.
3. **Rebuild the pedigree on the 2022 gender-inclusive standard with an organ inventory** (§5). Right thing, real differentiator, and it fixes the screening model as a side effect.
4. **Ship the three-generation pedigree PDF and FHIR export** (§9, §4). The moment it produces something a clinician accepts, it stops being a toy.
5. **Bind the catalog to real vocabularies and prevalence** (§3), starting with ICD-10 + HPO + RxNorm — the three usable freely today.

Imports, the AI layer, calendar sync, and deep per-condition models layer on afterward without fighting the foundation.
