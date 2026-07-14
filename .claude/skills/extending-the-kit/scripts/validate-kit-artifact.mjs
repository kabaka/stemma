#!/usr/bin/env node
// validate-kit-artifact.mjs — mechanical standards check for kit artifacts the
// `extending-the-kit` flow DRAFTS in a consumer repo. Zero-dependency: Node
// built-ins only (no npm install, runs on any repo with Node >= 18).
//
// WHAT THIS CHECKS (statically, deterministically):
//   - Agent / skill FRONTMATTER: `name` present, kebab-case, no "claude" /
//     "anthropic"; `name` == directory (skills) or filename (agents);
//     `description` non-empty and <= 1024 chars; any `skills:` entries point at
//     directories that exist.
//   - TOOL HYGIENE (least privilege): an agent that OMITS the `tools` field
//     inherits ALL tools, including every MCP tool — a real over-grant. This is
//     reported as a WARNING (not every consumer agent must be locked down, but a
//     drafted one should make the choice explicit). An explicit allowlist passes.
//   - EVAL RECORDS (when given an evals file): each record is well-formed; a
//     TRIGGERING prompt must NOT name its target (the "skill-name-in-query" fake);
//     every triggering target has >= 1 positive AND >= 1 near-miss-negative.
//
// WHAT THIS CANNOT CHECK — read this before trusting a PASS:
//   Triggering BEHAVIOR — whether the artifact actually FIRES on the right
//   request and routes correctly — is PROBABILISTIC and is NOT mechanically
//   verifiable here. A PASS means the artifact is well-FORMED, not that it
//   triggers. You MUST verify triggering by hand in a FRESH session (author one
//   session, test in another) per the kit's eval method. This script only proves
//   the draft is honest and structurally sound enough to be worth testing.
//
// REPO-AGNOSTIC: this hard-codes NO project's agent roster. The read-only / tool
// policy is applied generically (warn on omitted tools for ANY agent). It works
// on any consumer repo's `.claude/{agents,skills}` or a staging directory.
//
// USAGE:
//   node validate-kit-artifact.mjs <path> [<path> ...]
//   node validate-kit-artifact.mjs path/to/agent.md
//   node validate-kit-artifact.mjs path/to/skill-dir/        (expects SKILL.md)
//   node validate-kit-artifact.mjs path/to/skill-dir/SKILL.md
//   node validate-kit-artifact.mjs path/to/staging-dir/      (scans recursively)
//   node validate-kit-artifact.mjs path/to/evals.jsonl       (eval-record lint)
//
// A path may be a single file (agent `.md`, a `SKILL.md`, or a `.jsonl` evals
// file) or a directory (scanned recursively for agents, skills, and evals).
//
// EXIT CODES: 0 = PASS (no FAIL-level violations; warnings allowed).
//             1 = FAIL (>= 1 violation).
//             2 = usage error (no path, or path does not exist).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Result accumulation. `fail` blocks (exit 1); `warn` is advisory (exit stays 0).
// ---------------------------------------------------------------------------
const failures = [];
const warnings = [];
const fail = (where, reason) => failures.push({ where, reason });
const warn = (where, reason) => warnings.push({ where, reason });

const isString = (v) => typeof v === "string";

// ---------------------------------------------------------------------------
// Frontmatter extraction + a minimal flat-YAML parser. Mirrors the kit's own
// validators so behavior is consistent, but kept standalone here so the script
// ships and runs with no sibling imports.
// ---------------------------------------------------------------------------

/** Extract the raw YAML frontmatter, or null when there is no leading block. */
function extractFrontmatter(text) {
  const normalized = text.replace(/^﻿/, "");
  const lines = normalized.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (lines[i] !== "---") return null;
  const body = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j] === "---") return body.join("\n");
    body.push(lines[j]);
  }
  return null; // opening fence never closed
}

function stripComment(s) {
  let inS = false;
  let inD = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === "#" && !inS && !inD && (k === 0 || s[k - 1] === " ")) {
      return s.slice(0, k);
    }
  }
  return s;
}

function unquote(s) {
  if (s.length >= 2) {
    const a = s[0];
    const b = s[s.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/**
 * Parse flat YAML sufficient for our frontmatter:
 *   key: scalar | key: [a, b] | key:\n  - a\n  - b | block scalars (| / >).
 * Unknown nested structures are ignored rather than thrown.
 */
function parseSimpleYaml(yaml) {
  const out = {};
  const lines = yaml.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const m = raw.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (!m) continue;
    const key = m[1];
    let rest = m[2].trim();

    const blockMatch = rest.match(/^([|>])([+-]?)$/);
    if (blockMatch) {
      const folded = blockMatch[1] === ">";
      const parts = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const ln = lines[j];
        if (ln.trim() === "") {
          parts.push("");
          continue;
        }
        if (/^\s/.test(ln)) {
          parts.push(ln.trim());
          continue;
        }
        break;
      }
      out[key] = parts.join(folded ? " " : "\n").trim();
      i = j - 1;
      continue;
    }

    rest = stripComment(rest).trim();

    if (rest === "") {
      const items = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const ln = lines[j];
        if (!ln.trim()) continue;
        const item = ln.match(/^\s+-\s+(.*)$/);
        if (item) {
          items.push(unquote(stripComment(item[1]).trim()));
          continue;
        }
        if (/^\S/.test(ln) || !/^\s+-/.test(ln)) break;
      }
      if (items.length > 0) {
        out[key] = items;
        i = j - 1;
      } else {
        out[key] = "";
      }
      continue;
    }

    if (rest.startsWith("[") && rest.endsWith("]")) {
      out[key] = rest
        .slice(1, -1)
        .split(",")
        .map((s) => unquote(s.trim()))
        .filter((s) => s.length > 0);
      continue;
    }

    out[key] = unquote(rest);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared frontmatter rules (name / description) applied to both surfaces.
// `kind` is "skill" | "agent"; `expectedName` is the dir (skill) or filename
// (agent) the `name` must equal.
// ---------------------------------------------------------------------------
function checkFrontmatter(rel, data, kind, expectedName) {
  const name = isString(data.name) ? data.name : "";
  const description = isString(data.description) ? data.description : "";

  if (!name) fail(rel, "`name` is missing or empty");
  if (!description) fail(rel, "`description` is missing or empty");

  if (name) {
    if (!/^[a-z0-9-]+$/.test(name)) {
      fail(rel, `\`name\` "${name}" is not kebab-case (lowercase/digits/hyphens)`);
    }
    if (name.length > 64) {
      fail(rel, `\`name\` "${name}" exceeds 64 chars (${name.length})`);
    }
    if (/claude/i.test(name)) fail(rel, '`name` must not contain "claude"');
    if (/anthropic/i.test(name)) fail(rel, '`name` must not contain "anthropic"');
    if (name !== expectedName) {
      const label = kind === "skill" ? "directory name" : "filename";
      fail(rel, `\`name\` "${name}" must equal ${label} "${expectedName}"`);
    }
  }

  if (description && description.length > 1024) {
    fail(rel, `\`description\` exceeds 1024 chars (${description.length})`);
  }
}

/** Resolve `skills:` entries to a string[] regardless of YAML list/scalar form. */
function skillsList(data) {
  if (!("skills" in data)) return null;
  if (Array.isArray(data.skills)) return data.skills;
  return data.skills ? [String(data.skills)] : [];
}

// ---------------------------------------------------------------------------
// Skill validation. `skillsRoot` (when known) lets us resolve `skills:` cross-
// references; for a standalone SKILL.md we infer the parent `skills/` dir.
// ---------------------------------------------------------------------------
function validateSkillFile(skillFile, skillsRoot) {
  const dir = basename(dirname(skillFile));
  const rel = skillFile;
  const fm = extractFrontmatter(readFileSync(skillFile, "utf8"));
  if (fm === null) {
    fail(rel, "missing or unterminated YAML frontmatter block");
    return;
  }
  const data = parseSimpleYaml(fm);
  checkFrontmatter(rel, data, "skill", dir);

  // A skill MAY preload skills via `skills:` — verify they resolve when we can
  // determine the skills root (the grandparent of this SKILL.md, or an explicit
  // root passed in from a directory scan).
  const skills = skillsList(data);
  if (skills) {
    const root = skillsRoot || dirname(dirname(skillFile));
    for (const s of skills) {
      const cand = join(root, s);
      if (!(existsSync(cand) && statSync(cand).isDirectory())) {
        fail(rel, `\`skills\` entry "${s}" is not an existing directory under ${root}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Agent validation. Tool hygiene is GENERIC: warn whenever `tools` is omitted
// (omission inherits ALL tools incl. MCP). We do NOT carry a project's read-only
// roster — the warning applies to any drafted agent, and an explicit allowlist
// silences it.
// ---------------------------------------------------------------------------
function validateAgentFile(agentFile, skillsRoot) {
  const expectedName = basename(agentFile, ".md");
  const rel = agentFile;
  const fm = extractFrontmatter(readFileSync(agentFile, "utf8"));
  if (fm === null) {
    fail(rel, "missing or unterminated YAML frontmatter block");
    return;
  }
  const data = parseSimpleYaml(fm);
  checkFrontmatter(rel, data, "agent", expectedName);

  // Least-privilege: an omitted `tools` field inherits ALL tools (every built-in
  // plus every configured MCP tool). Warn so the author makes an explicit choice.
  if (!("tools" in data)) {
    warn(
      rel,
      `agent omits the \`tools\` field — it will inherit ALL tools (incl. MCP). ` +
        `Declare an explicit allowlist to scope it (least privilege).`
    );
  } else {
    const toolsRaw = Array.isArray(data.tools) ? data.tools.join(",") : String(data.tools);
    const toolset = toolsRaw.split(",").map((t) => t.trim()).filter(Boolean);
    if (toolset.length === 0) {
      warn(rel, "`tools` is present but empty — the agent can use no tools; was that intended?");
    }
  }

  // skills: cross-references must resolve when a skills root is determinable.
  const skills = skillsList(data);
  if (skills && skillsRoot) {
    for (const s of skills) {
      const cand = join(skillsRoot, s);
      if (!(existsSync(cand) && statSync(cand).isDirectory())) {
        fail(rel, `\`skills\` entry "${s}" is not an existing directory under ${skillsRoot}`);
      }
    }
  } else if (skills && skills.length > 0 && !skillsRoot) {
    warn(
      rel,
      `\`skills\` references ${skills.join(", ")} but no skills/ root was resolvable ` +
        `from this path — cross-references not checked. Run against the repo root to verify.`
    );
  }
}

// ---------------------------------------------------------------------------
// Eval-record lint. Same anti-fake + coverage rules as the kit's validator, but
// repo-agnostic (operates on the given file/dir). JSONL: one JSON object/line;
// blank lines and `#` comment lines ignored.
// ---------------------------------------------------------------------------
const TRIGGERING_KINDS = new Set(["positive", "near-miss-negative"]);
const ALL_KINDS = new Set(["positive", "near-miss-negative", "behavior"]);

/** True if `prompt` names `target` as a whole token (case-insensitive). */
function mentionsTarget(prompt, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[^A-Za-z0-9_-])${escaped}(?:[^A-Za-z0-9_-]|$)`, "i");
  return re.test(prompt);
}

function validateEvalFile(evalFile) {
  const rel = evalFile;
  const lines = readFileSync(evalFile, "utf8").split(/\r?\n/);
  const targetKinds = new Map(); // target -> Set(kinds)
  const seenIds = new Map(); // id -> first location
  let recordCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const loc = `${rel}:${i + 1}`;

    let rec;
    try {
      rec = JSON.parse(lines[i]);
    } catch (e) {
      fail(loc, `invalid JSON: ${e.message}`);
      continue;
    }
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
      fail(loc, "record must be a JSON object");
      continue;
    }
    recordCount++;

    let ok = true;
    for (const f of ["id", "target", "prompt", "expectation", "kind"]) {
      if (!(f in rec)) {
        fail(loc, `missing required field \`${f}\``);
        ok = false;
      } else if (!isString(rec[f]) || rec[f].trim() === "") {
        fail(loc, `\`${f}\` must be a non-empty string`);
        ok = false;
      }
    }
    if (!ok) continue;

    if (!ALL_KINDS.has(rec.kind)) {
      fail(loc, `\`kind\` "${rec.kind}" must be one of positive, near-miss-negative, behavior`);
      continue;
    }

    if (seenIds.has(rec.id)) {
      fail(loc, `duplicate \`id\` "${rec.id}" (first seen at ${seenIds.get(rec.id)})`);
    } else {
      seenIds.set(rec.id, loc);
    }

    if (TRIGGERING_KINDS.has(rec.kind) && mentionsTarget(rec.prompt, rec.target)) {
      fail(
        loc,
        `triggering \`prompt\` names its target "${rec.target}" — a skill-name-in-query ` +
          `fake; rephrase so the prompt does not mention the target`
      );
    }

    if (!targetKinds.has(rec.target)) targetKinds.set(rec.target, new Set());
    targetKinds.get(rec.target).add(rec.kind);
  }

  for (const [target, kinds] of targetKinds) {
    const hasTriggering = [...kinds].some((k) => TRIGGERING_KINDS.has(k));
    if (!hasTriggering) continue;
    if (!kinds.has("positive")) {
      fail(`${rel} [target:${target}]`, `triggering target "${target}" has no \`positive\` eval`);
    }
    if (!kinds.has("near-miss-negative")) {
      fail(
        `${rel} [target:${target}]`,
        `triggering target "${target}" has no \`near-miss-negative\` eval`
      );
    }
  }

  return recordCount;
}

// ---------------------------------------------------------------------------
// Path dispatch. Classify each input path and route it to the right validator.
// ---------------------------------------------------------------------------
const counts = { skills: 0, agents: 0, evals: 0 };

/** Walk a directory, classifying files by name/location. */
function scanDir(dir) {
  // If this dir contains agents/ and/or skills/, treat it as a surface root so
  // skills: cross-refs resolve against the real skills/ dir.
  const skillsRoot = existsSync(join(dir, "skills")) ? join(dir, "skills") : null;

  const walk = (abs, inAgentsDir) => {
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      const child = join(abs, ent.name);
      if (ent.isDirectory()) {
        walk(child, inAgentsDir || ent.name === "agents");
        continue;
      }
      if (!ent.isFile()) continue;
      if (ent.name === "SKILL.md") {
        counts.skills++;
        validateSkillFile(child, skillsRoot);
      } else if (ent.name.endsWith(".jsonl")) {
        counts.evals += validateEvalFile(child) > 0 ? 1 : 0;
      } else if (ent.name.endsWith(".md") && inAgentsDir) {
        // Only treat .md files under an `agents/` directory as agent definitions
        // (a bare .md elsewhere is prose, not an agent).
        counts.agents++;
        validateAgentFile(child, skillsRoot);
      }
    }
  };
  walk(dir, false);
}

function classifyAndRun(p) {
  const abs = resolve(p);
  if (!existsSync(abs)) {
    fail(p, "path does not exist");
    return;
  }
  const st = statSync(abs);
  if (st.isDirectory()) {
    // A skill directory (has SKILL.md) is validated as a single skill so a
    // bare `.../my-skill/` path works as documented.
    if (existsSync(join(abs, "SKILL.md"))) {
      counts.skills++;
      validateSkillFile(join(abs, "SKILL.md"), null);
      return;
    }
    scanDir(abs);
    return;
  }
  // Single file.
  const name = basename(abs);
  if (name === "SKILL.md") {
    counts.skills++;
    validateSkillFile(abs, null);
  } else if (name.endsWith(".jsonl")) {
    counts.evals += validateEvalFile(abs) > 0 ? 1 : 0;
  } else if (name.endsWith(".md")) {
    // A lone `.md` file passed directly is assumed to be an agent definition.
    counts.agents++;
    validateAgentFile(abs, null);
  } else {
    fail(p, `unrecognized artifact type (expected an agent .md, a SKILL.md, or a .jsonl evals file)`);
  }
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
const inputs = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (inputs.length === 0) {
  console.error("Usage: node validate-kit-artifact.mjs <path> [<path> ...]");
  console.error("  <path> = an agent .md, a SKILL.md (or its dir), a .jsonl evals file, or a staging dir.");
  process.exit(2);
}

let usageError = false;
for (const p of inputs) {
  if (!existsSync(resolve(p))) {
    console.error(`error: path does not exist: ${p}`);
    usageError = true;
  }
}
if (usageError) process.exit(2);

for (const p of inputs) classifyAndRun(p);

console.log("Kit-artifact validation");
console.log(
  `  checked ${counts.skills} skill(s), ${counts.agents} agent(s), ${counts.evals} eval file(s)`
);
console.log(
  "  note: structural lint only — does NOT prove the artifact actually triggers. " +
    "Verify triggering by hand in a fresh session."
);

if (warnings.length > 0) {
  console.log(`WARN: ${warnings.length} advisory finding(s):`);
  for (const { where, reason } of warnings) console.log(`  ${where}: ${reason}`);
}

if (failures.length === 0) {
  console.log("PASS: all artifacts well-formed");
  process.exit(0);
}

console.log(`FAIL: ${failures.length} violation(s):`);
for (const { where, reason } of failures) console.log(`  ${where}: ${reason}`);
process.exit(1);
