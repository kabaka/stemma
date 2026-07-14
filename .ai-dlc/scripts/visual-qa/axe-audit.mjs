#!/usr/bin/env node
// axe-audit.mjs — AI-DLC visual-QA: WCAG accessibility audit on the loopback app.
//
// WHAT IT DOES
//   Routes through the FAIL-CLOSED app-exec harness to launch the consumer's dev
//   server (human-confirmed per session), drives the managed chromium to each
//   declared audit_path on the loopback server, injects axe-core via
//   @axe-core/playwright (AxeBuilder), and runs the WCAG 2 A/AA rule set. Any
//   violation is a FINDING. PASS only if >=1 page was ACTUALLY audited with zero
//   violations (an empty audit set is SKIPPED, never PASS).
//
// SECURITY
//   Launch only via the harness (no direct spawn). R12 kit-owned in-code
//   Playwright config (never the repo's playwright.config.*). R13 loopback-only
//   navigation; audit_paths are PATH-ONLY. R14 off-origin requests aborted,
//   downloads disabled, nav timeout set. R18 browser/dep-absent or
//   unconfirmed → SKIPPED(3), never a forged PASS.
//
// EXIT-CONTRACT (lib/contract.mjs) — SKIPPED is NOT a PASS
//   0 PASS    — >=1 page audited, zero WCAG violations.
//   1 FINDINGS— >=1 WCAG violation found.
//   2 ERROR   — bad invocation / security refusal (off-loopback, bad path/exec).
//   3 SKIPPED — no binding / non-visual / unconfirmed / browser|dep absent /
//               nothing audited.
//
// USAGE
//   node product/scripts/visual-qa/axe-audit.mjs [--repo <path>] [--confirm-exec <hash>]
//
// MODEL
//   The harness runs the consumer's OWN build/export command (their code) to
//   completion; it must emit static files into the repo-local `static_dir`. The
//   kit then serves that dir on 127.0.0.1:<ephemeral> and audits it. The binding
//   never supplies the navigation origin.
//
// BINDING FIELDS READ (browser layer)
//   static_dir  : repo-local dir the build command emits (default ".ai-dlc/visual-qa-build").
//   audit_paths : ["/", "/about", ...] PATH-ONLY routes to audit (default ["/"]).
//   axe_tags    : optional override of WCAG tag set (default wcag2a/aa + 21).

import { EXIT, ToolError } from '../lib/binding.mjs';
import { parseCommonArgs, runBrowserTool } from './browser-runner.mjs';
import { buildLoopbackUrl, readAuditPaths, CAPS } from './browser-lib.mjs';

const DEFAULT_AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const HELP = `axe-audit — AI-DLC visual-QA WCAG audit on the loopback app (via the fail-closed harness)

Usage:
  node product/scripts/visual-qa/axe-audit.mjs [--repo <path>] [--confirm-exec <hash>]

Launches the consumer dev server ONLY through the app-exec harness (human-confirmed
per session), then audits each binding audit_path on the loopback server with axe-core.

Exit codes:
  0 PASS     >=1 page audited, zero WCAG violations
  1 FINDINGS a WCAG violation was found
  2 ERROR    bad invocation / security refusal
  3 SKIPPED  no binding / non-visual / unconfirmed / browser|dep absent / nothing audited
`;

function readAxeTags(binding) {
  const raw = binding.axe_tags;
  if (raw === undefined || raw === null) return DEFAULT_AXE_TAGS;
  if (!Array.isArray(raw) || raw.some((t) => typeof t !== 'string') || raw.length === 0) {
    throw new ToolError('axe_tags must be a non-empty array of strings');
  }
  if (raw.length > 32) throw new ToolError('axe_tags exceeds 32 entries');
  return raw;
}

async function audit({ browser, base, binding }) {
  const paths = readAuditPaths(binding);
  const tags = readAxeTags(binding);

  // Dynamic import so dep-absence is reported honestly by the runner layer.
  let AxeBuilder;
  try {
    AxeBuilder = (await import('@axe-core/playwright')).default;
  } catch (e) {
    // Treat as a (security-clean) dependency absence → no evaluation → SKIP.
    return { evaluated: 0, findings: [], skipReason: `@axe-core/playwright not installed: ${e.message}` };
  }

  const findings = [];
  let evaluated = 0;
  const { withPage } = await import('./browser-lib.mjs');

  for (const p of paths) {
    const url = buildLoopbackUrl(base, p, `audit_paths entry ${JSON.stringify(p)}`); // R13 re-validate
    const pageFindings = await withPage(browser, base, undefined, async (page) => {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (!resp || !resp.ok()) {
        // A route that fails to render is a finding for an a11y audit too: we
        // could not audit it. Record but do NOT count as evaluated-clean.
        return { rendered: false, status: resp ? resp.status() : 'no-response', violations: [] };
      }
      const results = await new AxeBuilder({ page }).withTags(tags).analyze();
      return { rendered: true, status: resp.status(), violations: results.violations };
    });

    if (!pageFindings.rendered) {
      findings.push(`${p}: did not render (HTTP ${pageFindings.status}) — could not audit`);
      continue;
    }
    evaluated++;
    for (const v of pageFindings.violations) {
      if (findings.length >= CAPS.MAX_FINDINGS_OUTPUT) break;
      findings.push(
        `${p}: [${v.impact || 'n/a'}] ${v.id} — ${v.help} (${v.nodes.length} node(s))`
      );
    }
  }

  return { evaluated, findings };
}

async function main() {
  let args;
  try { args = parseCommonArgs(process.argv.slice(2)); }
  catch (e) { process.stderr.write(`ERROR: ${e.message}\n\n${HELP}`); return EXIT.ERROR; }
  if (args.help) { process.stdout.write(HELP); return EXIT.PASS; }

  return runBrowserTool({ toolName: 'axe-audit', args, audit });
}

process.exit(await main());
