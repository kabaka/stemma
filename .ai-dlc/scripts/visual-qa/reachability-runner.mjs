#!/usr/bin/env node
// reachability-runner.mjs — AI-DLC visual-QA: every declared route actually renders.
//
// WHAT IT DOES
//   Routes through the FAIL-CLOSED app-exec harness to launch the consumer's dev
//   server, then drives the managed chromium to EACH declared user-reachable path
//   (route) on the loopback server and asserts it renders: a 2xx/3xx response, a
//   non-empty <body>, and no uncaught page error / failed top-level navigation.
//   A route that fails to render is a FINDING. PASS only if >=1 route was actually
//   driven and all rendered. This is the end-to-end-reachability evidence:
//   it proves every named user-reachable path is wired to something real.
//
// SECURITY
//   Launch only via the harness. R12 kit-owned in-code Playwright config. R13
//   loopback-only navigation (routes are PATH-ONLY). R14 off-origin abort,
//   downloads disabled, nav timeout. R17 routes capped. R18 browser/dep absent
//   or unconfirmed → SKIPPED(3), never a forged PASS.
//
// EXIT-CONTRACT — SKIPPED is NOT a PASS
//   0 PASS    — >=1 route driven, all rendered.
//   1 FINDINGS— a route failed to render (bad status / empty body / page error).
//   2 ERROR   — bad invocation / security refusal.
//   3 SKIPPED — no binding / non-visual / unconfirmed / browser|dep absent /
//               no routes / nothing driven.
//
// USAGE
//   node product/scripts/visual-qa/reachability-runner.mjs [--repo <path>] [--confirm-exec <hash>]
//
// MODEL
//   The harness runs the consumer's build/export to completion (emitting static
//   files into the repo-local `static_dir`); the kit serves that on a loopback
//   ephemeral port and drives each route.
//
// BINDING FIELDS READ
//   static_dir : repo-local build dir (default ".ai-dlc/visual-qa-build").
//   routes     : ["/", "/about", ...] PATH-ONLY user-reachable routes. Falls
//                back to audit_paths, then ["/"].

import { EXIT } from '../lib/binding.mjs';
import { parseCommonArgs, runBrowserTool } from './browser-runner.mjs';
import { buildLoopbackUrl, readAuditPaths, normalizeAuditPath, withPage, CAPS } from './browser-lib.mjs';
import { ToolError } from '../lib/binding.mjs';

const HELP = `reachability-runner — AI-DLC visual-QA route-reachability check (via the fail-closed harness)

Usage:
  node product/scripts/visual-qa/reachability-runner.mjs [--repo <path>] [--confirm-exec <hash>]

Drives each declared route on the loopback dev server and flags any that fail to
render. Launches the dev server ONLY through the app-exec harness (human-confirmed).

Exit codes:
  0 PASS     >=1 route driven, all rendered
  1 FINDINGS a route failed to render
  2 ERROR    bad invocation / security refusal
  3 SKIPPED  no binding / non-visual / unconfirmed / browser|dep absent / nothing driven
`;

function readRoutes(binding) {
  const raw = binding.routes;
  if (raw === undefined || raw === null) return readAuditPaths(binding); // fall back to audit_paths/["/"]
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolError('routes must be a non-empty array of path strings');
  }
  if (raw.length > CAPS.MAX_AUDIT_PATHS) {
    throw new ToolError(`routes exceeds the ${CAPS.MAX_AUDIT_PATHS}-entry cap`);
  }
  return raw.map((p, i) => { normalizeAuditPath(p, `routes[${i}]`); return p; });
}

async function audit({ browser, base, binding }) {
  const routes = readRoutes(binding);
  const findings = [];
  let evaluated = 0;

  for (const p of routes) {
    const url = buildLoopbackUrl(base, p, `route ${JSON.stringify(p)}`);
    const r = await withPage(browser, base, undefined, async (page) => {
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));
      let resp, navError = null;
      try {
        resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
      } catch (e) {
        navError = e.message;
      }
      if (navError) return { rendered: false, reason: `navigation failed: ${navError}` };
      if (!resp) return { rendered: false, reason: 'no response' };
      const status = resp.status();
      if (status >= 400) return { rendered: false, reason: `HTTP ${status}` };
      // Non-empty body text or at least some DOM content.
      const bodyLen = await page.evaluate(() => (document.body ? document.body.innerText.trim().length
        + document.body.querySelectorAll('*').length : 0));
      if (bodyLen === 0) return { rendered: false, reason: `rendered an empty body (HTTP ${status})` };
      if (pageErrors.length > 0) return { rendered: false, reason: `uncaught page error: ${pageErrors[0]}` };
      return { rendered: true, status };
    });

    evaluated++;
    if (!r.rendered) {
      if (findings.length < CAPS.MAX_FINDINGS_OUTPUT) {
        findings.push(`route ${p}: ${r.reason}`);
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

  return runBrowserTool({ toolName: 'reachability-runner', args, audit });
}

process.exit(await main());
