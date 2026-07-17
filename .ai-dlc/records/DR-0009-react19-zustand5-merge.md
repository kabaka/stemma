<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — React 19 + Zustand 5 runtime-dependency upgrade merge

Records the maintainer's authorization to integrate Dependabot PR **#35** (production-dependencies
group) into `main`: **react** and **react-dom** 18.3.1 → 19.2.7, **zustand** 4.5.7 → 5.0.14, with
matching `@types/react` 18 → 19 and `@types/react-dom` 18 → 19. This is the React 19 / Zustand 5
migration named as a carried-forward follow-up in **DR-0007**. Because `deploy.yml` auto-publishes to
GitHub Pages on push to `main`, this action crosses **both** the Construction→merge gate (Gate 3)
**and** the →Operations deploy gate (Gate 4).

## Machine fields

| Field | Value |
| --- | --- |
| `decision_id` | DR-0009 |
| `transition` | `construction-to-merge` (coupled `to-operations` Pages publish authorized in the same action) |
| `chosen_option` | `approve` |
| `target` | `main` |
| `unit_of_work` | react19-zustand5-upgrade — bump the two runtime majors (react/react-dom 18→19, zustand 4→5) and their `@types` in `package.json`/lockfile, plus the one compat fix React 19's ref typing forces |
| `rationale` | Delivers the React 19 and Zustand 5 migrations deferred by DR-0007. One compat fix was required: React 19's `@types/react` types `useRef<T>(null)` as `RefObject<T \| null>`, so `useDisclosureFocus`'s declared `RefObject<T>` return type no longer type-checks — widened to match (`src/ui/hooks.ts:17`); both call sites only spread the ref onto a `ref=` prop, so runtime behavior is unchanged. Entry point already uses `createRoot`; both zustand stores already use the curried `create<T>()(...)` form and the stable `persist` `migrate`/`merge`/`partialize` options v5 leaves unchanged. Two-reviewer gate ran: `code-reviewer` **APPROVE** (verified the type widening is a correct fix not a mask — every `.current` access in `src/ui/` uses optional chaining; no `defaultProps`/`forwardRef`/`findDOMNode`/string-refs/legacy-render to break; zustand v5 default-export removal and curried-create/getState/setState surface all clear); `clinical-safety-reviewer` **clean on rules A–D** (no domain/risk/screening/advice/identity file touched; persist middleware unchanged so local-first record hydration is safe; no new network/exfiltration surface; clinical-boundary text still renders). `npm run check` (format + lint + typecheck + 588 tests) green; `npm run build` green; app boots under React 19 in a headless browser with **zero console errors** and the clinical-boundary text present. |
| `approver` | maintainer (kabaka) — directed "get PR #35 ready and merge it" |
| `date` | 2026-07-17 |
| `risk_tier` | standard |

## Recorded scope / design decisions (arbiter-facing, non-silent)

1. **Two runtime majors, one required compat fix.** react/react-dom 18→19 and zustand 4→5 are the
   exact upgrades DR-0007 held back as named follow-ups. The only product-code change is the
   `useDisclosureFocus` return-type widening in `src/ui/hooks.ts` — lint/type-forced by React 19's
   tightened ref typing, not feature work, and verified behavior-preserving by the code-reviewer.
2. **No render-API or store-API migration needed.** `src/main.tsx` already used
   `createRoot` (React 18+ API, forward-compatible with 19), and both stores
   (`src/store/useStore.ts`, `src/store/useHistoryStore.ts`) already used the curried
   `create<T>()(...)` form zustand 5 requires with the middleware options it left stable — so the
   majors landed without a store rewrite.
3. **Transitive cleanup only.** The lockfile drops `loose-envify`, `use-sync-external-store`, and
   `@types/prop-types` (no longer pulled in by react 19 / zustand 5) and bumps `scheduler`
   0.23 → 0.27. No new top-level dependency was introduced; `npm audit` reports 0 vulnerabilities.

## Notes

- Guardrails untouched: no clinical logic, risk/advice/screening/identity code, catalog, or exports
  changed; no manufactured number; local-first / no-exfiltration intact (the sole sanctioned network
  call, `src/integrations/vocabulary.ts`, is not in the diff). Determinism preserved — no test
  asserts on the wall clock and the hook change doesn't touch any timing oracle.
- Named follow-ups carried forward from DR-0007 that remain open: TypeScript 6/7 once
  typescript-eslint supports it.
