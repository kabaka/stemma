#!/usr/bin/env node
// responsive-check.mjs — AI-DLC visual-QA: responsive-layout check on the loopback app.
//
// WHAT IT DOES
//   Routes through the FAIL-CLOSED app-exec harness to launch the consumer's dev
//   server, then loads each declared audit_path at each declared breakpoint
//   (viewport) in the managed chromium and detects layout breaks: horizontal
//   overflow (document scrollWidth wider than the viewport) and elements that
//   spill outside the viewport on the x-axis. Any break is a FINDING. PASS only
//   if >=1 (path,viewport) combination was actually evaluated with no breaks.
//
// SECURITY
//   Launch only via the harness. R12 kit-owned in-code Playwright config. R13
//   loopback-only navigation (audit_paths PATH-ONLY). R14 off-origin abort,
//   downloads disabled, nav timeout. R17 viewports capped. R18 browser/dep
//   absent or unconfirmed → SKIPPED(3), never a forged PASS.
//
// EXIT-CONTRACT — SKIPPED is NOT a PASS
//   0 PASS    — >=1 (path,viewport) evaluated, no layout break.
//   1 FINDINGS— a layout break (overflow / off-viewport element) was found.
//   2 ERROR   — bad invocation / security refusal.
//   3 SKIPPED — no binding / non-visual / unconfirmed / browser|dep absent /
//               no breakpoints / nothing evaluated.
//
// USAGE
//   node product/scripts/visual-qa/responsive-check.mjs [--repo <path>] [--confirm-exec <hash>]
//
// MODEL
//   The harness runs the consumer's build/export to completion (emitting static
//   files into the repo-local `static_dir`); the kit serves that on a loopback
//   ephemeral port and audits it.
//
// BINDING FIELDS READ
//   static_dir  : repo-local build dir (default ".ai-dlc/visual-qa-build").
//   audit_paths : PATH-ONLY routes (default ["/"]).
//   breakpoints : [{ "label": "mobile", "width": 375, "height": 667 }, ...]
//                 (defaults to a mobile/tablet/desktop trio).

import { EXIT, ToolError } from '../lib/binding.mjs';
import { parseCommonArgs, runBrowserTool } from './browser-runner.mjs';
import { buildLoopbackUrl, readAuditPaths, withPage, CAPS } from './browser-lib.mjs';

const DEFAULT_BREAKPOINTS = [
  { label: 'mobile', width: 375, height: 667 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'desktop', width: 1280, height: 800 },
];

const HELP = `responsive-check — AI-DLC visual-QA responsive-layout check (via the fail-closed harness)

Usage:
  node product/scripts/visual-qa/responsive-check.mjs [--repo <path>] [--confirm-exec <hash>]

Loads each audit_path at each breakpoint and flags horizontal overflow / off-viewport
elements. Launches the dev server ONLY through the app-exec harness (human-confirmed).

Exit codes:
  0 PASS     >=1 (path,viewport) evaluated, no break
  1 FINDINGS a layout break was found
  2 ERROR    bad invocation / security refusal
  3 SKIPPED  no binding / non-visual / unconfirmed / browser|dep absent / nothing evaluated
`;

function readBreakpoints(binding) {
  const raw = binding.breakpoints;
  if (raw === undefined || raw === null) return DEFAULT_BREAKPOINTS;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolError('breakpoints must be a non-empty array');
  }
  if (raw.length > CAPS.MAX_VIEWPORTS) {
    throw new ToolError(`breakpoints exceeds the ${CAPS.MAX_VIEWPORTS}-entry cap`);
  }
  return raw.map((b, i) => {
    if (b === null || typeof b !== 'object' || Array.isArray(b)) {
      throw new ToolError(`breakpoints[${i}] must be an object {label,width,height}`);
    }
    const width = b.width, height = b.height;
    if (!Number.isInteger(width) || width < 100 || width > CAPS.MAX_IMAGE_DIM) {
      throw new ToolError(`breakpoints[${i}].width must be an integer 100..${CAPS.MAX_IMAGE_DIM}`);
    }
    if (!Number.isInteger(height) || height < 100 || height > CAPS.MAX_IMAGE_DIM) {
      throw new ToolError(`breakpoints[${i}].height must be an integer 100..${CAPS.MAX_IMAGE_DIM}`);
    }
    const label = typeof b.label === 'string' ? b.label : `${width}x${height}`;
    return { label, width, height };
  });
}

async function audit({ browser, base, binding }) {
  const paths = readAuditPaths(binding);
  const breakpoints = readBreakpoints(binding);

  const findings = [];
  let evaluated = 0;

  for (const p of paths) {
    const url = buildLoopbackUrl(base, p, `audit_paths entry ${JSON.stringify(p)}`);
    for (const bp of breakpoints) {
      const r = await withPage(browser, base, { width: bp.width, height: bp.height }, async (page) => {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
        if (!resp || !resp.ok()) {
          return { rendered: false, status: resp ? resp.status() : 'no-response' };
        }
        // Measure overflow in the page. scrollWidth > innerWidth (+1px slack)
        // means horizontal overflow; also collect a few offending elements.
        const metrics = await page.evaluate((vw) => {
          const docW = Math.max(
            document.documentElement.scrollWidth,
            document.body ? document.body.scrollWidth : 0
          );
          const offenders = [];
          const all = document.querySelectorAll('*');
          for (let i = 0; i < all.length && offenders.length < 5; i++) {
            const el = all[i];
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.right > vw + 1) {
              const id = el.id ? `#${el.id}` : '';
              const cls = el.className && typeof el.className === 'string'
                ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
              offenders.push(`${el.tagName.toLowerCase()}${id}${cls} (right=${Math.round(rect.right)})`);
            }
          }
          return { docW, vw, offenders };
        }, bp.width);
        return { rendered: true, status: resp.status(), metrics };
      });

      if (!r.rendered) {
        findings.push(`${p} @ ${bp.label} (${bp.width}x${bp.height}): did not render (HTTP ${r.status})`);
        continue;
      }
      evaluated++;
      const overflowPx = r.metrics.docW - bp.width;
      if (overflowPx > 1) {
        const off = r.metrics.offenders.length ? ` — e.g. ${r.metrics.offenders.join('; ')}` : '';
        if (findings.length < CAPS.MAX_FINDINGS_OUTPUT) {
          findings.push(
            `${p} @ ${bp.label} (${bp.width}x${bp.height}): horizontal overflow ` +
            `${overflowPx}px (content ${r.metrics.docW}px > viewport ${bp.width}px)${off}`
          );
        }
      }
    }
  }

  return { evaluated, findings };
}

async function main() {
  let args;
  try { args = parseCommonArgs(process.argv.slice(2)); }
  catch (e) { process.stderr.write(`ERROR: ${e.message}\n\n${HELP}`); return EXIT.ERROR; }
  if (args.help) { process.stdout.write(HELP); return EXIT.PASS; }

  return runBrowserTool({ toolName: 'responsive-check', args, audit });
}

process.exit(await main());
