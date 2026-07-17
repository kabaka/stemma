# Stemma design system — how to build with it

Stemma is a **local-first family-health & hereditary-pattern tool**. It is a **dark clinical
theme**, React + TypeScript, styled with **plain CSS classes + CSS custom properties** (no
utility framework, no CSS-in-JS). Decision-support, not a diagnostic device — the clinical
guardrails below are part of the design, not boilerplate.

## Wrapping & setup (do this or components look wrong)
- **Render on the dark app surface.** Every component assumes it sits inside the dark theme:
  wrap your screen in a container with `background: var(--bg); color: var(--text); font-family:
  var(--font-sans);` (the app uses a root `.app` element). On a white background the light text
  is invisible. `styles.css` (and its `@import` closure) must be loaded — it defines the `:root`
  tokens, ships **IBM Plex Sans/Mono**, and carries all component styles.
- **Some components read app state, not props.** `PersonDrawer`, `PersonForm`, `ConditionPicker`,
  `CurrentMedications`, `LabTrend`, and `PrintReports` read a **Zustand store** (`useStore`) holding
  a `FamilyRecord`; they take only an id (e.g. `personId`) and derive everything from the store.
  Seed it before rendering: `useStore.setState({ record })`. The bundle exports `useStore`,
  `seedRecord()` (a full illustrative family) and `emptyRecord()` for this. The rest —
  `ClinicalBoundary`, `FlagCard`, `ProvenanceMark`, `HighlightBar`, `GedcomImport`, `NativeRestore`
  — are prop-driven and render standalone.
- `PrintReports` is a **print surface**: its layout styling lives in `@media print`, so on screen
  it renders structurally (the pedigree SVG is styled; tables are plain).

## The styling idiom — CSS classes + `var(--*)` tokens
Style your own layout glue with these; don't invent new class names or hard-coded colors.
- **Tokens** (in `:root`): surfaces `--bg` `--bg-panel` `--bg-rail` `--bg-hover`; text `--text`
  `--text-dim` `--text-faint`; brand `--accent` `--accent-hover`; lines `--border` `--border-strong`;
  severity `--sev-referral` (red) `--sev-discuss` (amber) `--sev-note` (grey); type `--font-sans`
  `--font-mono`.
- **Component/utility classes**: buttons `.btn`, `.btn--primary`, `.btn--danger`, `.btn--sm` (plain
  `.btn` is the secondary — there is no `.btn--secondary`); inputs `.field`; segmented toggles
  `.seg-btn`; containers `.card`, `.modal`; chips `.chip` + `.chip-remove`, status `.badge`;
  pattern flags `.flag` / `.flag__title` / `.flag__rec`; tables `.data-table`; text `.page-title`,
  `.section-label`, `.overline`, `.mono-dim`; `.disclaimer`; screen-reader-only `.visually-hidden`.

## Where the truth lives
Read these before styling: **`_ds/<folder>/styles.css`** and its imports (`_ds_bundle.css` for
component rules, `fonts/fonts.css`); and each component's **`.d.ts`** (its exact props) and
**`.prompt.md`** (usage). The real files beat any summary here.

## Clinical-safety guardrails (design constraints, non-negotiable)
1. Never show a manufactured risk number/probability. The engine reports **patterns** and the
   **specific published criterion met** (see `FlagCard`), never a computed multiplier.
2. Recommendations are **advisory** — prompts to raise with a clinician, never instructions/diagnoses.
3. Put the **clinical boundary on every analysis surface** — use `<ClinicalBoundary />`, not a footer.
4. **Screening is keyed off the organ inventory, not gender.** Sex-assigned-at-birth drives genetics;
   gender identity drives display only (see `PersonDrawer`/`PersonForm`).

## Idiomatic snippet
```tsx
import { useStore, seedRecord, PersonDrawer, ClinicalBoundary } from 'stemma';

useStore.setState({ record: seedRecord() }); // populate the family record the store-backed parts read

export default function Screen() {
  return (
    <div className="app" style={{ background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-sans)', padding: 20 }}>
      <h1 className="page-title">Family health</h1>
      <ClinicalBoundary />
      <PersonDrawer personId="you" onOpenForm={() => {}} />
    </div>
  );
}
```
