#!/usr/bin/env node
// contrast-check.mjs — AI-DLC visual-QA: WCAG 2.x contrast checker (EXEC-FREE).
//
// WHAT IT DOES
//   Reads the repo binding's DTCG `token_source` and `token_pairs`, resolves
//   each [foreground, background] pair to concrete colors, computes the WCAG 2.x
//   contrast ratio, and reports any pair below threshold as a FINDING. PASS only
//   when at least one pair was actually evaluated and all met threshold.
//
// SAFETY (NO RCE SURFACE)
//   Pure computation over files it READS. It launches no process, no browser,
//   no shell, no network. (App-launching visual QA routes through the
//   fail-closed app-exec harness — not this tool.)
//
// EXIT-CONTRACT (see lib/contract.mjs) — SKIPPED is NOT a PASS
//   0 PASS    — >=1 pair evaluated and ALL met threshold.
//   1 FINDINGS— >=1 pair below threshold.
//   2 ERROR   — bad invocation, malformed/oversized binding or token file,
//               unreadable input, a pair that cannot be resolved to a color.
//   3 SKIPPED — no binding / non-visual surface / no token_source / no
//               token_pairs / nothing to evaluate.
//
// USAGE
//   node product/scripts/visual-qa/contrast-check.mjs [--repo <path>]
//
// BINDING SCHEMA (the fields this tool reads)
//   token_source : "path/to/tokens.json" (DTCG) — resolves token references.
//   token_pairs  : [ { "fg": <color|ref>, "bg": <color|ref>,
//                      "large"?: bool, "label"?: string }, ... ]
//     A color is a hex string ("#rrggbb"/"#rgb"/"#rrggbbaa") or a DTCG token
//     reference "{group.name}" resolved against token_source.
//   surface      : non-visual (cli/none/tui) ⇒ SKIPPED.

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EXIT, ToolError, rel, resolveContained, readBoundedUtf8, loadBinding,
} from '../lib/binding.mjs';
import { skip, error, pass, findings as findingsLine } from '../lib/contract.mjs';

const NON_VISUAL_SURFACES = new Set(['cli', 'none', 'tui']);
const DEFAULT_THRESHOLD = 4.5;       // WCAG AA normal text
const LARGE_TEXT_THRESHOLD = 3.0;    // WCAG AA large text

// ---- color parsing ------------------------------------------------------
// Parse a hex color to {r,g,b} in 0..255. Supports #rgb, #rrggbb, #rrggbbaa
// (alpha ignored for the ratio — WCAG contrast is defined on opaque colors).
function parseHex(s) {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(s.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length === 8) hex = hex.slice(0, 6);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

// WCAG relative luminance of an sRGB color. https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
function relativeLuminance({ r, g, b }) {
  const lin = (c) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// WCAG contrast ratio (1..21).
function contrastRatio(c1, c2) {
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---- DTCG token reference resolution ------------------------------------
// Build a flat map of "group.name" -> primitive $value (string) from a DTCG
// token tree. Only string leaves are usable as colors.
function flattenTokens(node, prefix, out) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
  if (Object.prototype.hasOwnProperty.call(node, '$value')) {
    const v = node.$value;
    if (typeof v === 'string') out.set(prefix, v);
    return;
  }
  for (const [key, val] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    const next = prefix ? `${prefix}.${key}` : key;
    flattenTokens(val, next, out);
  }
}

// Resolve a color spec to {r,g,b}. A "{a.b.c}" reference is looked up in the
// token map (one level of dereference; chained refs resolve up to a small depth).
function resolveColor(spec, tokenMap, label) {
  let value = spec;
  let depth = 0;
  while (typeof value === 'string' && /^\{.+\}$/.test(value.trim())) {
    if (depth++ > 8) throw new ToolError(`${label}: token reference cycle/too deep: ${spec}`);
    const ref = value.trim().slice(1, -1);
    if (!tokenMap.has(ref)) {
      throw new ToolError(`${label}: unresolved token reference {${ref}}`);
    }
    value = tokenMap.get(ref);
  }
  if (typeof value !== 'string') {
    throw new ToolError(`${label}: color must be a string, got ${typeof value}`);
  }
  const rgb = parseHex(value);
  if (!rgb) throw new ToolError(`${label}: not a parseable hex color: ${JSON.stringify(value)}`);
  return rgb;
}

function parseArgs(argv) {
  const args = { repo: process.cwd(), help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--repo') { const n = argv[i + 1]; if (!n) throw new ToolError('--repo requires a path'); args.repo = n; i++; }
    else if (a.startsWith('--repo=')) args.repo = a.slice('--repo='.length);
    else throw new ToolError(`unknown argument: ${a}`);
  }
  return args;
}

const HELP = `contrast-check — AI-DLC visual-QA WCAG 2.x contrast checker (exec-free)

Usage:
  node product/scripts/visual-qa/contrast-check.mjs [--repo <path>]

Reads .ai-dlc/stack-binding.json: token_source (DTCG) + token_pairs [{fg,bg,large?}].

Exit codes:
  0 PASS     >=1 pair evaluated, all met threshold (4.5:1, or 3:1 for large text)
  1 FINDINGS a pair fell below threshold
  2 ERROR    bad invocation / malformed input / unresolvable color
  3 SKIPPED  no binding / non-visual surface / no token_pairs / nothing to check
`;

function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (e) { process.stderr.write(`ERROR: ${e.message}\n\n${HELP}`); return EXIT.ERROR; }

  if (args.help) { process.stdout.write(HELP); return EXIT.PASS; }

  const repoRoot = resolve(args.repo);
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
    return error(`--repo path is not a directory: ${repoRoot}`);
  }

  let bindingInfo;
  try { bindingInfo = loadBinding(repoRoot); }
  catch (e) { if (e instanceof ToolError) return error(e.message); throw e; }

  if (!bindingInfo.present) {
    return skip('no .ai-dlc/stack-binding.json — cannot evaluate contrast');
  }
  const binding = bindingInfo.binding;

  if (binding.absent === true) return skip('binding marks this repo absent (no UI surface)');
  const surface = typeof binding.surface === 'string' ? binding.surface.toLowerCase() : null;
  if (surface && NON_VISUAL_SURFACES.has(surface)) {
    return skip(`surface "${surface}" is non-visual — contrast does not apply`);
  }

  const pairs = Array.isArray(binding.token_pairs) ? binding.token_pairs : null;
  if (!pairs || pairs.length === 0) {
    return skip('no token_pairs in the binding — nothing to evaluate');
  }

  // Load token_source (optional, but references need it).
  const tokenMap = new Map();
  if (binding.token_source) {
    if (typeof binding.token_source !== 'string') return error('token_source must be a string');
    let tokenPath;
    try { tokenPath = resolveContained(repoRoot, binding.token_source, 'token_source', 'read'); }
    catch (e) { if (e instanceof ToolError) return error(e.message); throw e; }
    if (!existsSync(tokenPath)) return error(`token_source not found: ${binding.token_source}`);
    let raw;
    try { raw = readBoundedUtf8(tokenPath, { mode: 'strict' }).content; }
    catch (e) { if (e instanceof ToolError) return error(`cannot read token_source: ${e.message}`); throw e; }
    let tree;
    try { tree = JSON.parse(raw); }
    catch (e) { return error(`token_source ${binding.token_source} is not valid JSON: ${e.message}`); }
    flattenTokens(tree, '', tokenMap);
  }

  // Evaluate each pair.
  const findings = [];
  let evaluated = 0;
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p === null || typeof p !== 'object' || Array.isArray(p)) {
      return error(`token_pairs[${i}] must be an object with fg and bg`);
    }
    if (!('fg' in p) || !('bg' in p)) {
      return error(`token_pairs[${i}] must have both fg and bg`);
    }
    const label = typeof p.label === 'string' ? p.label : `pair[${i}]`;
    let fg, bg;
    try {
      fg = resolveColor(p.fg, tokenMap, `${label}.fg`);
      bg = resolveColor(p.bg, tokenMap, `${label}.bg`);
    } catch (e) { if (e instanceof ToolError) return error(e.message); throw e; }

    const ratio = contrastRatio(fg, bg);
    const threshold = p.large === true ? LARGE_TEXT_THRESHOLD : DEFAULT_THRESHOLD;
    evaluated++;
    if (ratio < threshold) {
      findings.push({ label, ratio, threshold, large: p.large === true });
    }
  }

  if (evaluated === 0) {
    return skip('no token_pairs could be evaluated');
  }

  if (findings.length > 0) {
    findingsLine(`${findings.length} pair(s) below WCAG contrast threshold (of ${evaluated} evaluated).`);
    for (const f of findings) {
      process.stdout.write(
        `  ${f.label}: ratio ${f.ratio.toFixed(2)}:1 < ${f.threshold}:1` +
        (f.large ? ' (large text)' : '') + '\n'
      );
    }
    return EXIT.FINDINGS;
  }

  return pass(`all ${evaluated} pair(s) meet WCAG contrast (token_source: ${binding.token_source ? rel(repoRoot, resolve(repoRoot, binding.token_source)) : 'none'}).`);
}

process.exit(main());
