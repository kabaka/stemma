#!/usr/bin/env node
// changelog-check.mjs — AI-DLC visual-QA: changelog freshness gate (EXEC-FREE).
//
// WHAT IT DOES
//   Verifies a Keep-a-Changelog / conventional CHANGELOG has an "Unreleased"
//   section that is non-empty (i.e. the change being shipped is recorded). The
//   "commit list/range" being covered is supplied by the caller (--commits or
//   binding.changelog.commits) — this tool does NOT shell git to discover it.
//
// SAFETY (NO RCE SURFACE)
//   It READS a changelog file (containment-checked against --repo) and inspects
//   a caller-provided commit list. No process, no git, no shell, no network.
//
// EXIT-CONTRACT (see lib/contract.mjs) — SKIPPED is NOT a PASS
//   0 PASS    — an Unreleased section exists and has real entries.
//   1 FINDINGS— commits were supplied but the Unreleased section is missing or
//               empty (the change is undocumented).
//   2 ERROR   — bad invocation / unreadable changelog.
//   3 SKIPPED — no changelog convention/file, or no commits supplied (nothing
//               to verify against).
//
// USAGE
//   node product/scripts/visual-qa/changelog-check.mjs --repo <path> \
//     [--changelog <path>] [--commits <a,b,c | @file>]
//
//   Binding: binding.changelog = { path, commits: [..] }

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EXIT, ToolError, resolveContained, readBoundedUtf8, loadBinding,
} from '../lib/binding.mjs';
import { skip, error, pass, findings as findingsLine } from '../lib/contract.mjs';

const DEFAULT_CHANGELOG = 'CHANGELOG.md';

function parseArgs(argv) {
  const args = { repo: process.cwd(), help: false, changelog: null, commits: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => { const n = argv[i + 1]; if (n === undefined) throw new ToolError(`${a} requires a value`); i++; return n; };
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--repo') args.repo = take();
    else if (a.startsWith('--repo=')) args.repo = a.slice('--repo='.length);
    else if (a === '--changelog') args.changelog = take();
    else if (a.startsWith('--changelog=')) args.changelog = a.slice('--changelog='.length);
    else if (a === '--commits') args.commits = take();
    else if (a.startsWith('--commits=')) args.commits = a.slice('--commits='.length);
    else throw new ToolError(`unknown argument: ${a}`);
  }
  return args;
}

// Extract the body of the "## [Unreleased]" / "## Unreleased" section: every
// line after that heading until the next "## " heading. Returns null if no such
// heading exists.
function extractUnreleased(text) {
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+\[?unreleased\]?/i.test(lines[i].trim())) { start = i + 1; break; }
  }
  if (start === -1) return null;
  const body = [];
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join('\n');
}

// A section is "non-empty" if it has at least one real content line — a list
// item (`- `/`* `) or a non-blank, non-heading line. Keep-a-Changelog category
// sub-headings (### Added) alone do NOT count as content.
function hasRealEntries(sectionBody) {
  for (const raw of sectionBody.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (/^###\s+/.test(line)) continue;       // category sub-heading only
    if (/^-\s+\S/.test(line) || /^\*\s+\S/.test(line)) return true; // list entry
    if (!line.startsWith('#')) return true;    // any other prose line
  }
  return false;
}

function normalizeCommits(value) {
  // Accept an array (binding) or a comma/newline-separated string (CLI).
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

const HELP = `changelog-check — AI-DLC changelog freshness gate (exec-free, no git)

Usage:
  node product/scripts/visual-qa/changelog-check.mjs --repo <path> \\
    [--changelog <path>] [--commits <a,b,c>]

Verifies the changelog has a non-empty Unreleased section covering the supplied
commits. Does NOT shell git — the commit list is provided by the caller.

Exit codes:
  0 PASS     Unreleased section exists with real entries
  1 FINDINGS commits supplied but Unreleased is missing/empty
  2 ERROR    bad invocation / unreadable changelog
  3 SKIPPED  no changelog file/convention, or no commits supplied
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

  let changelogArg = args.changelog;
  let commits = normalizeCommits(args.commits);
  try {
    const bi = loadBinding(repoRoot);
    if (bi.present && bi.binding.changelog && typeof bi.binding.changelog === 'object') {
      const c = bi.binding.changelog;
      if (!changelogArg && typeof c.path === 'string') changelogArg = c.path;
      if (commits.length === 0 && c.commits !== undefined) commits = normalizeCommits(c.commits);
    }
  } catch (e) { if (e instanceof ToolError) return error(e.message); throw e; }

  // Resolve the changelog path (default CHANGELOG.md if it exists).
  const changelogRel = changelogArg || DEFAULT_CHANGELOG;
  let changelogPath;
  try { changelogPath = resolveContained(repoRoot, changelogRel, 'changelog', 'read'); }
  catch (e) { if (e instanceof ToolError) return error(e.message); throw e; }

  if (!existsSync(changelogPath)) {
    return skip(`no changelog file at ${changelogRel} — no changelog convention to verify`);
  }

  if (commits.length === 0) {
    return skip('no commits supplied (--commits or binding.changelog.commits) — nothing to verify');
  }

  let text;
  try { text = readBoundedUtf8(changelogPath, { mode: 'strict' }).content; }
  catch (e) { if (e instanceof ToolError) return error(`cannot read changelog: ${e.message}`); throw e; }

  const unreleased = extractUnreleased(text);
  if (unreleased === null) {
    findingsLine(`no "Unreleased" section in ${changelogRel}, but ${commits.length} commit(s) need documenting.`);
    process.stdout.write('  Add a "## [Unreleased]" section (Keep a Changelog) describing the change.\n');
    return EXIT.FINDINGS;
  }
  if (!hasRealEntries(unreleased)) {
    findingsLine(`"Unreleased" section in ${changelogRel} is empty, but ${commits.length} commit(s) need documenting.`);
    process.stdout.write('  Record the change under Unreleased (Added/Changed/Fixed/…).\n');
    return EXIT.FINDINGS;
  }

  return pass(`Unreleased section present with entries; ${commits.length} commit(s) covered.`);
}

process.exit(main());
