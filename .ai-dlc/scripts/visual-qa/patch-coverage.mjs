#!/usr/bin/env node
// patch-coverage.mjs — AI-DLC visual-QA: changed-line coverage gate (EXEC-FREE).
//
// WHAT IT DOES
//   Given a PROVIDED coverage artifact (lcov or a json line-hit map) and a
//   PROVIDED unified `git diff` file (NOT run by this tool), computes the
//   coverage of the lines the diff ADDS, and reports a FINDING when changed-line
//   coverage falls below a threshold.
//
// SAFETY (NO RCE SURFACE)
//   It does NOT run the test suite, does NOT shell out to git, does NOT spawn
//   anything. It reads two files the caller already produced. Both file paths
//   are containment-checked against --repo (untrusted-binding hardening).
//
// EXIT-CONTRACT (see lib/contract.mjs) — SKIPPED is NOT a PASS
//   0 PASS    — changed lines exist, were covered at/above threshold.
//   1 FINDINGS— changed-line coverage below threshold.
//   2 ERROR   — bad invocation / unreadable / unparseable inputs.
//   3 SKIPPED — no coverage artifact, no diff, or the diff adds no
//               coverable lines.
//
// USAGE
//   node product/scripts/visual-qa/patch-coverage.mjs \
//     --repo <path> --coverage <lcov|json> --diff <unified-diff-file> \
//     [--threshold <0..100>]
//
//   Paths may also come from the binding:
//     binding.coverage = { artifact, diff, threshold }

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EXIT, ToolError, resolveContained, readBoundedUtf8, loadBinding,
} from '../lib/binding.mjs';
import { skip, error, pass, findings as findingsLine } from '../lib/contract.mjs';

const DEFAULT_THRESHOLD = 80; // percent

function parseArgs(argv) {
  const args = { repo: process.cwd(), help: false, coverage: null, diff: null, threshold: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => { const n = argv[i + 1]; if (n === undefined) throw new ToolError(`${a} requires a value`); i++; return n; };
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--repo') args.repo = take();
    else if (a.startsWith('--repo=')) args.repo = a.slice('--repo='.length);
    else if (a === '--coverage') args.coverage = take();
    else if (a.startsWith('--coverage=')) args.coverage = a.slice('--coverage='.length);
    else if (a === '--diff') args.diff = take();
    else if (a.startsWith('--diff=')) args.diff = a.slice('--diff='.length);
    else if (a === '--threshold') args.threshold = take();
    else if (a.startsWith('--threshold=')) args.threshold = a.slice('--threshold='.length);
    else throw new ToolError(`unknown argument: ${a}`);
  }
  return args;
}

// ---- unified-diff parsing ----------------------------------------------
// Returns Map<file, Set<addedLineNumber>>. Only ADDED lines (in the new file's
// numbering) count as "changed lines to cover". We track the +file path from
// the `+++ b/...` header and the new-side line counter from each @@ hunk.
function parseAddedLines(diffText) {
  const byFile = new Map();
  let currentFile = null;
  let newLine = 0;
  const lines = diffText.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('+++ ')) {
      // "+++ b/path" or "+++ path" or "/dev/null"
      let p = line.slice(4).trim();
      if (p === '/dev/null') { currentFile = null; continue; }
      if (p.startsWith('b/')) p = p.slice(2);
      // strip a leading "a/"/"b/"-style or timestamp tab segment
      const tab = p.indexOf('\t');
      if (tab >= 0) p = p.slice(0, tab);
      currentFile = p;
      if (!byFile.has(currentFile)) byFile.set(currentFile, new Set());
      continue;
    }
    if (line.startsWith('@@')) {
      // @@ -old,oldc +new,newc @@
      const m = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) newLine = parseInt(m[1], 10);
      continue;
    }
    if (currentFile === null) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      byFile.get(currentFile).add(newLine);
      newLine++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // removed line — does not advance new-side counter
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" — ignore
    } else {
      // context line advances the new-side counter
      newLine++;
    }
  }
  return byFile;
}

// ---- coverage parsing ---------------------------------------------------
// lcov: SF:<file> ... DA:<line>,<hits> ... end_of_record
// Returns Map<file, Map<line, hits>>.
function parseLcov(text) {
  const cov = new Map();
  let file = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      file = line.slice(3).trim();
      if (!cov.has(file)) cov.set(file, new Map());
    } else if (line.startsWith('DA:') && file) {
      const m = /^DA:(\d+),(-?\d+)/.exec(line);
      if (m) cov.get(file).set(parseInt(m[1], 10), parseInt(m[2], 10));
    } else if (line === 'end_of_record') {
      file = null;
    }
  }
  return cov;
}

// json: { "<file>": { "<line>": <hits>, ... }, ... }  OR
//       { "<file>": { "lines": { "<line>": <hits> } } } (istanbul-ish subset)
function parseJsonCoverage(obj) {
  const cov = new Map();
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new ToolError('json coverage must be an object keyed by file');
  }
  for (const [file, val] of Object.entries(obj)) {
    const lineMap = new Map();
    const hits = val && typeof val === 'object' && val.lines && typeof val.lines === 'object'
      ? val.lines : val;
    if (hits && typeof hits === 'object' && !Array.isArray(hits)) {
      for (const [ln, h] of Object.entries(hits)) {
        const n = parseInt(ln, 10);
        if (Number.isInteger(n) && typeof h === 'number') lineMap.set(n, h);
      }
    }
    cov.set(file, lineMap);
  }
  return cov;
}

// Normalize a path for cross-matching diff files vs coverage files (basename-
// suffix match): coverage often uses absolute paths, the diff uses repo-relative.
function suffixMatch(coverageFiles, diffFile) {
  if (coverageFiles.has(diffFile)) return diffFile;
  for (const cf of coverageFiles.keys()) {
    if (cf === diffFile || cf.endsWith('/' + diffFile) || diffFile.endsWith('/' + cf)) return cf;
  }
  return null;
}

function readContained(repoRoot, rawPath, label) {
  const p = resolveContained(repoRoot, rawPath, label, 'read');
  if (!existsSync(p)) throw new ToolError(`${label} not found: ${rawPath}`);
  const r = readBoundedUtf8(p, { mode: 'strict' });
  return r.content;
}

const HELP = `patch-coverage — AI-DLC changed-line coverage gate (exec-free, no git, no tests)

Usage:
  node product/scripts/visual-qa/patch-coverage.mjs --repo <path> \\
    --coverage <lcov-or-json> --diff <unified-diff-file> [--threshold <0..100>]

Exit codes:
  0 PASS     changed lines covered at/above threshold
  1 FINDINGS changed-line coverage below threshold
  2 ERROR    bad invocation / unreadable / unparseable inputs
  3 SKIPPED  no coverage artifact, no diff, or no coverable changed lines
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

  // Binding may supply defaults (optional — the binding itself is optional here).
  let coverageArg = args.coverage;
  let diffArg = args.diff;
  let thresholdArg = args.threshold;
  try {
    const bi = loadBinding(repoRoot);
    if (bi.present && bi.binding.coverage && typeof bi.binding.coverage === 'object') {
      const c = bi.binding.coverage;
      if (!coverageArg && typeof c.artifact === 'string') coverageArg = c.artifact;
      if (!diffArg && typeof c.diff === 'string') diffArg = c.diff;
      if (thresholdArg === null && typeof c.threshold === 'number') thresholdArg = String(c.threshold);
    }
  } catch (e) { if (e instanceof ToolError) return error(e.message); throw e; }

  if (!coverageArg) return skip('no coverage artifact provided (--coverage or binding.coverage.artifact)');
  if (!diffArg) return skip('no diff provided (--diff or binding.coverage.diff)');

  let threshold = DEFAULT_THRESHOLD;
  if (thresholdArg !== null && thresholdArg !== undefined) {
    const t = Number(thresholdArg);
    if (!Number.isFinite(t) || t < 0 || t > 100) return error(`--threshold must be 0..100, got ${thresholdArg}`);
    threshold = t;
  }

  let coverageText, diffText;
  try {
    coverageText = readContained(repoRoot, coverageArg, 'coverage');
    diffText = readContained(repoRoot, diffArg, 'diff');
  } catch (e) { if (e instanceof ToolError) return error(e.message); throw e; }

  // Parse coverage (lcov vs json by sniffing).
  let coverage;
  try {
    const trimmed = coverageText.trimStart();
    if (trimmed.startsWith('{')) coverage = parseJsonCoverage(JSON.parse(coverageText));
    else coverage = parseLcov(coverageText);
  } catch (e) {
    return error(`cannot parse coverage artifact: ${e.message}`);
  }

  const added = parseAddedLines(diffText);
  if (added.size === 0) return skip('the diff adds no lines — nothing to gate');

  let totalChanged = 0;
  let coveredChanged = 0;
  const uncovered = [];
  for (const [file, lines] of added.entries()) {
    const covFileKey = suffixMatch(coverage, file);
    const lineHits = covFileKey ? coverage.get(covFileKey) : null;
    for (const ln of lines) {
      if (!lineHits || !lineHits.has(ln)) continue; // not a coverable/instrumented line
      totalChanged++;
      const hits = lineHits.get(ln);
      if (hits > 0) coveredChanged++;
      else uncovered.push(`${file}:${ln}`);
    }
  }

  if (totalChanged === 0) {
    return skip('no changed lines intersect the coverage artifact (nothing coverable to gate)');
  }

  const pct = (coveredChanged / totalChanged) * 100;
  if (pct < threshold) {
    findingsLine(`changed-line coverage ${pct.toFixed(1)}% < ${threshold}% (${coveredChanged}/${totalChanged} covered).`);
    for (const u of uncovered.slice(0, 50)) process.stdout.write(`  uncovered: ${u}\n`);
    if (uncovered.length > 50) process.stdout.write(`  …and ${uncovered.length - 50} more\n`);
    return EXIT.FINDINGS;
  }

  return pass(`changed-line coverage ${pct.toFixed(1)}% >= ${threshold}% (${coveredChanged}/${totalChanged} covered).`);
}

process.exit(main());
