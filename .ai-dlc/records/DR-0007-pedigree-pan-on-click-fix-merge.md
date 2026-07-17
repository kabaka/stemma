<!-- ai-dlc:link-check-ignore-file -->

# Decision Record — Pedigree pan-on-click fix (merge + Pages publish)

Records the maintainer's authorization to integrate a single-purpose bug fix — the Pedigree
view no longer lurches/pans when a person is clicked (or when the person drawer closes) — into
`main`. Because `deploy.yml` auto-publishes to GitHub Pages on push to `main`, this action
crosses **both** the Construction→merge gate (Gate 3) **and** the →Operations deploy gate
(Gate 4).

## Machine fields

| Field | Value |
| --- | --- |
| `decision_id` | DR-0007 |
| `transition` | `construction-to-merge` (coupled `to-operations` Pages publish authorized in the same action) |
| `chosen_option` | `approve` |
| `target` | `main` |
| `unit_of_work` | pedigree-pan-on-click-fix — stop the Pedigree pan/zoom viewport (`.pedigree-scroll`) from lurching when a node `<button>` gains focus (on click, on Tab, and on the drawer's focus-return when it closes) |
| `rationale` | Bug report: clicking a person in the Pedigree view sometimes shifted/panned the chart so the clicked person moved elsewhere or off-screen; also on closing the drawer; intermittent; worse for deep/wide (7–8 generation) trees. Root cause reproduced in real headless Chromium via Playwright: `.pedigree-scroll` was `overflow: hidden`, which is still a *scroll container*, so the browser's native "scroll a focused element into view" set `scrollTop`/`scrollLeft` whenever a focused node's box sat near a viewport edge — measured `scrollTop` jumping 0→232→283→… and accumulating across clicks. Panning here is a CSS `transform`, not native scroll, so that stray offset desynced and lurched the whole chart. Fully-centred nodes never triggered it (Chromium's focus-scroll is transform-aware), which is why it was intermittent. Fix: `.pedigree-scroll` → `overflow: clip` (clips identically but is NOT a scroll container, so there is nothing for the browser to scroll) plus `min-width: 0; min-height: 0` (required because `clip`, unlike `hidden`, does not zero a flex item's `min-width: auto`, so without them the viewport grew to the full canvas width — confirmed `clientWidth` regressed 884→5857 without them). Two stale `overflow:hidden` doc-comments in `PedigreeView.tsx` updated to match. Review gate: `code-reviewer` APPROVE (independently reproduced both the bug and the flex-sizing interaction in real Chromium; two Low, non-blocking findings — a browser-fallback note and the stale comments, the latter fixed here); `clinical-safety-reviewer` APPROVE (CSS-only, no guardrail/layering/determinism impact; `ClinicalBoundary` sits in `.pedigree-header`, outside the changed element); `accessibility-reviewer` no blocking findings (verified live that WCAG 2.4.7/2.4.3 hold — the app's own `nudgeToPerson`/`nudgeIntoView` is the sole and sufficient mechanism that reveals an off-screen focused node now that native focus-scroll is gone; keyboard pan/zoom, D-pad, and drawer focus-return all pass). Its one Low finding (focus-ring clipping at min zoom) was empirically re-checked and found to be a local-vs-screen units artifact — the on-screen ring extent is a constant ~4px, well inside the 12px nudge margin (0 clipped rings across 60 focused nodes at `SCALE_MIN`), so no `NUDGE_MARGIN` change was made. `npm run check` green (588 tests), production Pages build green, catalog not stale. |
| `approver` | maintainer (kabaka) — directed the fix → PR → merge → deploy flow for this bug |
| `date` | 2026-07-17 |
| `risk_tier` | standard |

## Notes

- **Guardrails held.** CSS-only viewport-clipping change; touches no risk/advice/screening/
  identity logic, no catalog, no storage, and no network. The pedigree's `ClinicalBoundary`
  is unaffected (separate pinned `.pedigree-header`, not inside `.pedigree-scroll`).
- **No determinism/layering impact.** The change is confined to `src/styles/` plus two
  doc-comment edits in `src/ui/`; the pure core is untouched. Pan/zoom is transient local UI
  state, never persisted, so it cannot corrupt the record.
- **Regression coverage is real-browser-only.** The mechanism (native focus-scroll on a scroll
  container) cannot be exercised under Vitest + jsdom — jsdom reports zero layout and does not
  implement focus-triggered scroll-into-view, so a jsdom assertion of `scrollTop === 0` would
  pass identically under the old, buggy CSS (a fake test, which the delivery rules forbid). A
  durable Playwright-based regression test would need Playwright stood up as a dev dependency;
  that is a proportionate, separate follow-up, not a blocker for this narrow fix. The fix was
  instead verified by real-Chromium reproduction (before/after) during this session.
