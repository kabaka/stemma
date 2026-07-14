#!/usr/bin/env node
// off-token-lint.mjs — AI-DLC design-QA: off-token linter (Slice 1)
//
// WHAT IT DOES
//   Statically scans source files for hardcoded design VALUES that should be
//   design tokens — raw hex/rgb(a) colors, raw px/rem spacing, and hardcoded
//   font-family names — and reports them as findings, so consumer UIs stay
//   on-token (visual consistency).
//
// SAFETY (Slice 1 — NO RCE SURFACE)
//   This tool performs PURE STATIC ANALYSIS: it only reads files and applies
//   regex/string matching. It does NOT, and must NOT, execute any command,
//   spawn a process, launch a browser, `eval`, fetch the network, or run the
//   consumer's application. Browser-launch and app/command-execution design-QA
//   tools now ship under `visual-qa/`, behind the fail-closed app-exec harness
//   (`lib/app-exec-harness.mjs`); THIS Slice-1 tool stays pure static analysis
//   with NO RCE surface.
//
// REPO-LOCAL BINDING (optional)  ./.ai-dlc/stack-binding.json
//   The single source of truth for how this repo is wired. Minimal schema:
//     {
//       "ui_framework": string | null,
//       "token_source": "path to a DTCG tokens.json" | null,
//       "source_globs": [string, ...] | null,
//       "token_pairs":  [ ... ] | null,   // reserved; not required by this tool
//       "surface": "web" | "mobile" | "tui" | "cli" | "none",
//       "absent":  boolean
//     }
//   - token_source: when present, allowed token values are loaded from it
//     (DTCG JSON — every `$value` is collected) so a hardcoded value can be
//     told apart from a legitimate raw value living inside the token file
//     itself. The token file is always SKIPPED during scanning.
//   - source_globs: selects which files to scan. When absent, a sensible
//     default set of common web source extensions is used.
//
// EXIT-CODE CONTRACT  (SKIPPED is NOT a PASS)
//   0  PASS    — it actually scanned >=1 source file and found NO off-token
//               values. This is the ONLY green result.
//   1  FINDINGS — it scanned sources and found off-token values.
//   2  ERROR   — bad invocation, unreadable binding/token file, internal error.
//   3  SKIPPED — evidence-incomplete, treated by callers as NOT-PASS:
//                 the binding is absent, OR surface is non-visual (cli/none) or
//                 binding.absent === true, OR there were no scannable sources.
//                A clear `SKIPPED: <reason>` line is printed. A caller MUST NOT
//                treat exit 3 as success — it means "we could not gather the
//                evidence", not "the UI is on-token".
//
// USAGE
//   node product/scripts/off-token-lint.mjs [--repo <path>]
//   --repo <path>   repository root to scan (default: current directory)
//   --help          print this contract summary
//
// Cross-platform: Node only (>=18), no shell, no bashisms, no dependencies
// beyond the Node standard library.

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, sep, extname } from 'node:path';

// Hardened primitives are shared via the audited lib so every design-QA tool
// uses ONE implementation of path containment, bounded reads, binding load, and
// the exit-code contract. Behavior here is byte-identical to the original
// inline versions these import replaced.
import {
  EXIT,
  MAX_READ_BYTES,
  ToolError,
  rel,
  resolveContained,
  readBoundedUtf8,
  loadBinding,
} from './lib/binding.mjs';

// ---- defaults -----------------------------------------------------------
const DEFAULT_SOURCE_EXTENSIONS = new Set([
  '.css', '.scss', '.sass', '.less',
  '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte',
  '.html', '.htm',
]);

// Directories never worth scanning (and that would explode the walk).
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.svelte-kit', '.cache', 'vendor', '.ai-dlc',
]);

const NON_VISUAL_SURFACES = new Set(['cli', 'none']);

// ---- detectors ----------------------------------------------------------
// Each detector returns an array of { kind, value, column } for one line.
// They are deliberately conservative to limit false positives; the goal is a
// useful signal, not perfect coverage.

// #rgb / #rrggbb / #rrggbbaa hex colors.
const RE_HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
// rgb()/rgba()/hsl()/hsla() functional colors.
const RE_FUNC_COLOR = /\b(?:rgba?|hsla?)\s*\([^)]*\)/gi;
// Numeric px / rem spacing, e.g. 16px, 0.5rem, 1.25em. Excludes a bare 0.
const RE_SPACING = /\b(?:\d+\.?\d*|\.\d+)(px|rem|em)\b/g;
// font-family declarations with a quoted or named family.
const RE_FONT_FAMILY = /font-family\s*[:=]\s*([^;{}\n]+)/gi;

function detectLine(line) {
  const found = [];
  let m;

  RE_HEX.lastIndex = 0;
  while ((m = RE_HEX.exec(line)) !== null) {
    found.push({ kind: 'color-hex', value: m[0], column: m.index + 1 });
  }

  RE_FUNC_COLOR.lastIndex = 0;
  while ((m = RE_FUNC_COLOR.exec(line)) !== null) {
    found.push({ kind: 'color-func', value: m[0].trim(), column: m.index + 1 });
  }

  RE_SPACING.lastIndex = 0;
  while ((m = RE_SPACING.exec(line)) !== null) {
    // Skip a value of exactly 0 (e.g. 0px / 0rem) — never a token concern.
    const numeric = parseFloat(m[0]);
    if (numeric === 0) continue;
    found.push({ kind: 'spacing', value: m[0], column: m.index + 1 });
  }

  RE_FONT_FAMILY.lastIndex = 0;
  while ((m = RE_FONT_FAMILY.exec(line)) !== null) {
    const decl = m[1].trim();
    // Only flag when an explicit family NAME is hardcoded — ignore declarations
    // that reference a variable/token (var(--…), $…, {…}, theme(…)).
    if (/var\(|^\$|^@|\{|theme\(/.test(decl)) continue;
    found.push({ kind: 'font-family', value: `font-family: ${decl}`, column: m.index + 1 });
  }

  return found;
}

// ---- DTCG token value collection ----------------------------------------
// Walk a DTCG token tree and collect every `$value` (recursively). Composite
// values (objects/arrays) are flattened to their primitive leaves so that, for
// example, a shadow's color string still counts as an allowed value.
function collectTokenValues(node, out) {
  if (node === null) return;
  if (Array.isArray(node)) {
    for (const item of node) collectTokenValues(item, out);
    return;
  }
  if (typeof node === 'object') {
    for (const [key, val] of Object.entries(node)) {
      if (key === '$value') {
        collectPrimitives(val, out);
      } else {
        collectTokenValues(val, out);
      }
    }
    return;
  }
}

function collectPrimitives(val, out) {
  if (val === null) return;
  if (typeof val === 'string') {
    out.add(val.trim().toLowerCase());
  } else if (typeof val === 'number') {
    out.add(String(val).toLowerCase());
  } else if (Array.isArray(val)) {
    for (const v of val) collectPrimitives(v, out);
  } else if (typeof val === 'object') {
    for (const v of Object.values(val)) collectPrimitives(v, out);
  }
}

function loadAllowedTokenValues(repoRoot, tokenSource) {
  // Containment guard: the token path comes from the UNTRUSTED binding. Reject
  // any `../` traversal, absolute path, or symlink that escapes --repo before
  // we read a single byte, so a crafted binding cannot read /etc/hostname or a
  // sibling secret. (realpath re-check happens inside resolveContained.)
  const tokenPath = resolveContained(repoRoot, tokenSource, 'token_source');
  if (!existsSync(tokenPath)) {
    throw new ToolError(`token_source not found: ${tokenSource} (resolved ${tokenPath})`);
  }
  let raw;
  try {
    const r = readBoundedUtf8(tokenPath, { mode: 'strict' });
    raw = r.content;
  } catch (e) {
    if (e instanceof ToolError) {
      throw new ToolError(`cannot read token_source ${tokenSource}: ${e.message}`);
    }
    throw e;
  }
  let tree;
  try {
    tree = JSON.parse(raw);
  } catch (e) {
    throw new ToolError(`token_source ${tokenSource} is not valid JSON: ${e.message}`);
  }
  const values = new Set();
  collectTokenValues(tree, values);
  return { tokenPath, values };
}

// ---- glob matching (tiny, dependency-free, LINEAR) ----------------------
// Supports the common cases we need: **, *, ?, and literal path segments.
// Patterns and paths are matched with '/' separators.
//
// ReDoS SAFETY: the naive translation of `**` to `.*` produces catastrophic
// backtracking when a pattern contains two or more `**` (e.g. `src/**/**/*.css`,
// or a crafted `**/**/**/...` from the untrusted binding) tested against a deep
// non-matching path — the adjacent `.*` runs each try every split point. We
// avoid this by (a) collapsing any run of consecutive `*`/`**` (and a redundant
// `**/**`) down to a single glob token before compiling, and (b) compiling each
// `**` to a possessive-equivalent, anchored segment form with NO two adjacent
// unbounded quantifiers:
//   `**/`  -> `(?:[^/]*/)*`   (zero or more whole path segments)
//   `**`   -> `[^/]*` repeated per remaining segment, i.e. `.*` but bounded by
//             the surrounding literals so no two unbounded quantifiers ever
//             abut. We render a trailing/!-slash `**` as `.*` only when it is
//             the final token, where a single `.*` cannot backtrack-explode.
// Because consecutive `**` are collapsed first, the compiled regex never
// contains `.*.*` or `(?:[^/]*/)*(?:[^/]*/)*` adjacency, so matching is linear
// in the path length.
function globToRegExp(glob) {
  // 1. Tokenize, collapsing runs of '*'/'**' into single tokens. A token is
  //    either a literal char, '?', '*' (single-segment star), or '**'
  //    (cross-segment globstar). Consecutive stars merge: '*' '*' -> '**',
  //    and any further adjacent stars stay '**' (idempotent collapse).
  const tokens = [];
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      let stars = 0;
      while (glob[i] === '*') { stars++; i++; }
      // After the star run, optionally consume one trailing '/' that belongs to
      // a globstar segment ('**/'), recording it so we emit the segment form.
      let trailingSlash = false;
      if (stars >= 2 && glob[i] === '/') { trailingSlash = true; i++; }
      i--; // for-loop will i++ — step back one
      if (stars >= 2) {
        // Collapse an already-present trailing-slash globstar followed by more
        // globstars by merging into one token (handled by the run-merge below).
        const prev = tokens[tokens.length - 1];
        if (prev && prev.t === 'globstar') {
          // '**/**' or '**' '**' — keep a single globstar; prefer slash form if
          // either had a trailing slash so we still cross segments.
          prev.slash = prev.slash || trailingSlash;
        } else {
          tokens.push({ t: 'globstar', slash: trailingSlash });
        }
      } else {
        // A single '*'. It is its own segment-local wildcard. Note we do NOT
        // subsume it into a preceding globstar: a globstar that consumed its
        // trailing '/' (e.g. the '**/' in '**/*.css') is separated from this
        // star by that slash, so the star is a distinct final-segment match and
        // must be emitted. Collapsing only ever merges *consecutive* stars
        // (handled by the `stars` run counter above), never a slash-separated
        // star, so no '.*.*'-style adjacency is introduced.
        tokens.push({ t: 'star' });
      }
    } else if (c === '?') {
      tokens.push({ t: 'any1' });
    } else {
      tokens.push({ t: 'lit', c });
    }
  }

  // 2. Compile tokens to a regex with no two adjacent unbounded quantifiers.
  let re = '';
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    if (tok.t === 'globstar') {
      if (tok.slash) {
        // '**/' — zero or more complete path segments. Single bounded star
        // inside the group; the group itself is the only quantifier here.
        re += '(?:[^/]*/)*';
      } else {
        // A trailing '**' (no slash): match any remaining chars including '/'.
        // Safe as a lone '.*' because consecutive globstars were collapsed, so
        // this never abuts another unbounded quantifier.
        re += '[^]*';
      }
    } else if (tok.t === 'star') {
      re += '[^/]*';
    } else if (tok.t === 'any1') {
      re += '[^/]';
    } else {
      const ch = tok.c;
      re += '.+^${}()|[]\\'.includes(ch) ? '\\' + ch : ch;
    }
  }
  return new RegExp('^' + re + '$');
}

function makeMatcher(globs) {
  const compiled = globs.map(globToRegExp);
  return (relPath) => {
    const norm = relPath.split(sep).join('/');
    return compiled.some((re) => re.test(norm));
  };
}

// ---- file discovery -----------------------------------------------------
function walk(dir, repoRoot, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory — skip silently, never throw the run
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walk(full, repoRoot, acc);
    } else if (entry.isFile()) {
      acc.push(full);
    }
  }
}

function discoverSources(repoRoot, sourceGlobs) {
  const all = [];
  walk(repoRoot, repoRoot, all);

  if (sourceGlobs && sourceGlobs.length > 0) {
    const match = makeMatcher(sourceGlobs);
    return all.filter((f) => match(rel(repoRoot, f)));
  }
  // Default: common web source extensions.
  return all.filter((f) => DEFAULT_SOURCE_EXTENSIONS.has(extname(f).toLowerCase()));
}

// ---- scanning -----------------------------------------------------------
function scanFile(file, repoRoot, allowedValues, oversize) {
  const r = readBoundedUtf8(file, { mode: 'skip' });
  if (r === null) {
    return []; // unreadable file — skip, do not crash the whole run
  }
  if (r.tooLarge) {
    // Over the read cap — skip with a printed note (recorded for the caller).
    oversize.push({ file: rel(repoRoot, file), size: r.size });
    return [];
  }
  const content = r.content;
  const findings = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const hits = detectLine(lines[i]);
    for (const hit of hits) {
      // Suppress values that are themselves legitimate tokens.
      const norm = stripValueForLookup(hit).toLowerCase();
      if (allowedValues.has(norm)) continue;
      findings.push({
        file: rel(repoRoot, file),
        line: i + 1,
        column: hit.column,
        kind: hit.kind,
        value: hit.value,
      });
    }
  }
  return findings;
}

// For token-allowlist comparison: a spacing/color value is compared raw; a
// font-family finding is reduced to just the family list portion.
function stripValueForLookup(hit) {
  if (hit.kind === 'font-family') {
    return hit.value.replace(/^font-family:\s*/i, '').trim();
  }
  return hit.value.trim();
}

// ---- helpers ------------------------------------------------------------
// ToolError, rel, resolveContained, and readBoundedUtf8 are imported from
// ./lib/binding.mjs (the shared, audited primitives).

function parseArgs(argv) {
  const args = { repo: process.cwd(), help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (a === '--repo') {
      const next = argv[i + 1];
      if (!next) throw new ToolError('--repo requires a path argument');
      args.repo = next;
      i++;
    } else if (a.startsWith('--repo=')) {
      args.repo = a.slice('--repo='.length);
    } else {
      throw new ToolError(`unknown argument: ${a}`);
    }
  }
  return args;
}

const HELP = `off-token-lint — AI-DLC design-QA off-token linter (Slice 1, static, no RCE)

Usage:
  node product/scripts/off-token-lint.mjs [--repo <path>]

Scans source files for hardcoded design values (hex/rgb colors, px/rem spacing,
font-family names) that should be design tokens.

Exit codes:
  0  PASS     scanned >=1 source and found no off-token values (the only green)
  1  FINDINGS scanned sources and found off-token values
  2  ERROR    bad invocation / unreadable binding or token file / internal error
  3  SKIPPED  evidence-incomplete, NOT a pass (no binding, non-visual surface,
             or no scannable sources)

Reads optional repo-local binding: .ai-dlc/stack-binding.json
`;

// ---- main ---------------------------------------------------------------
function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`ERROR: ${e.message}\n\n${HELP}`);
    return EXIT.ERROR;
  }

  if (args.help) {
    process.stdout.write(HELP);
    return EXIT.PASS;
  }

  const repoRoot = resolve(args.repo);
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
    process.stderr.write(`ERROR: --repo path is not a directory: ${repoRoot}\n`);
    return EXIT.ERROR;
  }

  // 1. Load the binding (optional).
  let bindingInfo;
  try {
    bindingInfo = loadBinding(repoRoot);
  } catch (e) {
    if (e instanceof ToolError) {
      process.stderr.write(`ERROR: ${e.message}\n`);
      return EXIT.ERROR;
    }
    throw e;
  }

  if (!bindingInfo.present) {
    process.stdout.write(
      'SKIPPED: no .ai-dlc/stack-binding.json found — evidence-incomplete, NOT a pass.\n' +
      '         Create the binding to declare surface, token_source, and source_globs.\n'
    );
    return EXIT.SKIPPED;
  }

  const binding = bindingInfo.binding;

  // 2. Non-visual surface or explicitly absent → SKIPPED (not pass).
  const surface = typeof binding.surface === 'string' ? binding.surface.toLowerCase() : null;
  if (binding.absent === true) {
    process.stdout.write('SKIPPED: binding marks this repo as absent (no UI surface) — NOT a pass.\n');
    return EXIT.SKIPPED;
  }
  if (surface && NON_VISUAL_SURFACES.has(surface)) {
    process.stdout.write(`SKIPPED: surface "${surface}" is non-visual — off-token linting does not apply. NOT a pass.\n`);
    return EXIT.SKIPPED;
  }

  // 3. Load allowed token values (optional token_source).
  let allowedValues = new Set();
  let tokenPath = null;
  if (binding.token_source) {
    try {
      const loaded = loadAllowedTokenValues(repoRoot, binding.token_source);
      allowedValues = loaded.values;
      tokenPath = loaded.tokenPath;
    } catch (e) {
      if (e instanceof ToolError) {
        process.stderr.write(`ERROR: ${e.message}\n`);
        return EXIT.ERROR;
      }
      throw e;
    }
  }

  // 4. Discover sources.
  const sourceGlobs = Array.isArray(binding.source_globs) && binding.source_globs.length > 0
    ? binding.source_globs
    : null;
  let sources = discoverSources(repoRoot, sourceGlobs);

  // Always exclude the token file itself from scanning — its raw values are
  // legitimate by definition.
  if (tokenPath) {
    sources = sources.filter((f) => resolve(f) !== resolve(tokenPath));
  }

  if (sources.length === 0) {
    process.stdout.write(
      'SKIPPED: no scannable source files found — evidence-incomplete, NOT a pass.\n' +
      (sourceGlobs
        ? `         source_globs matched nothing: ${JSON.stringify(sourceGlobs)}\n`
        : '         no files with default web source extensions were found.\n')
    );
    return EXIT.SKIPPED;
  }

  // 5. Scan.
  const findings = [];
  const oversize = [];
  for (const file of sources) {
    findings.push(...scanFile(file, repoRoot, allowedValues, oversize));
  }
  if (oversize.length > 0) {
    for (const o of oversize) {
      process.stdout.write(
        `NOTE: skipped ${o.file} — ${o.size} bytes exceeds the ${MAX_READ_BYTES}-byte read cap.\n`
      );
    }
    process.stdout.write('\n');
  }

  // 6. Report.
  const scannedNote =
    `scanned ${sources.length} file(s)` +
    (tokenPath ? `, ${allowedValues.size} allowed token value(s) from ${rel(repoRoot, tokenPath)}` : ', no token_source (every raw value is a candidate)');

  if (findings.length === 0) {
    process.stdout.write(`PASS: no off-token values found (${scannedNote}).\n`);
    return EXIT.PASS;
  }

  process.stdout.write(`FINDINGS: ${findings.length} off-token value(s) (${scannedNote}).\n\n`);
  for (const f of findings) {
    process.stdout.write(`  ${f.file}:${f.line}:${f.column}  [${f.kind}]  ${f.value}\n`);
  }
  process.stdout.write('\nReplace these hardcoded values with design tokens to stay on-token.\n');
  return EXIT.FINDINGS;
}

process.exit(main());
