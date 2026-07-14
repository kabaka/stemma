// browser-runner.mjs — the shared driver that wires the four browser/app
// visual-QA tools to the FAIL-CLOSED app-exec harness.
//
// Each tool supplies an `audit(ctx)` async callback. This runner:
//   1. parses common args (--repo, --confirm-exec, --baseline-dir, --tolerance),
//   2. calls authorizeAndRun() from the harness (which owns the dev-server
//      launch, confirmation gate, env allowlist, containment), and
//   3. inside the harness `audit` hook, validates the loopback base, loads the
//      managed chromium (SKIP on absence), and invokes the tool's callback with
//      a ready browser + validated base + output dir.
//
// The runner NEVER spawns a process itself. The ONLY process launched is the
// dev server (by the harness) and the managed chromium (by Playwright via its
// own shell:false API). Any security refusal from browser-lib is a ToolError →
// the harness/runner maps it to ERROR(2). Browser/dep absence → SKIPPED(3).

import { resolve } from 'node:path';
import { existsSync, statSync, realpathSync } from 'node:fs';
import { EXIT, ToolError, resolveContained, isContained } from '../lib/binding.mjs';
import { authorizeAndRun } from '../lib/app-exec-harness.mjs';
import {
  loadChromium,
  kitLaunchOptions,
  validateLoopbackBase,
  BrowserAbsentError,
  INSTALL_REMEDIATION,
} from './browser-lib.mjs';
import { startStaticServer } from './static-server.mjs';

const DEFAULT_STATIC_DIR = '.ai-dlc/visual-qa-build';

// Parse the common arg surface for a browser tool. Tool-specific flags are
// passed through in `extra` (a map of flag -> {takesValue}).
export function parseCommonArgs(argv, extra = {}) {
  const args = { repo: process.cwd(), confirmExec: undefined, help: false, _: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--repo') { const n = argv[i + 1]; if (n === undefined) throw new ToolError('--repo requires a path'); args.repo = n; i++; }
    else if (a.startsWith('--repo=')) args.repo = a.slice('--repo='.length);
    else if (a === '--confirm-exec') { const n = argv[i + 1]; if (n === undefined) throw new ToolError('--confirm-exec requires a hash'); args.confirmExec = n; i++; }
    else if (a.startsWith('--confirm-exec=')) args.confirmExec = a.slice('--confirm-exec='.length);
    else if (Object.prototype.hasOwnProperty.call(extra, a)) {
      if (extra[a].takesValue) { const n = argv[i + 1]; if (n === undefined) throw new ToolError(`${a} requires a value`); args._[a] = n; i++; }
      else args._[a] = true;
    } else if (a.startsWith('--')) {
      // flag=value form for an extra value flag
      const eq = a.indexOf('=');
      if (eq > 0) {
        const flag = a.slice(0, eq);
        if (Object.prototype.hasOwnProperty.call(extra, flag) && extra[flag].takesValue) { args._[flag] = a.slice(eq + 1); continue; }
      }
      throw new ToolError(`unknown argument: ${a}`);
    } else {
      throw new ToolError(`unknown argument: ${a}`);
    }
  }
  return args;
}

// Run a browser tool. `opts`:
//   toolName    — for messages.
//   args        — parsed common args.
//   audit       — async ({ browser, base, outputDir, binding, childResult, tool }) =>
//                   { evaluated, findings, notes? }
//                 `evaluated` = count of pages/views actually examined (>0 required
//                 for PASS). `findings` = array of finding strings.
//   toolState   — opaque object passed through to the audit callback as `tool`.
//
// Returns a process exit code from the contract. NEVER calls process.exit.
export async function runBrowserTool(opts) {
  const { toolName, args, audit, toolState } = opts;
  const out = process.stdout;
  const err = process.stderr;

  const repoRoot = resolve(args.repo);
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
    err.write(`ERROR: --repo path is not a directory: ${repoRoot}\n`);
    return EXIT.ERROR;
  }

  // The harness owns the dev-server launch + confirmation. We inject an audit
  // hook that drives the browser. If the audit hook throws a BrowserAbsentError
  // it must become SKIPPED, not ERROR — but the harness maps a thrown audit to
  // ERROR(2). So we CATCH browser-absence INSIDE the hook and return a sentinel
  // the harness understands: evaluated:0 with a printed SKIP reason → SKIPPED(3).
  let skipNote = null;

  const harnessAudit = async (childResult, outputDir) => {
    // Re-load the (re-validated) binding via the same loader the harness used,
    // so paths/dirs come from the confirmed binding. The harness already
    // re-read it; we read it again read-only for the browser-layer fields.
    const { loadBinding } = await import('../lib/binding.mjs');
    const bi = loadBinding(repoRoot);
    if (!bi.present) {
      skipNote = 'binding disappeared before audit';
      return { evaluated: 0, findings: [] };
    }
    const binding = bi.binding;

    // R13: the loopback base is KIT-CHOSEN. The consumer's harness-launched
    // command (their own build/export code) emitted static files into a repo-
    // local, containment-checked dir; we serve THAT on 127.0.0.1:<ephemeral>
    // and navigate only there. The binding never supplies the navigation origin
    // — only a repo-local `static_dir` whose containment the shared lib enforces.
    let rawStaticDir = typeof binding.static_dir === 'string' && binding.static_dir.length > 0
      ? binding.static_dir : DEFAULT_STATIC_DIR;
    if (rawStaticDir.includes('://')) {
      throw new ToolError(`static_dir must be a REPO-LOCAL path, not a URL: ${JSON.stringify(rawStaticDir)}`);
    }
    const containedStaticDir = resolveContained(repoRoot, rawStaticDir, 'static_dir', 'read');
    if (!existsSync(containedStaticDir) || !statSync(containedStaticDir).isDirectory()) {
      skipNote = `the consumer build dir ${JSON.stringify(rawStaticDir)} was not produced — ` +
        `the launch command must emit static files there before audit`;
      return { evaluated: 0, findings: [] };
    }
    const realStaticDir = realpathSync(containedStaticDir);
    const realRepoRoot = realpathSync(repoRoot);
    if (!isContained(realRepoRoot, realStaticDir)) {
      throw new ToolError(`static_dir escapes the repo root via symlink: ${rawStaticDir}`);
    }

    // R12: load managed chromium; absence → SKIP (not ERROR). Done BEFORE we
    // bind a server so an absent browser never opens a socket needlessly.
    let chromium, executablePath;
    try {
      ({ chromium, executablePath } = await loadChromium());
    } catch (e) {
      if (e instanceof BrowserAbsentError) {
        skipNote = e.message;
        return { evaluated: 0, findings: [] };
      }
      throw e;
    }

    // Start the kit-owned loopback static server on an ephemeral kit-chosen port.
    let serverHandle;
    try {
      serverHandle = await startStaticServer(realStaticDir);
    } catch (e) {
      throw new ToolError(`could not start the kit-owned loopback server: ${e.message}`);
    }
    // R13: hard-validate the kit-chosen base is loopback (it is, by construction;
    // this is belt-and-suspenders so the invariant is asserted, not assumed).
    const base = validateLoopbackBase(serverHandle.baseUrl);

    let browser;
    try {
      browser = await chromium.launch(kitLaunchOptions());
    } catch (e) {
      await serverHandle.close();
      skipNote = `chromium failed to launch: ${e.message}. ${INSTALL_REMEDIATION}`;
      return { evaluated: 0, findings: [] };
    }

    try {
      const result = await audit({
        browser, base, outputDir, binding, childResult, tool: toolState,
        executablePath, repoRoot, staticDir: realStaticDir,
      });
      if (result && (result.evaluated ?? 0) <= 0 && result.skipReason) {
        skipNote = result.skipReason;
      }
      // Print the per-finding detail HERE (the harness only prints the FINDINGS
      // count). Each line is prefixed so it is greppable and unambiguous.
      const fnds = result && Array.isArray(result.findings) ? result.findings : [];
      if (fnds.length > 0) {
        out.write(`${toolName} findings (${fnds.length}):\n`);
        for (const f of fnds) out.write(`  - ${f}\n`);
      }
      return result;
    } finally {
      await browser.close().catch(() => {});
      await serverHandle.close().catch(() => {});
    }
  };

  const code = await authorizeAndRun({
    repoRoot,
    confirmToken: args.confirmExec,
    audit: harnessAudit,
    out,
    err,
  });

  // The harness prints its own SKIPPED line for evaluated<=0, but it can't know
  // WHY (browser-absent vs nothing-to-audit). Emit the precise reason so the
  // remediation is actionable and honest.
  if (code === EXIT.SKIPPED && skipNote) {
    out.write(`SKIPPED-DETAIL (${toolName}): ${skipNote}\n`);
  }
  return code;
}
