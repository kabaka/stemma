#!/usr/bin/env node
// pixel-diff.mjs — AI-DLC visual-QA: screenshot pixel-diff vs repo-local baselines.
//
// WHAT IT DOES
//   Routes through the FAIL-CLOSED app-exec harness to launch the consumer's dev
//   server, screenshots each declared audit_path on the loopback server with the
//   managed chromium, and diffs each screenshot against a REPO-LOCAL committed
//   baseline PNG using pixelmatch/pngjs. A diff over tolerance is a FINDING.
//   SKIP if there are no baselines at all (nothing to compare → not a PASS).
//
// SECURITY (THE THREAT MODEL)
//   R12 kit-owned in-code Playwright config. R13 loopback-only navigation
//   (audit_paths PATH-ONLY). R14 off-origin abort, downloads disabled, nav
//   timeout. R15 baselines are REPO-LOCAL and containment-checked (resolveContained
//   via the shared lib) — NEVER fetched from a binding-supplied URL. Every PNG
//   (baseline AND fresh screenshot) decode is bounded by BOTH byte size AND pixel
//   dimensions to defeat decompression bombs → an oversize image is ERROR/SKIP,
//   never a forged PASS. R17 screenshots capped; output only into the harness's
//   freshly-created kit-owned subdir. R18 browser/dep absent or unconfirmed →
//   SKIPPED(3).
//
// EXIT-CONTRACT — SKIPPED is NOT a PASS
//   0 PASS    — >=1 screenshot compared to a baseline, all within tolerance.
//   1 FINDINGS— a screenshot differs from its baseline beyond tolerance.
//   2 ERROR   — bad invocation / security refusal / oversize|undecodable image /
//               dimension mismatch with a baseline.
//   3 SKIPPED — no binding / non-visual / unconfirmed / browser|dep absent /
//               NO baselines present / nothing compared.
//
// USAGE
//   node product/scripts/visual-qa/pixel-diff.mjs [--repo <path>] [--confirm-exec <hash>]
//     [--baseline-dir <repo-relative path>] [--tolerance <0..1>]
//
// MODEL
//   The harness runs the consumer's build/export to completion (emitting static
//   files into the repo-local `static_dir`); the kit serves that on a loopback
//   ephemeral port and screenshots it.
//
// BINDING FIELDS READ
//   static_dir      : repo-local build dir (default ".ai-dlc/visual-qa-build").
//   audit_paths     : PATH-ONLY routes (default ["/"]); baseline file per path.
//   baseline_dir    : repo-relative dir of committed PNG baselines (default
//                     ".ai-dlc/visual-baselines"). NEVER a URL.
//   pixel_tolerance : fraction of pixels (0..1) allowed to differ (default 0.01).

import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXIT, ToolError, resolveContained, rel,
} from '../lib/binding.mjs';
import { parseCommonArgs, runBrowserTool } from './browser-runner.mjs';
import { buildLoopbackUrl, readAuditPaths, withPage, CAPS } from './browser-lib.mjs';

const DEFAULT_BASELINE_DIR = '.ai-dlc/visual-baselines';
const DEFAULT_TOLERANCE = 0.01; // 1% of pixels may differ

const HELP = `pixel-diff — AI-DLC visual-QA screenshot diff vs repo-local baselines (via the fail-closed harness)

Usage:
  node product/scripts/visual-qa/pixel-diff.mjs [--repo <path>] [--confirm-exec <hash>]
       [--baseline-dir <repo-relative path>] [--tolerance <0..1>]

Screenshots each audit_path on the loopback dev server and diffs vs a committed,
repo-local baseline PNG. Baselines are NEVER fetched from a URL. Every image decode
is bounded by byte size AND pixel dimensions (decompression-bomb defense).

Exit codes:
  0 PASS     >=1 screenshot compared, all within tolerance
  1 FINDINGS a screenshot differs beyond tolerance
  2 ERROR    bad invocation / security refusal / oversize|undecodable|mismatched image
  3 SKIPPED  no binding / non-visual / unconfirmed / browser|dep absent / NO baselines / nothing compared
`;

// Map an audit path to a baseline filename: "/" -> "root.png", "/a/b" -> "a__b.png".
function baselineNameForPath(p) {
  const trimmed = p.replace(/^\/+|\/+$/g, '');
  if (trimmed === '') return 'root.png';
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, '__') + '.png';
}

// R15: bounded PNG decode. Enforces byte size BEFORE reading and pixel
// dimensions AFTER header parse to defeat a decompression bomb. Returns
// { data, width, height } or throws ToolError.
async function decodeBoundedPng(absPath, label, PNG) {
  let st;
  try { st = statSync(absPath); } catch (e) { throw new ToolError(`${label}: cannot stat: ${e.message}`); }
  if (!st.isFile()) throw new ToolError(`${label}: not a regular file`);
  if (st.size > CAPS.MAX_IMAGE_BYTES) {
    throw new ToolError(`${label}: ${st.size} bytes exceeds the ${CAPS.MAX_IMAGE_BYTES}-byte image cap`);
  }
  let buf;
  try { buf = readFileSync(absPath); } catch (e) { throw new ToolError(`${label}: cannot read: ${e.message}`); }
  // Peek the IHDR (bytes 16..24) for width/height BEFORE full decode so a bomb
  // is rejected on declared dimensions, not after allocating the pixel buffer.
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new ToolError(`${label}: not a PNG (bad signature)`);
  }
  const declW = buf.readUInt32BE(16);
  const declH = buf.readUInt32BE(20);
  if (declW <= 0 || declH <= 0 || declW > CAPS.MAX_IMAGE_DIM || declH > CAPS.MAX_IMAGE_DIM) {
    throw new ToolError(`${label}: declared dimensions ${declW}x${declH} exceed the ${CAPS.MAX_IMAGE_DIM}px cap`);
  }
  if (declW * declH > CAPS.MAX_IMAGE_PIXELS) {
    throw new ToolError(`${label}: ${declW}x${declH} exceeds the ${CAPS.MAX_IMAGE_PIXELS}-pixel cap (decompression-bomb guard)`);
  }
  let png;
  try { png = PNG.sync.read(buf); } catch (e) { throw new ToolError(`${label}: PNG decode failed: ${e.message}`); }
  if (png.width !== declW || png.height !== declH) {
    throw new ToolError(`${label}: decoded dimensions disagree with header — refusing`);
  }
  return { data: png.data, width: png.width, height: png.height };
}

function makeAudit(toleranceOverride, baselineDirOverride) {
  return async function audit({ browser, base, binding, outputDir, repoRoot }) {
    const paths = readAuditPaths(binding);

    // R15: resolve the baseline dir as a REPO-LOCAL containment-checked path.
    // A binding value containing "://" (a URL) is rejected as a path by
    // resolveContained's URL-unaware logic only loosely; reject explicitly first.
    let rawBaselineDir = baselineDirOverride
      || (typeof binding.baseline_dir === 'string' ? binding.baseline_dir : DEFAULT_BASELINE_DIR);
    if (rawBaselineDir.includes('://')) {
      throw new ToolError(`baseline_dir must be a REPO-LOCAL path, not a URL: ${JSON.stringify(rawBaselineDir)}`);
    }
    // Resolve baselines against the contained repo root the runner threads
    // through (NOT process.cwd, which this audit hook never changed).
    const root = repoRoot;
    const baselineDir = resolveContained(root, rawBaselineDir, 'baseline_dir', 'read');

    // Tolerance.
    let tolerance = DEFAULT_TOLERANCE;
    if (toleranceOverride !== undefined) tolerance = toleranceOverride;
    else if (binding.pixel_tolerance !== undefined) {
      if (typeof binding.pixel_tolerance !== 'number' || binding.pixel_tolerance < 0 || binding.pixel_tolerance > 1) {
        throw new ToolError('pixel_tolerance must be a number in [0,1]');
      }
      tolerance = binding.pixel_tolerance;
    }

    // Load image deps dynamically (absence → honest SKIP).
    let PNG, pixelmatch;
    try {
      ({ PNG } = await import('pngjs'));
      pixelmatch = (await import('pixelmatch')).default;
    } catch (e) {
      return { evaluated: 0, findings: [], skipReason: `pngjs/pixelmatch not installed: ${e.message}` };
    }

    // Discover which paths have a committed baseline. NO baselines → SKIP.
    const haveBaseline = [];
    for (const p of paths) {
      const name = baselineNameForPath(p);
      const abs = resolveContained(root, join(rawBaselineDir, name), `baseline for ${p}`, 'read');
      if (existsSync(abs)) haveBaseline.push({ p, name, abs });
    }
    if (haveBaseline.length === 0) {
      return {
        evaluated: 0, findings: [],
        skipReason: `no committed baselines found in ${rel(root, baselineDir)} — ` +
          `nothing to diff (commit baseline PNGs to enable pixel-diff)`,
      };
    }

    const findings = [];
    let evaluated = 0;
    let screenshots = 0;

    for (const { p, name, abs } of haveBaseline) {
      if (screenshots >= CAPS.MAX_SCREENSHOTS) break;
      const url = buildLoopbackUrl(base, p, `audit_paths entry ${JSON.stringify(p)}`);
      const shotPath = join(outputDir, `current-${name}`); // kit-owned fresh dir

      const rendered = await withPage(browser, base, undefined, async (page) => {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
        if (!resp || !resp.ok()) return { ok: false, status: resp ? resp.status() : 'no-response' };
        await page.screenshot({ path: shotPath, fullPage: true });
        screenshots++;
        return { ok: true };
      });

      if (!rendered.ok) {
        findings.push(`${p}: did not render (HTTP ${rendered.status}) — could not screenshot`);
        continue;
      }

      // Decode BOTH with the bounded decoder (the fresh screenshot is bounded too
      // — chromium could in principle emit a huge fullPage image).
      const baselineImg = await decodeBoundedPng(abs, `baseline ${name}`, PNG);
      const currentImg = await decodeBoundedPng(shotPath, `screenshot ${name}`, PNG);

      if (baselineImg.width !== currentImg.width || baselineImg.height !== currentImg.height) {
        throw new ToolError(
          `${p}: screenshot ${currentImg.width}x${currentImg.height} != baseline ` +
          `${baselineImg.width}x${baselineImg.height} (re-baseline or fix layout)`
        );
      }

      const { width, height } = baselineImg;
      const diff = new PNG({ width, height });
      const numDiff = pixelmatch(baselineImg.data, currentImg.data, diff.data, width, height, { threshold: 0.1 });
      evaluated++;
      const total = width * height;
      const fraction = total > 0 ? numDiff / total : 0;
      if (fraction > tolerance) {
        const diffPath = join(outputDir, `diff-${name}`);
        try { writeFileSync(diffPath, PNG.sync.write(diff)); } catch { /* best effort artifact */ }
        findings.push(
          `${p}: ${numDiff}/${total} px differ (${(fraction * 100).toFixed(2)}% > ` +
          `${(tolerance * 100).toFixed(2)}% tolerance) — diff written to ${rel(root, diffPath)}`
        );
      }
    }

    return { evaluated, findings };
  };
}

async function main() {
  let args;
  try {
    args = parseCommonArgs(process.argv.slice(2), {
      '--tolerance': { takesValue: true },
      '--baseline-dir': { takesValue: true },
    });
  } catch (e) { process.stderr.write(`ERROR: ${e.message}\n\n${HELP}`); return EXIT.ERROR; }
  if (args.help) { process.stdout.write(HELP); return EXIT.PASS; }

  let toleranceOverride;
  if (args._['--tolerance'] !== undefined) {
    const t = Number(args._['--tolerance']);
    if (!Number.isFinite(t) || t < 0 || t > 1) {
      process.stderr.write('ERROR: --tolerance must be a number in [0,1]\n'); return EXIT.ERROR;
    }
    toleranceOverride = t;
  }
  const baselineDirOverride = args._['--baseline-dir'];
  if (baselineDirOverride !== undefined && baselineDirOverride.includes('://')) {
    process.stderr.write('ERROR: --baseline-dir must be a repo-local path, not a URL\n'); return EXIT.ERROR;
  }

  return runBrowserTool({
    toolName: 'pixel-diff',
    args,
    audit: makeAudit(toleranceOverride, baselineDirOverride),
  });
}

process.exit(await main());
