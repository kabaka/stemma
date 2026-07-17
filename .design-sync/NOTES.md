# design-sync notes — Stemma

## Repo shape
- Stemma is a **React application** (Vite), NOT a published component library. There is
  no `dist/`, no `module`/`main`/`exports` entry, and no `node_modules/stemma`.
- The design system is the 12 reusable components under `src/ui/components/`.
- **Package (synth-ish) shape** driven by a hand-written barrel: `.design-sync/entry.tsx`
  re-exports the 12 components by their real (all named) exports, passed via `cfg.entry`.
  `PKG_DIR` walks up from `.design-sync/` to the repo root (`package.json` name "stemma").
- The barrel also re-exports `useStore`, `seedRecord`, `emptyRecord` from the SAME bundle
  so authored previews can seed the real Zustand singleton the components read. Importing
  the store from `@/…` in a preview would spin up a second singleton the components ignore.
- `@/` → `src/` resolved via `cfg.tsconfig = tsconfig.app.json` (baseUrl repo root).
- No lockfile in repo; faithful install is `npm install` (no `node_modules` on fresh clone).

## Styling
- Tokens + base resets: `src/styles/theme.css` (`cfg.tokensGlob`). Component styles:
  `src/styles/components.css` (`cfg.cssEntry`). Class-based idiom (`.btn`, `.field`,
  `.seg-btn`, `.modal`, `.page-title`, severity chips…). Tokens are `--*` CSS variables.

## Fonts — ACTION NEEDED
- Theme references `'IBM Plex Sans'` / `'IBM Plex Mono'` in `--font-sans`/`--font-mono`
  but ships **no `@font-face`, no Google-Fonts `@import`, no local woff2**. The running app
  silently falls back to `system-ui`. Expect `[FONT_MISSING]` on validate. IBM Plex is
  OFL-licensed. Decision pending (wire via `cfg.extraFonts` vs. accept fallback) — see
  build loop.

## Component coupling (for preview authoring)
- Store default state = `emptyRecord()` (proband only). `seedRecord()` = 20 people,
  8 unions, 15 timeline events, realistic conditions — use it to populate store-heavy cards.
- leaf (props only): ClinicalBoundary, FlagCard, ProvenanceMark, GedcomImport,
  NativeRestore, HighlightBar (all data via props; has an outside-click popover).
- store-light (need `personId` + seeded record): CurrentMedications, LabTrend.
- store-heavy: ConditionPicker (also fires a network vocabulary lookup), PrintReports
  (reads full record + computed patterns/findings/screenings).
- portal/interaction: PersonForm (`createPortal` to `document.body`, focus trap, inert on
  `.app`), PersonDrawer (drawer modal, Escape listener, `window.confirm` on delete).

## Preview-authoring recipe (calibrated on the solo trio)
- Import EVERYTHING from `'stemma'` (→ the pre-built bundle / window.Stemma). NEVER import
  from `'@/…'` in a preview — that compiles a SECOND store singleton the bundled
  components don't read, so store seeding silently has no effect.
- The barrel (`.design-sync/entry.tsx`) re-exports preview helpers: `useStore`,
  `seedRecord`, `emptyRecord`, `buildCatalog`, `detectPatterns`, `familyFindings`.
- Seed the store at preview module top: `useStore.setState({ record })`. Fresh iframe per
  card, so this is safe and runs before the component renders.
- **The seed carries only display strings — no structured `lab`/`med`/etc. payloads.**
  `labSeries`/`currentMedications` read `event.lab` / `event.med`, so attach those payloads
  yourself (see LabTrend.tsx). `lab: {value, unit, refLow?, refHigh?}`; `med: {dose?, ongoing, stopYear?}`.
- Derive domain objects (PatternFlag, findings) from the REAL engine over `seedRecord()` —
  never hand-write clinical text (guardrail #1 + no-fabrication rule). See FlagCard.tsx.
- Seed person ids: proband `you` (Maya); father `robert` (CAD/statin); mother `susan`
  (T2D/Metformin); `linda`/`mia`/`helen` (BRCA). `detectPatterns(seedRecord(), buildCatalog([]), 'you', 2026)`
  yields: HBOC (referral), Premature CVD (discuss), 2× Age-of-onset (discuss). No note/Lynch from `you`.
- `cfg.provider = ThemeSurface` wraps every card in the app's dark `.app` surface. This is
  why leaf components (light text on dark) are legible. Side effect: it defeats the floor
  card's empty-root detection, so an UNauthored store-heavy component reads as `bad` blank
  instead of a clean floor card — harmless because all 12 are being authored.
- Overlay/portal components (PersonForm uses `createPortal` to body; drawers): expect to need
  `cfg.overrides.<Name> = {cardMode:'single', viewport:'WxH'}` so the open state renders in-card.

## Per-component authoring notes (folded from wave learnings)
- **CurrentMedications**: `currentMedications` needs `med:{ongoing:true, dose}` payloads AND
  `event.year <= asOfYear`; empty-state cell uses `personId="susan"` (no med payloads).
- **HighlightBar** (from `PedigreeHighlight.tsx`): props `mode:'cond'|'cat'`, `activeId`,
  `people`, `catalog`, `palette` + callbacks. 2×2 matrix over mode × activeId. Derive
  `people=seedRecord().people`, `catalog=buildCatalog([])`, `palette='default'`.
- **PrintReports**: PRINT-ONLY component. Root `.print-reports` is `display:none` on screen and
  all `print-*` classes live inside `@media print`, so on-screen it renders STRUCTURALLY (text,
  tables, and the styled pedigree SVG) but without paper styling. The preview injects
  `<style>.print-reports{display:block !important}</style>` to make it capturable. Override
  `{cardMode:single, viewport:1200x2400}` exposes all 3 sheets. The SheetHead "generated" date
  reads the wall clock (informational display text, not engine input) — expected.
- **ConditionPicker**: renders existing conditions + search field + catalog suggestions at rest;
  the ICD-10-CM vocabulary lookup only fires after typing 2+ chars (network) — not statically shown.
- **PersonDrawer**: drawer modal, `{personId, onOpenForm}`. Override `{single, 800x1200}` shows the
  full drawer incl. quick-add grid + Edit/Delete footer.
- **PersonForm**: `PersonFormState = {mode:'add', anchor, relation} | {mode:'edit', id}`. Uses
  `createPortal` to body + sets `.app` inert (ThemeSurface provides `.app`). Override `{single, 900x1100}`.

## Known render warns
- `[TOKENS_MISSING]` "1 missing, below threshold" — a runtime-set CSS var (inline/JS), expected.
- `[PROVIDER_UNVERIFIED]` for ThemeSurface — no dist `.d.ts` so the export can't be proven at
  build time; it IS a real bundle export and previews render, so this is expected/benign.

## Re-sync mechanics (this repo has no `buildCmd` — the barrel IS the build)
- Re-copy staged scripts, then run the driver from the repo root (first-sync style, WITH `--remote`
  once anchored): `node .ds-sync/resync.mjs --config .design-sync/config.json --node-modules ./node_modules --entry .design-sync/entry.tsx --out ./ds-bundle --remote .design-sync/.cache/remote-sync.json`
- Playwright 1.61.1 pins chromium build 1228 (cached under `~/Library/Caches/ms-playwright`). Install
  `playwright` into `.ds-sync` before validate; no browser download needed if 1228 is cached.
- `npm install` at repo root first (no lockfile, no committed `node_modules`) so `react`/`react-dom`
  resolve for `--node-modules ./node_modules`.

## Re-sync risks (what can silently go stale)
- **`.design-sync/entry.tsx`** (the barrel) is the component surface — if a component is added,
  removed, or renamed in `src/ui/components/`, update BOTH the barrel and `componentSrcMap`, or the
  set desyncs. It also re-exports preview helpers (`useStore`, `seedRecord`, `buildCatalog`,
  `detectPatterns`) and the `ThemeSurface` provider — keep those.
- **`.design-sync/ds-styles.css`** is a GENERATED concatenation of `src/styles/theme.css` +
  `src/styles/components.css` (regen command in its header). If either source CSS changes, REGENERATE
  it or the shipped tokens/component styles go stale. (`copyTokens` needs a `tokensPkg`, which this
  in-repo DS has none of — hence the concat.)
- **`.design-sync/tsconfig.build.json`** pins the two barrel-DIRECTORY imports `@/import`, `@/export`
  to their `index.ts` (the tsconfig-paths plugin resolves an alias to the bare dir first). If new
  barrel-dir aliases appear under `src/`, add them there (exact keys BEFORE `@/*`).
- **Fonts**: IBM Plex (OFL-1.1) is BUNDLED here though the running app ships none (it falls back to
  system fonts). The DS pane therefore renders in IBM Plex — intentionally truer to design intent
  than the app. woff2 live in `.design-sync/fonts/` (committed).
- **Preview illustrative data**: LabTrend/CurrentMedications attach `lab`/`med` payloads the seed
  lacks; FlagCard/PersonForm/etc. derive from the real engine over `seedRecord()`. If the seed or the
  domain types change, re-check those previews.
- **PrintReports** on-screen is structural-only (print styling is `@media print`) — a known, accepted
  limitation, not a defect. Recorded above.
