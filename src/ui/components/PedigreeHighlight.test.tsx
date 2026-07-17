/**
 * Regression coverage for the pressed highlight-row category-label contrast fix
 * (review-gate finding): `.pedigree-hl-row[aria-pressed='true'] .mono-dim` used to keep
 * `.mono-dim`'s own `color: var(--text-faint)` — a class-selector beats the row's
 * inherited `color: var(--accent)` on specificity — which measured ~3.77:1 against the
 * pressed row's background, short of WCAG 1.4.3's 4.5:1. The fix gives that combined
 * selector `color: currentColor` so it resolves to whatever the pressed row's own colour
 * is instead.
 *
 * This can't be asserted by rendering the component and reading `getComputedStyle`:
 * `vite.config.ts` sets `test.css: false`, so Vitest never loads the app's real
 * stylesheets into jsdom at all (see CONTRIBUTING.md's test-conventions section and the
 * existing `toHaveStyle` assertions elsewhere in this codebase, which all target inline
 * `style` props for exactly this reason, never cascaded stylesheet rules). Instead this
 * reads the actual CSS source files and checks the real rule text and real design-token
 * values — so a future revert of either is still caught — and reimplements PedigreeView's
 * own (unexported, so not importable without touching product code) WCAG contrast math to
 * verify the fix is not just present but numerically sufficient.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Repo-root-relative, matching scripts/gen-conditions.mjs's own convention (it reads
// 'scripts/conditions.source.json' the same way) — `import.meta.url` isn't a plain
// `file://` URL under Vitest's transform pipeline, so `fileURLToPath` can't be used here.
const COMPONENTS_CSS = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');
const THEME_CSS = readFileSync(resolve(process.cwd(), 'src/styles/theme.css'), 'utf8');
// Strip comments before matching: the fix's own explanatory comment quotes the OLD
// declaration verbatim (`` `color: var(--text-faint)` ``) inside the rule block, which
// would otherwise be the first "color:" text a naive regex finds.
const CSS_RULES_ONLY = COMPONENTS_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

function cssVar(name: string): string {
  const m = THEME_CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`));
  if (!m) throw new Error(`--${name} not found in theme.css`);
  return m[1];
}

// --- WCAG contrast math — duplicated from PedigreeView.tsx's own relativeLuminance/
// contrastRatio (neither is exported, and this test can't touch product code to export
// them), kept byte-for-byte equivalent to that implementation. ---
function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}
/** Alpha-composite a translucent foreground hex over an opaque background hex — the
 * pressed row's own background is a translucent accent tint over the popover surface. */
function blend(fgHex: string, alpha: number, bgHex: string): string {
  const [fr, fg, fb] = hexToRgb(fgHex);
  const [br, bg, bb] = hexToRgb(bgHex);
  const toHex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${toHex(fr * alpha + br * (1 - alpha))}${toHex(fg * alpha + bg * (1 - alpha))}${toHex(fb * alpha + bb * (1 - alpha))}`;
}

describe('pedigree highlight row — pressed category-label contrast (regression)', () => {
  it("the pressed row's .mono-dim category label resolves to currentColor, not --text-faint", () => {
    const ruleMatch = CSS_RULES_ONLY.match(
      /\.pedigree-hl-row\[aria-pressed='true'\]\s*\.mono-dim\s*\{([^}]*)\}/,
    );
    expect(ruleMatch).not.toBeNull();
    const colorMatch = ruleMatch![1].match(/color:\s*([^;]+);/);
    expect(colorMatch).not.toBeNull();
    expect(colorMatch![1].trim()).toBe('currentColor');
  });

  it('currentColor clears 4.5:1 against the pressed background; the old --text-faint value would not', () => {
    const accent = cssVar('accent');
    const textFaint = cssVar('text-faint');
    // The popover surface the row sits on (`.pedigree-hl-search-popover { background:
    // var(--bg-panel); }`) — the row itself has no opaque background except when pressed.
    const bgPanel = cssVar('bg-panel');

    // Read the pressed row's actual translucent overlay
    // (`.pedigree-hl-row[aria-pressed='true'] { background: rgba(r, g, b, a); }`) rather
    // than hardcoding it, so a future retint is reflected here too.
    const bgRuleMatch = CSS_RULES_ONLY.match(
      /\.pedigree-hl-row\[aria-pressed='true'\]\s*\{([^}]*)\}/,
    );
    expect(bgRuleMatch).not.toBeNull();
    const rgbaMatch = bgRuleMatch![1].match(
      /background:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/,
    );
    expect(rgbaMatch).not.toBeNull();
    const [, r, g, b, a] = rgbaMatch!;
    const toHex = (v: string) => Number(v).toString(16).padStart(2, '0');
    const overlayHex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    const pressedBg = blend(overlayHex, Number(a), bgPanel);

    // The fix: resolving to the row's own currentColor (--accent when pressed) clears AA.
    expect(contrastRatio(accent, pressedBg)).toBeGreaterThanOrEqual(4.5);
    // The regression this guards against: --text-faint was --mono-dim's own hardcoded
    // colour, and it does NOT clear AA against this same background — reproduced
    // numerically here (not just asserted structurally above) to show why the old
    // specificity fight actually mattered, not merely that the rule text changed.
    expect(contrastRatio(textFaint, pressedBg)).toBeLessThan(4.5);
  });
});
