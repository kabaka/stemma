// binding.mjs — hardened primitives shared by AI-DLC design-QA tools.
//
// These are the security-reviewed primitives originally written for
// off-token-lint.mjs (Slice 1) and extracted here so every design-QA tool —
// the exec-free visual-QA tools and the fail-closed app-exec harness — uses ONE
// audited implementation of path containment, bounded reads, and binding load.
//
// Re-exporting EXIT here keeps a single import surface for callers that want
// both the contract and the primitives; the canonical source is contract.mjs.
//
// CONTRACT NOTE: these primitives throw `ToolError` for any condition a caller
// must turn into a loud ERROR (exit 2). They never call process.exit and never
// print — printing and exiting is the tool's responsibility (see contract.mjs).

import { readFileSync, statSync, existsSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

export { EXIT } from './contract.mjs';

// ---- read-size cap ------------------------------------------------------
// No file a tool reads (scanned sources, the binding, the token file) may
// exceed this. Bounds memory and defeats a denial-of-service via a giant file
// supplied by an untrusted binding. Identical to off-token-lint's original cap.
export const MAX_READ_BYTES = 5 * 1024 * 1024; // 5 MiB

// NUL is U+0000. Kept as a named constant so no literal control byte ever
// appears in this source file.
const NUL = String.fromCharCode(0);

// ---- typed error --------------------------------------------------------
// A caller catches ToolError and turns it into exit 2 (ERROR). Anything that is
// NOT a ToolError is an unexpected internal fault and is allowed to propagate.
export class ToolError extends Error {}

// ---- relative-path pretty-printer ---------------------------------------
// Render `p` relative to `root` with forward slashes (stable across platforms).
export function rel(root, p) {
  const r = relative(root, p);
  return r === '' ? '.' : r.split(sep).join('/');
}

// ---- path containment (defends untrusted binding paths) -----------------
// True iff `candidate` is `root` itself or lives underneath it. Both must be
// absolute (already `resolve()`d). This is the guard that keeps every path
// derived from the untrusted binding inside the repo root: `../` traversal and
// absolute paths resolve OUT of root and are rejected by the caller below.
export function isContained(root, candidate) {
  return candidate === root || candidate.startsWith(root + sep);
}

// Resolve a binding-supplied path against `repoRoot` and REJECT anything that
// escapes the repo. Containment is enforced for BOTH read and write paths:
//
//   - mode 'read'  (default): used for token files, coverage files, etc. When
//     the target exists it is realpath-canonicalized and re-checked so a
//     symlink inside the repo pointing outside is rejected too.
//
//   - mode 'write': used for an output directory/file the tool may create. The
//     final path component is NOT required to exist; we realpath-check the
//     deepest EXISTING ancestor instead, so a symlinked parent directory that
//     escapes the repo is rejected before anything is written. (No-follow at the
//     final component is the caller's open(…, O_NOFOLLOW)/lstat job — this
//     guards the directory chain.) A write target that resolves outside the
//     root (via `..`, absolute path, or a symlinked ancestor) throws.
//
// Returns the contained, lexically-resolved absolute path. `label` names the
// field for the error message (e.g. 'token_source', 'output_dir').
export function resolveContained(repoRoot, rawPath, label, mode = 'read') {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw new ToolError(`${label} must be a non-empty string`);
  }
  // Reject embedded NUL — it can truncate a path at the syscall boundary.
  if (rawPath.includes(NUL)) {
    throw new ToolError(`${label} contains a NUL byte`);
  }
  const root = resolve(repoRoot);
  const resolved = resolve(root, rawPath);
  if (!isContained(root, resolved)) {
    throw new ToolError(
      `${label} escapes --repo root: ${rawPath} (resolved ${resolved}) is outside ${root}`
    );
  }
  // Canonicalize the root too, so a symlinked repo root is not a false positive.
  let realRoot;
  try {
    realRoot = realpathSync(root);
  } catch {
    realRoot = root;
  }
  if (existsSync(resolved)) {
    let real;
    try {
      real = realpathSync(resolved);
    } catch (e) {
      throw new ToolError(`cannot resolve ${label} ${rawPath}: ${e.message}`);
    }
    if (!isContained(realRoot, real)) {
      throw new ToolError(
        `${label} escapes --repo root via symlink: ${rawPath} (real ${real}) is outside ${realRoot}`
      );
    }
    return resolved;
  }
  // Target does not exist. For a WRITE path, walk up to the deepest existing
  // ancestor and realpath-check IT — a symlinked parent that escapes the repo
  // must be rejected before we create anything underneath it.
  if (mode === 'write') {
    let probe = resolved;
    while (probe !== root && probe !== resolve(probe, '..')) {
      const parent = resolve(probe, '..');
      if (existsSync(parent)) {
        let realParent;
        try {
          realParent = realpathSync(parent);
        } catch (e) {
          throw new ToolError(`cannot resolve ${label} parent ${parent}: ${e.message}`);
        }
        if (!isContained(realRoot, realParent)) {
          throw new ToolError(
            `${label} escapes the repo root via a symlinked parent: ${rawPath} ` +
            `(parent real ${realParent}) is outside ${realRoot}`
          );
        }
        break;
      }
      probe = parent;
    }
  }
  return resolved;
}

// ---- bounded UTF-8 read -------------------------------------------------
// `mode: 'skip'`   returns null when the file is too large or unreadable
//                  (used for scanned sources, which must never crash the run).
// `mode: 'strict'` throws a ToolError on oversize/unreadable (used for the
//                  binding and token files, which the caller turns into exit 2).
// Byte-identical behavior to off-token-lint's original readBoundedUtf8.
export function readBoundedUtf8(file, { mode }) {
  let st;
  try {
    st = statSync(file);
  } catch (e) {
    if (mode === 'strict') throw new ToolError(`cannot stat ${file}: ${e.message}`);
    return null;
  }
  if (st.size > MAX_READ_BYTES) {
    if (mode === 'strict') {
      throw new ToolError(
        `${file} is ${st.size} bytes, over the ${MAX_READ_BYTES}-byte read cap`
      );
    }
    return { tooLarge: true, size: st.size };
  }
  try {
    return { content: readFileSync(file, 'utf8') };
  } catch (e) {
    if (mode === 'strict') throw new ToolError(`cannot read ${file}: ${e.message}`);
    return null;
  }
}

// ---- binding load -------------------------------------------------------
// Load .ai-dlc/stack-binding.json from `repoRoot`. The binding is OPTIONAL: a
// missing file returns { present: false }. A present-but-unreadable or malformed
// binding throws ToolError (caller → exit 2). The parsed value must be a plain
// JSON object. Returns { present, bindingPath, binding, raw } where `raw` is the
// exact bytes read (so a caller can hash the canonical source of truth).
export function loadBinding(repoRoot) {
  const bindingPath = join(repoRoot, '.ai-dlc', 'stack-binding.json');
  if (!existsSync(bindingPath)) {
    return { present: false, bindingPath, binding: null, raw: null };
  }
  let raw;
  try {
    const r = readBoundedUtf8(bindingPath, { mode: 'strict' });
    raw = r.content;
  } catch (e) {
    if (e instanceof ToolError) {
      throw new ToolError(`cannot read binding ${rel(repoRoot, bindingPath)}: ${e.message}`);
    }
    throw e;
  }
  let binding;
  try {
    binding = JSON.parse(raw);
  } catch (e) {
    throw new ToolError(`binding ${rel(repoRoot, bindingPath)} is not valid JSON: ${e.message}`);
  }
  if (binding === null || typeof binding !== 'object' || Array.isArray(binding)) {
    throw new ToolError(`binding ${rel(repoRoot, bindingPath)} must be a JSON object`);
  }
  return { present: true, bindingPath, binding, raw };
}

// ---- canonical JSON + hash ----------------------------------------------
// Deterministic canonical serialization: object keys sorted recursively, arrays
// preserved in order, no whitespace. Two semantically-equal JSON values produce
// identical bytes, so a SHA-256 over the canonical bytes is a stable fingerprint
// independent of key order or formatting. Used to bind a confirmation token to
// the ENTIRE binding object — every field — so any change re-prompts (see
// app-exec-harness).
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

// SHA-256 (hex) over the canonical bytes of `value`.
export function sha256Canonical(value) {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}
