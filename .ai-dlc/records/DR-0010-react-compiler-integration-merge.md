<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — React Compiler integration merge

Records the maintainer's authorization to integrate the **React Compiler integration** branch
(`claude/react-compiler-integration-gms5cp`) into `main`: enable React Compiler 1.0 as a build-time
transform and drop the manual memoization it now subsumes. Because `deploy.yml` auto-publishes to
GitHub Pages on push to `main`, this action crosses **both** the Construction→merge gate (Gate 3)
**and** the →Operations deploy gate (Gate 4).

## Machine fields

| Field | Value |
| --- | --- |
| `decision_id` | DR-0010 |
| `transition` | `construction-to-merge` (coupled `to-operations` Pages publish authorized in the same action) |
| `chosen_option` | `approve` |
| `target` | `main` |
| `unit_of_work` | react-compiler-integration — turn on React Compiler 1.0 and simplify the UI by removing now-redundant manual memoization |
| `rationale` | Enables React Compiler 1.0 so components/hooks that follow the Rules of React are auto-memoized, then removes ~28 now-redundant manual `useMemo`/`useCallback`/`memo` sites across 11 `src/ui/` files. `@vitejs/plugin-react` v6 transforms with oxc and exposes no `babel` option, so the compiler is wired the version-correct way for this Vite 8 stack: the plugin's own `reactCompilerPreset()` fed through `@rolldown/plugin-babel`, `include`-scoped to `src/ui/` so the pure domain/data layers are never handed to Babel. The compiler targets React 19's built-in `react/compiler-runtime` (no new runtime dependency shipped). Two `useCallback(fn, [])` wrappers (`zoomAt`, `nudgeToPerson` in `PedigreeView`) were deliberately kept — they are dependencies of native-`addEventListener`/selection `useEffect`s whose identity stability the compiler does not own and the `exhaustive-deps` lint enforces. Three-reviewer gate ran: `code-reviewer` **APPROVE** (traced every removed memo forward — only those two functions feed an effect dep array, both kept; verified plugin ordering works via `@rolldown/plugin-babel`'s internal `enforce: 'pre'`; HistoryView lazy-diff guard preserved; `PedigreeNode` `memo()` unwrap has no external caller); `clinical-safety-reviewer` **clean on rules A–E** (no domain/risk/screening/advice/identity file touched; every removed memo calls the same domain/export function with the same arguments; CSP byte-identical; new deps are dev-only with zero runtime egress; determinism preserved, no oracle edited); `security-privacy-reviewer` **clean** (all three new devDependencies are the official packages — `babel-plugin-react-compiler` from facebook/react, `@rolldown/plugin-babel` from rolldown, `@types/babel__core` from DefinitelyTyped — MIT-licensed, pinned with integrity hashes, `npm audit` 0 vulnerabilities, no new runtime network host). `npm run check` (format + lint with 0 warnings + typecheck + 588 tests) green; `npm run build` green with `react/compiler-runtime` memo caches emitted; `react-compiler-healthcheck` compiles all components with zero bail-outs; in a headless Chromium the app boots with **zero console errors**, the clinical-boundary text renders, and the pedigree pan/zoom, node focus/selection, and all six views work against the seeded example family. |
| `approver` | maintainer (kabaka) — directed "Enable the React Compiler … PR → merge → ensure prod Pages deployment succeeds when done" |
| `date` | 2026-07-17 |
| `risk_tier` | standard |

## Recorded scope / design decisions (arbiter-facing, non-silent)

1. **Version-correct wiring for Vite 8 / plugin-react v6.** Because plugin-react v6 uses oxc and has
   no `babel` option, the compiler runs through `@rolldown/plugin-babel` via the plugin's exported
   `reactCompilerPreset()` — the path the React docs prescribe for `@vitejs/plugin-react` ≥ 6.0.0 —
   rather than the legacy `react({ babel: … })` form, which no longer exists. The dedicated React
   Compiler lint suite is not part of oxlint's rule set (the repo migrated off ESLint to
   `oxlint --type-aware` in DR-0007's follow-up, PR #38); the compiler transform is the deliverable
   and is lint-independent — oxlint still enforces `react/rules-of-hooks` and `react/exhaustive-deps`
   (`.oxlintrc.json`), which the two kept `useCallback`s satisfy, and the healthcheck's zero bail-outs
   is what confirms every component is safely compiled.
2. **Manual memoization removed only where the compiler subsumes it.** The two `useCallback(fn, [])`s
   feeding `useEffect` dependency arrays were kept, with in-line comments, because effect-dependency
   identity is a correctness property the compiler does not take ownership of and the `exhaustive-deps`
   lint flags. Everything else removed is pure derived state or a `memo()` wrapper the compiler's
   call-site memoization replaces — verified behavior-preserving by all three reviewers and the tests.
3. **Compiler scoped to the UI layer.** `@rolldown/plugin-babel`'s `include` is constrained to
   `src/ui/`, keeping the pure `domain`/`data`/`export` layers out of Babel entirely — honoring the
   layering contract explicitly (not just relying on the compiler no-op'ing) and trimming build time.

## Notes

- Guardrails untouched: no clinical logic, risk/advice/screening/identity code, catalog, or exports
  changed; no manufactured number; local-first / no-exfiltration intact (the sole sanctioned network
  call, `src/integrations/vocabulary.ts`, is not in the diff, and the CSP is byte-identical). The new
  packages are **build-time devDependencies** — nothing new ships to the user at runtime beyond React
  19's own bundled `react/compiler-runtime`. Determinism preserved — no test file was edited and no
  wall-clock dependency was introduced.
- This branch was rebased onto `main` after PR #38 (TypeScript 7 native port + `oxlint --type-aware`)
  merged, closing the TypeScript 6/7 follow-up carried from DR-0007/DR-0009. The compiler integration
  was re-verified end-to-end against that new toolchain (oxlint + tsc7 + Vitest).
