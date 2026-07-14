---
name: add-export
description: >-
  Add or change a standards export/serializer in Stemma (src/export/): FHIR, Phenopacket,
  GEDCOM, pedigree SVG, or a new interchange format. Use when implementing export to a health/
  genealogy standard, extending an existing serializer, or wiring an export into the Reports view.
  Triggers: "export to <standard>", "add FHIR/Phenopacket/GEDCOM/CCDA/ICS", "serialize the
  record", "download as", "interoperability format".
---

# Add a standards export format

The export layer (`src/export/`) turns a `FamilyRecord` (+ catalog) into an open-standard document,
entirely client-side. It is **pure and deterministic** and tested in `src/export/*.test.ts`. No
lock-in is a first-class requirement (`CLAUDE.md`): everything must round-trip out to a standard.

## Steps

1. **Create `src/export/<format>.ts`** exporting a pure function:
   ```ts
   export function build<Format>(record: FamilyRecord, catalog: Catalog, opts?: <Format>Options): string | object
   ```
   Read a real spec, not memory. Reuse the domain: `indexPeople`/`relationInfo`/`computeLayout`/
   `segments` from `graph`, identity/condition helpers from `person`, `catalog.get` for codes
   (`.icd10`, `.snomed`). Define focused TypeScript interfaces for the output shape — no `any`.

2. **Determinism.** Any timestamp/id/current-year must come from `opts` (default to the wall clock
   only when the caller omits it). Tests pass explicit values so output is stable. Guard optional
   data with `!= null` (so a genuine 0 is emitted), and escape any user text that lands in markup.

3. **Coding.** Where the format carries codes, emit what the catalog has — prefer dual-coding
   (SNOMED CT + ICD-10-CM) as `fhir.ts` does. Use the `medical-coder` agent for mapping questions.

4. **Re-export** from `src/export/index.ts`.

5. **Wire the UI** (optional): add a card to `src/ui/views/ReportsView.tsx` (name, standard,
   filename, mime) — the download/preview plumbing is generic.

6. **Test** against `seedRecord()` + `buildCatalog([])` in `src/export/<format>.test.ts`: assert
   structural validity, a known coded entry, and determinism given fixed `opts`. `npm run check`.

## Guardrails

- Pure: import only `domain`/`data` — never `store` or `ui`.
- No fabricated clinical content — a serializer reports what's in the record, nothing more.
- Prefer validating output against a real validator/schema for the standard when one is available.
