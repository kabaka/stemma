#!/usr/bin/env bash
# AI-DLC arbiter-gate hook (Claude Code PreToolUse, v2.x contract).
#
# WHAT THIS ENFORCES (read literally — no claim here the hook cannot back)
#   This hook enforces the two AI-DLC phase-transition gates that take the
#   concrete form of a Bash command:
#     * Gate 3 — Construction -> integration/merge  (class: construction-to-merge)
#     * Gate 4 — -> Operations / deploy / release   (class: to-operations)
#   Before such a command runs, the hook requires a recorded human APPROVE
#   Decision Record whose machine fields match the gate class. Absent a matching
#   record, the action is DENIED (permissionDecision: deny) with an explicit
#   reason. The model cannot talk its way past a missing human decision.
#
# WHAT THIS CANNOT ENFORCE (honest limits)
#   - Gates 1 (Inception->Construction) and 2 (the design fork) are CONCEPTUAL
#     transitions with no single tool call to intercept. They are discipline-only
#     here: the orchestrator prose asks for a Decision Record, but THIS hook does
#     not and cannot block them. Do not claim otherwise.
#   - Detection is command-word based (see below). A transition performed through
#     a renamed wrapper this hook does not recognize, through a non-Bash tool, or
#     outside Claude Code is out of scope.
#   - The hook checks that a matching APPROVE record EXISTS and targets the
#     current action; it cannot judge whether the human's decision was wise. The
#     human remains the sole arbiter.
#
# GATE CLASSES (matched by command word, anchored — never by substring)
#   construction-to-merge:
#     - `git merge ...`
#     - `gh pr merge ...`
#     - `git push ...` whose branch/refspec argument targets a PROTECTED branch
#       (main, master, or release/* — matched on the actual ref arg, NOT any push).
#   to-operations:
#     - `git tag ...`
#     - `npm publish ...`
#     - `deploy` or `release` appearing as a COMMAND WORD: the first token of the
#       command/pipeline segment, an npm/pnpm/yarn run script, or a make target
#       (e.g. `npm run deploy`, `./deploy.sh`, `make release`, `pnpm run release`).
#       A bare substring inside an unrelated arg/path does NOT match
#       (`grep -r deploy ./docs`, `cat deploy-notes.md`, `git push origin
#       feature/x` all PASS THROUGH).
#   Anything else -> allow (exit 0, no decision).
#
# RECORD-MATCHING RULE (exact machine-field match, negation-safe)
#   A gated class is authorized only by a record under RECORDS_DIR whose machine
#   fields satisfy BOTH, by exact value (not substring, not regex-over-prose):
#     transition     == the matched gate class
#     chosen_option  == approve            (the canonical approval value)
#   JSON/YAML records are parsed structurally with jq; Markdown front-matter is
#   matched with an anchored `key: value` line (value must be exactly `approve`,
#   so "do not approve" / "request-changes" / "approve later" are rejected).
#
# FRESHNESS / ANTI-STALE RULE (documented, single concrete rule)
#   To stop a stale record from a finished unit from authorizing a NEW transition,
#   the matching record MUST reference the CURRENT TARGET of the action:
#     * construction-to-merge -> the record must name the branch being merged/
#       pushed (its `target` field, or any field/value, equals that branch).
#     * to-operations         -> the record must name the tag being created, or
#       (for deploy/release/publish, which have no single ref arg) carry a
#       `target` of `release` / `deploy` / `operations`.
#   A record that does not reference the current target does NOT authorize the
#   action. (Records advertise the target via a machine `target:` field; see the
#   decision-record template.)
#
# CONTRACT (Claude Code PreToolUse hook)
#   stdin : JSON with .tool_name and .tool_input.command
#   deny  : exit 0 + {"hookSpecificOutput":{...,"permissionDecision":"deny",...}}
#   allow : exit 0 with no decision (normal permission flow proceeds)
#   We never use exit 2: a non-transition command must flow normally, and a denied
#   transition needs the structured reason that exit-0 JSON carries.
#
# DEPENDENCY: jq is REQUIRED. If jq is absent the hook FAILS CLOSED (denies) — a
#   regex/grep JSON "parser" can be fooled into failing open, so we refuse to run
#   without jq rather than guess at the decoded command.

set -u

# --- Configuration (override via environment) -------------------------------

# Directory (relative to the project root) where approve Decision Records live.
RECORDS_DIR="${AIDLC_RECORDS_DIR:-.ai-dlc/records}"

# Protected branches for the construction-to-merge class. ERE, anchored per-arg.
PROTECTED_BRANCHES_ERE="${AIDLC_PROTECTED_BRANCHES:-^(main|master|release/.+)$}"

# Project root: Claude Code exports CLAUDE_PROJECT_DIR; fall back to cwd.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# --- Helpers ----------------------------------------------------------------

# Emit a deny decision (exit 0 with structured JSON) and exit.
deny() {
  local reason="$1"
  jq -n --arg r "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $r
    }
  }'
  exit 0
}

# --- jq is mandatory: fail closed if absent ---------------------------------

if ! command -v jq >/dev/null 2>&1; then
  # Cannot safely parse the command without jq, and a fail-open hook is worse
  # than useless. Deny with a clear remediation. (Hand-built JSON: this is the
  # only branch that runs without jq.)
  reason="AI-DLC arbiter gate requires jq, which is not installed. The gate fails CLOSED without it (a regex JSON parser can be tricked into bypassing the gate). Install jq, or disable the arbiter-gate hook in .claude/settings.json if you accept losing gate enforcement."
  esc="${reason//\\/\\\\}"
  esc="${esc//\"/\\\"}"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$esc"
  exit 0
fi

# --- Read + decode hook input -----------------------------------------------

input="$(cat)"
tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
command_str="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"

# Only gate the Bash tool; anything else flows normally.
if [ "$tool_name" != "Bash" ]; then
  exit 0
fi
if [ -z "$command_str" ]; then
  exit 0
fi

# --- Tokenize the command into words (whitespace + shell separators) --------
#
# Classification is word-level. We split the decoded command on shell separators
# (; | & newline) into segments, then each segment into whitespace words. This
# keeps `deploy`/`release` matching anchored to a command position rather than to
# any substring, and lets us inspect git/gh subcommands and their args precisely.

# Normalize separators to spaces but remember segment boundaries by replacing the
# operators with a sentinel newline, so the FIRST word of each segment is the
# command word.
segments="$(printf '%s' "$command_str" \
  | sed -E 's/(\|\||&&|[;|&])/\n/g')"

gate_class=""        # "" | construction-to-merge | to-operations
gate_target=""       # branch / tag / "release" — used by the freshness rule

# Read each pipeline/list segment.
while IFS= read -r segment; do
  # Trim leading whitespace and a leading "env VAR=val" / "sudo" prefix-noise is
  # out of scope; we read the first meaningful token as the command word.
  # shellcheck disable=SC2086
  set -- $segment
  [ "$#" -gt 0 ] || continue

  cmd_word="$1"
  base_cmd="${cmd_word##*/}"   # strip any path, e.g. ./deploy.sh -> deploy.sh

  # --- to-operations: deploy/release as a command word ----------------------
  case "$base_cmd" in
    deploy|deploy.sh|release|release.sh)
      gate_class="to-operations"; gate_target="release"; break ;;
  esac

  # --- git / gh subcommand analysis -----------------------------------------
  if [ "$base_cmd" = "git" ] && [ "$#" -ge 2 ]; then
    sub="$2"
    case "$sub" in
      merge)
        gate_class="construction-to-merge"
        # target: first non-flag arg after `merge`, else current-branch unknown.
        shift 2
        for a in "$@"; do
          case "$a" in -*) continue ;; *) gate_target="$a"; break ;; esac
        done
        break ;;
      tag)
        # Only a tag-CREATE gates. `git tag -l` / `git tag` (list) does not.
        shift 2
        is_create=0
        for a in "$@"; do
          case "$a" in
            -l|--list|-n*) is_create=0; break ;;
            -*) continue ;;
            *) is_create=1; gate_target="$a"; break ;;
          esac
        done
        if [ "$is_create" -eq 1 ]; then
          gate_class="to-operations"; break
        fi
        ;;
      push)
        # construction-to-merge ONLY if a refspec targets a protected branch.
        # Inspect the args after `push`: skip flags, skip the remote name, then
        # examine refspecs. A refspec `src:dst` targets dst; a bare `ref` targets
        # ref. We test the destination ref against PROTECTED_BRANCHES_ERE.
        shift 2
        seen_remote=0
        for a in "$@"; do
          case "$a" in
            -*) continue ;;            # flags (--force, -u, etc.)
            *)
              if [ "$seen_remote" -eq 0 ]; then
                seen_remote=1          # first positional is the remote
                continue
              fi
              # This is a refspec. Destination = part after a colon, else whole.
              dst="${a##*:}"
              dst="${dst#refs/heads/}"
              if printf '%s' "$dst" | grep -Eq "$PROTECTED_BRANCHES_ERE"; then
                gate_class="construction-to-merge"; gate_target="$dst"; break
              fi
              ;;
          esac
        done
        [ -n "$gate_class" ] && break
        ;;
    esac
  fi

  if [ "$base_cmd" = "gh" ] && [ "$#" -ge 3 ]; then
    if [ "$2" = "pr" ] && [ "$3" = "merge" ]; then
      gate_class="construction-to-merge"
      # gh pr merge target: a PR number/branch may follow; record it if present.
      shift 3
      for a in "$@"; do
        case "$a" in -*) continue ;; *) gate_target="$a"; break ;; esac
      done
      # gh pr merge has no explicit branch arg by default; fall back to the
      # protected-merge target marker so a release record can authorize it.
      [ -n "$gate_target" ] || gate_target="merge"
      break
    fi
  fi

  # --- npm/pnpm/yarn run scripts + npm publish ------------------------------
  case "$base_cmd" in
    npm|pnpm|yarn)
      if [ "$#" -ge 2 ] && [ "$2" = "publish" ]; then
        gate_class="to-operations"; gate_target="release"; break
      fi
      # `npm run deploy` / `pnpm run release` / `yarn deploy`.
      run_script=""
      if [ "$#" -ge 3 ] && [ "$2" = "run" ]; then
        run_script="$3"
      elif [ "$#" -ge 2 ]; then
        # yarn <script> shorthand (no "run"); npm requires "run", but accept the
        # shorthand defensively for yarn.
        case "$2" in deploy|release) run_script="$2" ;; esac
      fi
      case "$run_script" in
        deploy|release) gate_class="to-operations"; gate_target="release"; break ;;
      esac
      ;;
    make)
      # make deploy / make release (targets are positional, non-flag args).
      shift 1
      for a in "$@"; do
        case "$a" in
          -*) continue ;;
          deploy|release) gate_class="to-operations"; gate_target="release"; break ;;
          *) continue ;;
        esac
      done
      [ -n "$gate_class" ] && break
      ;;
  esac
done <<EOF
$segments
EOF

# Not a gated phase-transition command -> no opinion, proceed.
if [ -z "$gate_class" ]; then
  exit 0
fi

# --- Find a matching, fresh APPROVE Decision Record -------------------------

records_path="$PROJECT_DIR/$RECORDS_DIR"

# Does the freshness target match a record's advertised target?
# Rule: the record's `target` (or, for branch merges, any recorded branch value)
# must equal gate_target. For to-operations with gate_target="release"/"merge",
# accept a record target of release|deploy|operations|merge.
target_ok() {
  local rec_target="$1"
  [ -n "$rec_target" ] || return 1
  if [ "$rec_target" = "$gate_target" ]; then
    return 0
  fi
  case "$gate_target" in
    release|merge)
      case "$rec_target" in
        release|deploy|operations|merge) return 0 ;;
      esac
      ;;
  esac
  return 1
}

# Check one JSON/YAML record via jq. Echoes "match" on a transition+approve+target
# hit. We try JSON first; YAML front-matter we parse with the markdown path.
record_matches_json() {
  local file="$1"
  local trans opt rec_target
  trans="$(jq -r '.transition // empty' "$file" 2>/dev/null)" || return 1
  [ -n "$trans" ] || return 1
  opt="$(jq -r '.chosen_option // empty' "$file" 2>/dev/null)"
  rec_target="$(jq -r '.target // empty' "$file" 2>/dev/null)"
  [ "$trans" = "$gate_class" ] || return 1
  [ "$opt" = "approve" ] || return 1
  target_ok "$rec_target"
}

# Check one Markdown / YAML-frontmatter record with anchored line matching. The
# value after `key:` must be EXACTLY the expected token (optional surrounding
# quotes/backticks/whitespace), so negated/qualified values are rejected.
record_matches_text() {
  local file="$1"
  # Extract a single-token value for a key: anchored `key: value` line.
  field() {
    grep -E "^[[:space:]]*\`?$1\`?[[:space:]]*[:=][[:space:]]*" "$file" 2>/dev/null \
      | head -n1 \
      | sed -E "s/^[[:space:]]*\`?$1\`?[[:space:]]*[:=][[:space:]]*//; s/[[:space:]]+#.*$//" \
      | sed -E "s/^[\"'\`]//; s/[\"'\`][[:space:]]*$//; s/[[:space:]]+$//"
  }
  local trans opt rec_target
  trans="$(field transition)"
  opt="$(field chosen_option)"
  rec_target="$(field target)"
  [ "$trans" = "$gate_class" ] || return 1
  [ "$opt" = "approve" ] || return 1
  target_ok "$rec_target"
}

authorized=0
if [ -d "$records_path" ]; then
  while IFS= read -r -d '' f; do
    case "$f" in
      *.json)
        if record_matches_json "$f"; then authorized=1; break; fi
        # A .json that failed jq parse falls through to text matching.
        if record_matches_text "$f"; then authorized=1; break; fi
        ;;
      *)
        if record_matches_text "$f"; then authorized=1; break; fi
        ;;
    esac
  done < <(find "$records_path" -type f \
    \( -name '*.md' -o -name '*.markdown' -o -name '*.yaml' -o -name '*.yml' -o -name '*.json' \) \
    -print0 2>/dev/null)
fi

if [ "$authorized" -eq 1 ]; then
  exit 0
fi

# --- Deny: no matching, fresh APPROVE record for this transition ------------

deny "AI-DLC arbiter gate: this command is a '${gate_class}' phase transition (target: '${gate_target}'), but no matching approved Decision Record was found under '${RECORDS_DIR}/'. Required: a record with machine fields transition: ${gate_class}, chosen_option: approve, and target: ${gate_target} (the branch/tag being acted on, or release/deploy/operations for a deploy/release). Copy .ai-dlc/templates/artifacts/decision-record.md, set those fields, save it under '${RECORDS_DIR}/', then retry. A record for a different transition or a different target does not authorize this action."
