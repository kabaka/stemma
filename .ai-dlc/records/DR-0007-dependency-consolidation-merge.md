<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — Dependency consolidation (ESLint 10 toolchain + pinned Actions) merge

Records the maintainer's authorization to integrate a single consolidated dependency update that
supersedes the **ten open Dependabot PRs (#18–#27)** into `main`. Because `deploy.yml`
auto-publishes to GitHub Pages on push to `main`, this action crosses **both** the
Construction→merge gate (Gate 3) **and** the →Operations deploy gate (Gate 4). The change is
dev-tooling / CI only — no runtime dependency and no shipped-behavior change.

## Machine fields

| Field | Value |
| --- | --- |
| `decision_id` | DR-0007 |
| `transition` | `construction-to-merge` (coupled `to-operations` Pages publish authorized in the same action) |
| `chosen_option` | `approve` |
| `target` | `main` |
| `unit_of_work` | dependency-consolidation — bump the ESLint 9→10 toolchain and the compatible ecosystem (typescript-eslint, eslint-config-prettier 10, eslint-plugin-react-hooks 7, react-refresh 0.5, globals 17, @types/node 26, jsdom 29, prettier 3.9, typescript 5.9, vite 8.1.5, testing-library patches) in `package.json`/lockfile; re-pin all five GitHub Actions to their new major-version commit SHAs in `ci.yml`/`deploy.yml`; and the two behavior-preserving React fixes that eslint-plugin-react-hooks v7's React-Compiler rules require |
| `rationale` | Consolidates 10 Dependabot PRs into one reviewed change. Runtime deps (react/react-dom/zustand) deliberately untouched — those are separate reviewed migrations. TypeScript held on 5.x because typescript-eslint's peer range caps TS at <6.1 (TS 7 not yet lint-compatible). Two-reviewer gate ran: `code-reviewer` **APPROVE** (verified both React fixes are behavior-preserving — ref-sync moved to a post-commit effect with no stale-read window; popover close via the during-render prevProp idiom, no loop); `security-privacy-reviewer` **clean** (no exfiltration, no new runtime deps, `npm audit` 0 vulns, all-registry.npmjs.org provenance, no typosquats, every new/changed package `dev:true`, workflow permissions unchanged, SHA-pinning intact). The one open reviewer item — independent SHA↔tag confirmation, which both reviewers were sandbox-scoped away from — was resolved by the orchestrator via `git ls-remote`: all five SHAs verified to resolve to their named upstream tags. `npm run check` (588 tests) + production build + catalog-staleness check all green. |
| `approver` | maintainer (kabaka) — directed the consolidate → PR → merge flow for the Dependabot backlog |
| `date` | 2026-07-17 |
| `risk_tier` | standard |

## Recorded scope / design decisions (arbiter-facing, non-silent)

1. **Runtime dependencies held, not bumped.** Dependabot flagged only dev tooling; react 18,
   react-dom 18, and zustand 4 are left byte-identical. React 19 and Zustand 5 are real, wanted
   upgrades but are runtime-affecting majors that each deserve their own reviewed migration unit —
   named follow-ups, not silent drops. `@types/react`/`@types/react-dom` stay on 18 to match.
2. **TypeScript held on the 5.x line (5.6 → 5.9.3).** TypeScript 7 is `latest` on npm, but
   `typescript-eslint@8.64` peers require `typescript <6.1.0`, so moving to TS 6/7 would break
   linting. 5.9.3 is the latest stable within the lint-compatible range and fits the existing
   `^5.6.2` intent. Revisit when typescript-eslint ships TS 7 support.
3. **All five GitHub Actions moved to their latest majors and re-pinned by commit SHA** (checkout
   v7, setup-node v7, configure-pages v6, upload-pages-artifact v5, deploy-pages v5). The
   SHA-pinning + `# vX.Y.Z` comment discipline is preserved for every action; no floating `@vN`
   tags introduced. `engines.node` raised to eslint 10's own floor (`^20.19.0 || ^22.13.0 || >=24`).
4. **Two product-code changes are lint-forced, not feature work.** eslint-plugin-react-hooks v7
   bundles Meta's React-Compiler ESLint rules; its expanded `recommended` preset flags two
   pre-existing patterns. `PedigreeView` ref-sync moved out of render into an effect
   (`react-hooks/refs`); `PedigreeHighlight` close-on-mode-change reworked from a setState-in-effect
   to the during-render prevProp idiom (`react-hooks/set-state-in-effect`). Both verified
   behavior-preserving by the code-reviewer.

## Notes

- Guardrails untouched: no clinical logic, risk/advice/screening/identity code, or exports changed;
  no manufactured number; local-first / no-exfiltration intact (the sole sanctioned network call,
  `src/integrations/vocabulary.ts`, is not in the diff). Determinism preserved — no test asserts on
  the wall clock; the two UI fixes don't touch timing oracles.
- The companion Dependabot **config modernization** (grouped updates → fewest PRs) ships as a
  separate follow-up PR, not folded into this one.
- Named follow-ups carried forward: React 19 migration, Zustand 5 migration, TypeScript 6/7 once
  typescript-eslint supports it.
