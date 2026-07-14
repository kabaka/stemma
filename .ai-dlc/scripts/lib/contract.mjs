// contract.mjs — shared exit-code contract for AI-DLC design-QA tools.
//
// THE CONTRACT (identical across every tool in product/scripts/):
//   0  PASS     — the tool actually gathered evidence and the result is good.
//                 This is the ONLY green result.
//   1  FINDINGS — the tool gathered evidence and found real problems.
//   2  ERROR    — bad invocation, unreadable/malformed input, internal error,
//                 or a SECURITY REFUSAL (a rejected path/exec/env).
//   3  SKIPPED  — evidence-incomplete; treated by callers as NOT-A-PASS. The
//                 binding is absent, the surface is non-visual, a confirmation
//                 is missing, or there was nothing to evaluate.
//
// CRITICAL INVARIANT — SKIPPED is NOT a PASS.
//   A caller (CI gate, qa, a wrapper) MUST be able to tell "the thing is good"
//   (exit 0) apart from "we could not gather the evidence" (exit 3). Every
//   SKIPPED prints a loud, unambiguous `SKIPPED:` line to stdout and exits 3 —
//   never 0, never silently. Likewise every ERROR prints a loud `ERROR:` line.
//   The words PASS / FINDINGS / SKIPPED / ERROR are reserved sentinels; nothing
//   else may print a line that begins with `SKIPPED:` to mean "good".

export const EXIT = Object.freeze({
  PASS: 0,
  FINDINGS: 1,
  ERROR: 2,
  SKIPPED: 3,
});

// Human-readable name for an exit code (for diagnostics / test assertions).
export function exitName(code) {
  switch (code) {
    case EXIT.PASS: return 'PASS';
    case EXIT.FINDINGS: return 'FINDINGS';
    case EXIT.ERROR: return 'ERROR';
    case EXIT.SKIPPED: return 'SKIPPED';
    default: return `UNKNOWN(${code})`;
  }
}

// Print a loud SKIPPED line and RETURN the SKIPPED exit code. SKIPPED is
// deliberately impossible to confuse with PASS: it goes to stdout prefixed with
// the reserved `SKIPPED:` sentinel and the caller exits 3 (≠ 0). Callers do:
//   return skip('no binding found');
export function skip(reason, out = process.stdout) {
  out.write(`SKIPPED: ${reason}\n`);
  out.write('         Evidence-incomplete — callers MUST NOT treat this as a pass (exit 3).\n');
  return EXIT.SKIPPED;
}

// Print a loud ERROR line (to stderr) and RETURN the ERROR exit code. Used for
// bad invocation, malformed input, and SECURITY REFUSALS — anything that is not
// a clean evaluation. Never 0.
export function error(reason, err = process.stderr) {
  err.write(`ERROR: ${reason}\n`);
  return EXIT.ERROR;
}

// Print a PASS line and RETURN 0. Centralized so the green sentinel is uniform.
export function pass(reason, out = process.stdout) {
  out.write(`PASS: ${reason}\n`);
  return EXIT.PASS;
}

// Print a FINDINGS header and RETURN 1. Detail lines are the caller's job.
export function findings(reason, out = process.stdout) {
  out.write(`FINDINGS: ${reason}\n`);
  return EXIT.FINDINGS;
}
