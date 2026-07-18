<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — C-CDA import architecture & sequence (design fork)

## Machine fields

| Field          | Value |
| -------------- | ----- |
| `decision_id`  | DR-0017 |
| `transition`   | `design-fork` |
| `chosen_option`| `approve` |
| `target`       | `construction` |
| `unit_of_work` | ccda-import |
| `rationale`    | See below. |
| `approver`     | kabaka (maintainer / sole arbiter) |
| `date`         | 2026-07-17 |
| `risk_tier`    | high-risk (relationship inference feeds the hereditary-pattern engine; in-browser XML parsing; first merge-into-live-record import) |

## Approved design (software-architect, grounded by medical-domain-expert)

- **New pure module `src/import/ccda.ts`** (barrel-exported), three pure/deterministic
  "never-throw" functions mirroring the GEDCOM split:
  - `parseCcda(xmlText) → ParsedCcda` — XML → structural intermediate via **DOMParser**
    (no new npm dependency; `jsdom` already a devDependency for tests). No network, no
    clock, no random ids (deterministic ids from CDA `<id>` or running index).
  - `stageCcdaImport(parsed, record, catalog) → StagedCcdaImport` — read-only over the
    live record; produces per-condition and per-relative suggestions with match status.
  - `applyCcdaImport(record, staged, selections, catalog) → { record, extensions }` —
    pure merge producing a complete new `FamilyRecord`, handed to the existing
    `replaceRecord` boundary (Option A; **zero store changes**).
- **Pure domain additions** (generalize the mechanism, no bolt-on): a `Catalog.byCode(system, code)`
  reverse index built in `createCatalog`, and a hoisted `conditionFromCode(...)` shared by
  `ccda.ts` and the existing `hitToCondition` so the long-tail path isn't duplicated.
  Long-tail conditions registered through the existing `sanitizeExtensions` guard.
- **Code extraction priority** (from the clinical reference): collect `value` + all
  `translation` (code, system) pairs; curated ICD-10-CM match → curated SNOMED match →
  ICD-10 long-tail `fallbackCondition` → SNOMED-only generic `cat:'other'` preserving the
  code+displayName verbatim (never fabricate an ICD-10 code) → narrative-only = needs-review.
- **Conservative relationship auto-placement.** Auto-place only MTH/FTH → parent,
  full BRO/SIS/SIB → sibling, SON/DAU/CHILD → child, and side-specified grandparents
  **only when the linking parent already exists**. Everything ambiguous (side-unknown
  grandparents, half-siblings, aunts/uncles/nieces/nephews/cousins, in-law/step/adoptive/
  foster, spouse) is surfaced for manual placement, never auto-attached — a wrong guess
  would corrupt per-lineage HBOC/Lynch counting. Non-genetic relatives never feed the engine.
- **Merge-with-review UI**: `CcdaImport.tsx` (file picker, "nothing is uploaded" +
  clinical-boundary copy) → a review step rendering `StagedCcdaImport` with per-item
  checkboxes (needs-review/ambiguous items default OFF) and an anchor+relation picker for
  ambiguous placements → `applyCcdaImport` → `replaceRecord(record, extensions, 'Imported from health record (C-CDA)')`.
  Entry point alongside `GedcomImport` in `PedigreeView`.

## Security seams recorded for review
Reject any input containing `<!DOCTYPE` (closes XXE/billion-laughs class; real CCDs carry
none), size-cap the input, treat `parsererror` as a structured warning (never throw),
and confirm CDA narrative/names flow only into plain string fields rendered as React text
children — never a `dangerouslySetInnerHTML` sink.

## Build sequence
1. Domain: `Catalog.byCode` + `conditionFromCode` (+ unit tests owned by test-engineer).
2. `src/import/ccda.ts`: `parseCcda` → `stageCcdaImport` → `applyCcdaImport`; barrel export.
3. Independent test oracle: fixture CCDs + deterministic tests for parse/stage/apply,
   security cases, negation/narrative-only/non-genetic-exclusion (test-engineer; implementer
   may not edit).
4. UI: `CcdaImport.tsx` + review step; wire into `PedigreeView`.
5. `npm run check` green; verify import flow in `npm run dev`; ADR-009 in `docs/ARCHITECTURE.md`.
6. Review gate: code-reviewer + clinical-safety-reviewer + security-privacy-reviewer +
   accessibility-reviewer + medical-domain-expert.

## Next gate
`construction-to-merge` — implemented unit approved for integration (DR-0018).
