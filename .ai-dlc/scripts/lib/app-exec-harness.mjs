// app-exec-harness.mjs — the FAIL-CLOSED authorizer every browser/app-launching
// design-QA tool MUST route through to launch a process.
//
// THREAT MODEL
//   The stack-binding (.ai-dlc/stack-binding.json) is UNTRUSTED input — a
//   consumer repo (or a malicious PR into one) can carry a crafted binding. This
//   harness decides whether and how to launch a child process described by that
//   binding. A miss here is shippable RCE or a forged pass. Every requirement
//   below (R1–R19) is a defense; the attacker-corpus in
//   product/scripts/test/app-exec-harness.attack.test.mjs proves each holds.
//
// IT NEVER LAUNCHES ON IMPORT. Importing this module spawns nothing. It exposes
// `authorizeAndRun(spec)` which a caller invokes; that function decides, and on
// the happy path (and ONLY then) spawns one child with shell:false.
//
// EXIT-CONTRACT MAPPING (see contract.mjs)
//   0 PASS    — confirmed AND launched AND audited with no findings (R18).
//   1 FINDINGS— launched, audited, real findings (the audit callback's job).
//   2 ERROR   — a security refusal (bad command/args/env/path) or a boot/exec
//               fault. A rejected launch is ERROR 2, never silent.
//   3 SKIPPED — DEFAULT DENY: no current confirmation, non-TTY with no token,
//               non-visual/absent surface, or nothing to audit. Never a pass.

import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, existsSync, statSync } from 'node:fs';
import { resolve, join, isAbsolute, basename } from 'node:path';
import { isatty } from 'node:tty';
import {
  EXIT,
  ToolError,
  resolveContained,
  loadBinding,
  sha256Canonical,
  isContained,
} from './binding.mjs';

// ---- R2: executable allowlist -------------------------------------------
// The ONLY bare executables a launch may name. Anything else must be a repo-
// contained node_modules/.bin entry that passes containment. Absolute paths,
// /bin/sh, ..-escapes, and leading-dash names are rejected.
const ALLOWED_COMMANDS = new Set(['node', 'npm', 'pnpm', 'yarn', 'npx']);

// ---- R3: argument bounds ------------------------------------------------
const MAX_ARGS = 64;
const MAX_ARG_LEN = 4096;
// Control chars (NUL..US, plus DEL) are forbidden anywhere in an arg/command.
// Built without any literal control byte in this source.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f]');

// ---- R4: environment policy ---------------------------------------------
// Child env is a kit-controlled MINIMAL base, never process.env wholesale.
// Only these keys are copied from the parent (presence-gated), and binding-
// supplied env entries are allowed ONLY if their key is in ENV_ALLOWLIST AND
// passes the hard-block test.
const ENV_BASE_PASSTHROUGH = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TZ'];
const ENV_ALLOWLIST = new Set([
  'CI',
  'AIDLC_VISUAL_QA_HEADLESS',
  'PWDEBUG_OFF', // explicit, harmless example of a kit-safe toggle
]);

// HARD-BLOCK: keys that can hijack the child even if otherwise "allowed".
// Tested case-insensitively against both prefix rules and exact names.
const ENV_BLOCK_EXACT = new Set([
  'NODE_OPTIONS',
  'NODE_EXTRA_CA_CERTS',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  'PLAYWRIGHT_BROWSERS_PATH',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'FTP_PROXY',
]);
const ENV_BLOCK_PREFIX = ['NODE_', 'PLAYWRIGHT_', 'DYLD_', 'NPM_CONFIG_', 'GIT_', 'LD_'];
const ENV_BLOCK_SUFFIX = ['_PROXY'];

function isBlockedEnvKey(key) {
  const upper = key.toUpperCase();
  if (ENV_BLOCK_EXACT.has(upper)) return true;
  for (const p of ENV_BLOCK_PREFIX) if (upper.startsWith(p)) return true;
  for (const s of ENV_BLOCK_SUFFIX) if (upper.endsWith(s)) return true;
  // lower-case proxy variants (http_proxy etc.) are caught by the upper() fold.
  return false;
}

// ---- R5: bounded execution ----------------------------------------------
const DEFAULT_TIMEOUT_MS = 120000; // 2 min hard wall-clock ceiling.
const MAX_TIMEOUT_MS = 600000;

// ---- the confirmation hash covers the WHOLE binding (R8) ----------------
// The hash is taken over the ENTIRE canonicalized binding object, NOT a
// hand-maintained subset of fields. This makes the guarantee literally true and
// future-proof: ANY change to ANY field of the binding — `command`/`args`/`env`,
// OR an audit-determining field the browser tools actually read
// (`static_dir`, `audit_paths`, `routes`, `baseline_dir`, `breakpoints`,
// `axe_tags`, `pixel_tolerance`, …), OR a field not yet added — changes the hash
// and so invalidates a prior confirmation. A subset hash was a faithfulness
// defect: it left audit-target fields unhashed, so mutating `static_dir` /
// `audit_paths` after confirmation would NOT re-prompt. Hashing the whole object
// closes that gap and stays correct as fields are added.

// Non-visual surfaces never launch anything (R18).
const NON_VISUAL_SURFACES = new Set(['cli', 'none', 'tui', 'mobile']);

// The confirmation token IS the hash of the ENTIRE canonicalized binding (R7/R8).
// A human reads the printed hash and supplies it back; the repo cannot self-
// confirm because it cannot produce a value it does not already print, and a
// committed flag/file is explicitly ignored. `canonicalize` sorts keys
// recursively, so the hash is independent of key order/formatting and total over
// every field present in the binding.
export function execHash(binding) {
  return sha256Canonical(binding);
}

// ---- R1/R2/R3: validate the command + args ------------------------------
// Returns { command, args } of validated plain strings, or throws ToolError.
// NO string is ever split into a command line; command and args arrive already
// separated and are each validated independently.
function validateCommandAndArgs(binding, repoRoot) {
  const rawCommand = binding.command;
  if (typeof rawCommand !== 'string' || rawCommand.length === 0) {
    throw new ToolError('command must be a non-empty string (no run-string splitting)');
  }
  if (CONTROL_CHARS.test(rawCommand)) {
    throw new ToolError('command contains a control character');
  }
  // R2: leading-dash executables are rejected (they would be parsed as options).
  if (rawCommand.startsWith('-')) {
    throw new ToolError(`command may not start with '-': ${JSON.stringify(rawCommand)}`);
  }

  let resolvedCommand;
  if (ALLOWED_COMMANDS.has(rawCommand)) {
    // A bare allowlisted launcher. spawn(…, {shell:false}) resolves it on PATH.
    resolvedCommand = rawCommand;
  } else if (
    rawCommand.startsWith('node_modules/.bin/') ||
    rawCommand.startsWith('./node_modules/.bin/')
  ) {
    // A repo-local binary. MUST contain no path traversal and resolve INSIDE the
    // repo root (containment + realpath via resolveContained). Absolute paths,
    // ..-escapes, and symlinks out are rejected there.
    if (isAbsolute(rawCommand)) {
      throw new ToolError('command must not be an absolute path');
    }
    const contained = resolveContained(repoRoot, rawCommand, 'command', 'read');
    if (!existsSync(contained)) {
      throw new ToolError(`command not found in repo: ${rawCommand}`);
    }
    resolvedCommand = contained;
  } else {
    // Everything else — /bin/sh, ../../usr/bin/env, arbitrary absolute paths,
    // bare names not on the allowlist — is refused.
    throw new ToolError(
      `command not allowed: ${JSON.stringify(rawCommand)} ` +
      `(allowed: ${[...ALLOWED_COMMANDS].join(', ')}, or a repo-local node_modules/.bin/* path)`
    );
  }

  // R3: args is a validated array of plain strings.
  const rawArgs = Object.prototype.hasOwnProperty.call(binding, 'args') ? binding.args : [];
  if (!Array.isArray(rawArgs)) {
    throw new ToolError('args must be an array of strings');
  }
  if (rawArgs.length > MAX_ARGS) {
    throw new ToolError(`args exceeds the ${MAX_ARGS}-element limit`);
  }
  const args = [];
  for (const a of rawArgs) {
    if (typeof a !== 'string') {
      throw new ToolError('every args element must be a string');
    }
    if (a.length > MAX_ARG_LEN) {
      throw new ToolError(`an args element exceeds the ${MAX_ARG_LEN}-char limit`);
    }
    if (CONTROL_CHARS.test(a)) {
      throw new ToolError('an args element contains a control character (NUL/newline/etc.)');
    }
    args.push(a);
  }
  return { command: resolvedCommand, args };
}

// ---- R4: build the child env -------------------------------------------
// Returns { env, blocked } — env is the minimal child environment; blocked is a
// list of refused keys (for the printed refusal). A hard-blocked key in the
// binding's env is a REFUSAL (ToolError) — the child never receives it.
function buildChildEnv(binding) {
  const env = Object.create(null);
  // Minimal base from the parent, presence-gated.
  for (const k of ENV_BASE_PASSTHROUGH) {
    if (typeof process.env[k] === 'string') env[k] = process.env[k];
  }
  const bindingEnv = Object.prototype.hasOwnProperty.call(binding, 'env') ? binding.env : null;
  if (bindingEnv === null || bindingEnv === undefined) {
    return { env, blocked: [] };
  }
  if (typeof bindingEnv !== 'object' || Array.isArray(bindingEnv)) {
    throw new ToolError('env must be a JSON object of string values');
  }
  const blocked = [];
  for (const [key, val] of Object.entries(bindingEnv)) {
    if (isBlockedEnvKey(key)) {
      blocked.push(key);
      continue; // never copy a blocked key
    }
    if (!ENV_ALLOWLIST.has(key)) {
      // Not on the documented safe allowlist → refuse the whole launch rather
      // than silently dropping (an unknown key may be load-bearing for an
      // attack we have not enumerated). Fail closed.
      throw new ToolError(
        `env key not on the safe allowlist: ${JSON.stringify(key)} ` +
        `(allowed: ${[...ENV_ALLOWLIST].join(', ')})`
      );
    }
    if (typeof val !== 'string') {
      throw new ToolError(`env value for ${JSON.stringify(key)} must be a string`);
    }
    if (CONTROL_CHARS.test(val)) {
      throw new ToolError(`env value for ${JSON.stringify(key)} contains a control character`);
    }
    env[key] = val;
  }
  if (blocked.length > 0) {
    // A hard-blocked key is a refusal: the launch does not proceed.
    throw new ToolError(
      `env contains hard-blocked key(s): ${blocked.join(', ')} — refusing to launch`
    );
  }
  return { env, blocked };
}

// ---- R10/R11: prepare the contained, freshly-created output dir ----------
// Writes are confined to a kit-owned, freshly-created subdir under a contained
// output root. Returns the absolute path of the new dir. Never clobbers an
// existing path: mkdtempSync creates a brand-new unique directory.
function prepareOutputDir(binding, repoRoot) {
  const rawOut = Object.prototype.hasOwnProperty.call(binding, 'output_dir')
    ? binding.output_dir
    : '.ai-dlc/visual-qa-out';
  if (typeof rawOut !== 'string' || rawOut.length === 0) {
    throw new ToolError('output_dir must be a non-empty string');
  }
  // Contain the parent (write mode: symlinked ancestors rejected).
  const containedRoot = resolveContained(repoRoot, rawOut, 'output_dir', 'write');
  // The parent must exist as a real directory we created/own; create the root if
  // missing is the caller's setup. Here we mkdtemp a fresh child so we never
  // clobber. If containedRoot itself is a symlink, reject (no-follow).
  if (existsSync(containedRoot)) {
    let st;
    try {
      st = statSync(containedRoot); // follows; lstat check below catches symlink
    } catch (e) {
      throw new ToolError(`cannot stat output_dir ${rawOut}: ${e.message}`);
    }
    if (!st.isDirectory()) {
      throw new ToolError(`output_dir is not a directory: ${rawOut}`);
    }
    // Re-confirm the real path is still contained (defense in depth).
    const real = realpathSync(containedRoot);
    const realRoot = realpathSync(resolve(repoRoot));
    if (!isContained(realRoot, real)) {
      throw new ToolError(`output_dir escapes --repo root via symlink: ${rawOut}`);
    }
  } else {
    throw new ToolError(
      `output_dir does not exist: ${rawOut} — create the kit-owned output root first`
    );
  }
  // Freshly-create a unique subdir; mkdtemp never reuses or clobbers.
  const fresh = mkdtempSync(join(containedRoot, 'run-'));
  return fresh;
}

// ---- R6/R7/R9: confirmation gate ----------------------------------------
// Returns { confirmed: boolean, mode: 'tty'|'token'|'none', reason }. DEFAULT
// DENY: anything other than an explicit, current, human-supplied confirmation
// that matches the exec hash is unconfirmed. A binding field (`confirmed:true`)
// or a committed file is IGNORED here by construction — we only consult the live
// token/TTY, never the binding or repo state. (R9: nothing is persisted.)
export function checkConfirmation(opts) {
  const { execHashHex, confirmToken, env, ttyIn, ttyOut } = opts;

  // CI / non-TTY path: an operator-supplied token must equal the exec hash.
  const token =
    (typeof confirmToken === 'string' && confirmToken) ||
    (env && typeof env.AIDLC_VISUAL_QA_CONFIRM === 'string' && env.AIDLC_VISUAL_QA_CONFIRM) ||
    null;

  if (token) {
    if (token === execHashHex) {
      return { confirmed: true, mode: 'token', reason: 'operator token matches exec hash' };
    }
    return {
      confirmed: false,
      mode: 'token',
      reason: 'supplied --confirm-exec / AIDLC_VISUAL_QA_CONFIRM does not match the exec hash ' +
        '(binding may have changed — re-confirm)',
    };
  }

  // Interactive path: requires BOTH ends to be a TTY. The CALLER is responsible
  // for printing the resolved command/args/env-key-names/URLs/hash and reading
  // an affirmative; this function only reports that an interactive answer is
  // POSSIBLE. With no token and no TTY → DEFAULT DENY.
  if (ttyIn && ttyOut) {
    return { confirmed: false, mode: 'tty', reason: 'interactive confirmation required' };
  }

  return {
    confirmed: false,
    mode: 'none',
    reason: 'no confirmation token and not an interactive TTY — default deny',
  };
}

// ---- R19: echo the launch (keys, never secret values) -------------------
// Prints the resolved command/args and the env KEY names (never env values), plus
// the REAL audit targets the browser tools will navigate — the loopback paths
// from `audit_paths`/`routes` and the `static_dir` that the build command emits
// into. (The old echo printed `urls`, which is empty for every real binding —
// real bindings carry `audit_paths`/`routes`, so the human saw "(none)" and not
// what was actually about to be audited.)
export function describeLaunch(command, args, env, binding) {
  const lines = [];
  lines.push(`  executable : ${command}`);
  lines.push(`  args       : ${JSON.stringify(args)}`);
  lines.push(`  env keys   : ${Object.keys(env).sort().join(', ') || '(none)'}`);
  const auditPaths = Array.isArray(binding.audit_paths) ? binding.audit_paths : [];
  const routes = Array.isArray(binding.routes) ? binding.routes : [];
  // Union of the path-only audit targets, order-preserving and de-duplicated.
  const targets = [...new Set([...auditPaths, ...routes])];
  lines.push(`  audit paths: ${targets.length ? targets.join(', ') : '(none)'}`);
  const staticDir = typeof binding.static_dir === 'string' ? binding.static_dir : '(default)';
  lines.push(`  static dir : ${staticDir}`);
  lines.push(`  exec hash  : ${execHash(binding)}`);
  return lines.join('\n');
}

// ---- the authorizer ------------------------------------------------------
// `authorizeAndRun(spec)` is the single entry point. It returns an exit code
// from the contract; it does NOT call process.exit (the caller does). It spawns
// at most one child, only on the fully-authorized path.
//
// spec = {
//   repoRoot,                  // contained repo root (cwd is pinned to it, R5)
//   confirmToken,              // operator token from --confirm-exec (or undefined)
//   timeoutMs,                 // optional override (<= MAX_TIMEOUT_MS)
//   audit,                     // async (childResult, outputDir) -> {findings:[...]}
//   spawnImpl, env, ttyIn, ttyOut, // injectable for tests (default to real)
//   out, err,                  // streams (default process.stdout/stderr)
// }
export async function authorizeAndRun(spec) {
  const out = spec.out || process.stdout;
  const err = spec.err || process.stderr;
  const env = spec.env || process.env;
  const spawnImpl = spec.spawnImpl || spawn;
  const ttyIn = spec.ttyIn !== undefined ? spec.ttyIn : isatty(0);
  const ttyOut = spec.ttyOut !== undefined ? spec.ttyOut : isatty(1);

  // R10/R11: the repo root must itself be contained/real.
  let repoRoot;
  try {
    repoRoot = realpathSync(resolve(spec.repoRoot));
  } catch (e) {
    err.write(`ERROR: --repo is not a usable directory: ${e.message}\n`);
    return EXIT.ERROR;
  }

  // R5: never run as root/sudo. The uid getter is injectable ONLY so the test
  // suite can simulate a non-root operator inside a root CI container; in
  // production `spec.getuid` is undefined and the real process.getuid is used,
  // so a real root launch is still refused (fail closed).
  const getuid = typeof spec.getuid === 'function'
    ? spec.getuid
    : (typeof process.getuid === 'function' ? process.getuid.bind(process) : null);
  if (getuid && getuid() === 0) {
    err.write('ERROR: refusing to launch as root (uid 0).\n');
    return EXIT.ERROR;
  }

  // Load the untrusted binding.
  let bindingInfo;
  try {
    bindingInfo = loadBinding(repoRoot);
  } catch (e) {
    if (e instanceof ToolError) {
      err.write(`ERROR: ${e.message}\n`);
      return EXIT.ERROR;
    }
    throw e;
  }
  if (!bindingInfo.present) {
    out.write('SKIPPED: no .ai-dlc/stack-binding.json — nothing to launch (default deny, exit 3).\n');
    return EXIT.SKIPPED;
  }
  const binding = bindingInfo.binding;

  // R18: non-visual / absent surface never launches.
  const surface = typeof binding.surface === 'string' ? binding.surface.toLowerCase() : null;
  if (binding.absent === true) {
    out.write('SKIPPED: binding marks this repo absent (no UI surface) — no launch (exit 3).\n');
    return EXIT.SKIPPED;
  }
  if (!surface || NON_VISUAL_SURFACES.has(surface)) {
    out.write(`SKIPPED: surface "${surface}" is non-visual — no app launch (exit 3).\n`);
    return EXIT.SKIPPED;
  }

  // R1/R2/R3: validate command + args. Any rejection → ERROR 2, NO spawn.
  let command, args;
  try {
    ({ command, args } = validateCommandAndArgs(binding, repoRoot));
  } catch (e) {
    if (e instanceof ToolError) { err.write(`ERROR: ${e.message}\n`); return EXIT.ERROR; }
    throw e;
  }

  // R4: build the minimal child env. Hard-blocked/unknown keys → ERROR 2.
  let childEnv;
  try {
    ({ env: childEnv } = buildChildEnv(binding));
  } catch (e) {
    if (e instanceof ToolError) { err.write(`ERROR: ${e.message}\n`); return EXIT.ERROR; }
    throw e;
  }

  // R7/R8: compute the exec hash over the WHOLE binding (every field).
  const hashBeforeConfirm = execHash(binding);

  // Echo the resolved launch (R19 — keys/urls only, no secret values).
  out.write('Proposed app launch (requires explicit confirmation):\n');
  out.write(describeLaunch(command, args, childEnv, binding) + '\n');

  // R6/R7/R9: confirmation gate. Default deny.
  const conf = checkConfirmation({
    execHashHex: hashBeforeConfirm,
    confirmToken: spec.confirmToken,
    env,
    ttyIn,
    ttyOut,
  });
  if (!conf.confirmed) {
    if (conf.mode === 'tty') {
      // Interactive confirmation must be performed by the caller's prompt. In
      // this non-interactive harness API the absence of a matching token under a
      // TTY still defaults to deny unless the caller injected a confirmed token.
      out.write('SKIPPED: app execution not confirmed — interactive approval required (exit 3).\n');
      return EXIT.SKIPPED;
    }
    if (conf.mode === 'token') {
      out.write(`SKIPPED: app execution not confirmed — ${conf.reason} (exit 3).\n`);
      return EXIT.SKIPPED;
    }
    out.write('SKIPPED: app execution not confirmed — ' +
      'pass --confirm-exec <hash> or AIDLC_VISUAL_QA_CONFIRM=<hash> (exit 3).\n');
    return EXIT.SKIPPED;
  }

  // R8: re-read + re-hash the binding IMMEDIATELY before spawn. A changed or
  // freshly-pulled binding invalidates the confirmation and aborts the launch —
  // it can never auto-run on a different command/args/env than was confirmed.
  let recheck;
  try {
    recheck = loadBinding(repoRoot);
  } catch (e) {
    if (e instanceof ToolError) { err.write(`ERROR: ${e.message}\n`); return EXIT.ERROR; }
    throw e;
  }
  if (!recheck.present) {
    out.write('SKIPPED: binding disappeared before launch — aborting (exit 3).\n');
    return EXIT.SKIPPED;
  }
  const hashAtSpawn = execHash(recheck.binding);
  if (hashAtSpawn !== hashBeforeConfirm) {
    out.write('SKIPPED: binding changed after confirmation (exec hash mismatch) — ' +
      're-confirmation required, no launch (exit 3).\n');
    return EXIT.SKIPPED;
  }

  // R10/R11: prepare the freshly-created contained output dir.
  let outputDir;
  try {
    outputDir = prepareOutputDir(recheck.binding, repoRoot);
  } catch (e) {
    if (e instanceof ToolError) { err.write(`ERROR: ${e.message}\n`); return EXIT.ERROR; }
    throw e;
  }

  // R5: bounded execution. Detached process group so we can kill the whole tree.
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (typeof spec.timeoutMs === 'number' && spec.timeoutMs > 0) {
    timeoutMs = Math.min(spec.timeoutMs, MAX_TIMEOUT_MS);
  }

  out.write(`Launching (confirmed): ${command} ${JSON.stringify(args)}\n`);

  let childResult;
  try {
    childResult = await runChild({
      spawnImpl, command, args, childEnv, cwd: repoRoot, timeoutMs, out, err,
    });
  } catch (e) {
    err.write(`ERROR: launch failed: ${e.message}\n`);
    return EXIT.ERROR;
  }

  if (childResult.timedOut) {
    out.write('SKIPPED: app launch timed out and was killed — no audit (exit 3).\n');
    return EXIT.SKIPPED;
  }
  if (childResult.bootFailed) {
    out.write('SKIPPED: app failed to boot — no audit produced (exit 3).\n');
    return EXIT.SKIPPED;
  }

  // R18: audit must produce a non-empty evaluated set to PASS. An empty audit
  // set is SKIPPED, never PASS.
  let auditResult;
  try {
    auditResult = spec.audit ? await spec.audit(childResult, outputDir) : { evaluated: 0, findings: [] };
  } catch (e) {
    err.write(`ERROR: audit failed: ${e.message}\n`);
    return EXIT.ERROR;
  }
  const evaluated = auditResult.evaluated ?? 0;
  const findings = Array.isArray(auditResult.findings) ? auditResult.findings : [];
  if (evaluated <= 0) {
    out.write('SKIPPED: launch produced an empty audit set — NOT a pass (exit 3).\n');
    return EXIT.SKIPPED;
  }
  if (findings.length > 0) {
    out.write(`FINDINGS: ${findings.length} issue(s) from the audit.\n`);
    return EXIT.FINDINGS;
  }
  out.write(`PASS: confirmed launch audited cleanly (${evaluated} checked).\n`);
  return EXIT.PASS;
}

// ---- R1/R5: the actual spawn --------------------------------------------
// shell:false + argv array ALWAYS. detached process group + kill(-pgid) on
// timeout (Windows: taskkill /T). No string is passed as a command line.
function runChild({ spawnImpl, command, args, childEnv, cwd, timeoutMs, out, err }) {
  return new Promise((resolvePromise, rejectPromise) => {
    let child;
    try {
      child = spawnImpl(command, args, {
        cwd,
        env: childEnv,
        shell: false, // R1 — NEVER a shell.
        detached: process.platform !== 'win32', // own process group for tree-kill
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      rejectPromise(e);
      return;
    }

    let timedOut = false;
    let settled = false;
    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    if (child.stderr) child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

    const killTree = () => {
      try {
        if (process.platform === 'win32') {
          spawnImpl('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: false });
        } else if (child.pid) {
          // Negative pid → the whole detached process group.
          process.kill(-child.pid, 'SIGKILL');
        }
      } catch {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, timeoutMs);

    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A spawn error (e.g. ENOENT) is a boot failure, not a pass.
      resolvePromise({ bootFailed: true, error: e, stdout, stderr });
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        timedOut,
        bootFailed: false,
        code,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

// Exported internals for the attacker-corpus tests (so they can assert on the
// validation layer WITHOUT ever spawning a real child).
export const __internals = {
  validateCommandAndArgs,
  buildChildEnv,
  prepareOutputDir,
  isBlockedEnvKey,
  ALLOWED_COMMANDS,
  ENV_ALLOWLIST,
};
