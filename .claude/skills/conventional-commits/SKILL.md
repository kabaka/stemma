---
name: conventional-commits
description: Write commit messages for your project following the Conventional Commits specification. Use when committing changes, writing a commit message, "how do I write this commit", squashing a PR, drafting a release, or reviewing commit-message format — covers the type/scope/description format, choosing a type, defining scopes for your own project, and breaking-change markers (! and BREAKING CHANGE footers) that drive Semantic Versioning. Loaded on-demand by the implementer and devops agents.
---

# Conventional Commits

Write commits in the
[Conventional Commits](https://www.conventionalcommits.org/) format so history is
readable and the release version can be **derived from commits** rather than
hand-picked. The type and any breaking-change marker are load-bearing — they
decide the SemVer bump (see *Versioning* below).

## Format

```text
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

## Types

| Type       | When to use                                                    |
| ---------- | -------------------------------------------------------------- |
| `feat`     | A new feature or user-facing capability                        |
| `fix`      | A bug fix                                                      |
| `docs`     | Documentation only                                            |
| `refactor` | Code change that neither fixes a bug nor adds a feature        |
| `perf`     | A change that improves performance                            |
| `test`     | Adding or correcting tests                                    |
| `build`    | Build system or external dependency changes                   |
| `ci`       | CI/CD configuration and pipeline changes                      |
| `chore`    | Maintenance, housekeeping, tooling that doesn't ship to users  |
| `revert`   | Reverts a previous commit                                     |

`feat` and `fix` are the two that move the version; reach for the more specific
type (`docs`, `test`, `ci`, …) when the change is confined to that area.

## Scopes — define them for your project

The **scope** is an optional noun in parentheses naming the area of the codebase a
change touches, e.g. `feat(auth):` or `fix(parser):`. There is no fixed list —
**you define the scopes that fit your project** and use them consistently. Good
scopes mirror your real structure:

- by module or package — `api`, `web`, `cli`, `db`, `worker`;
- by feature or domain — `auth`, `billing`, `search`, `checkout`;
- by surface — `ui`, `config`, `deps`, `docs`.

Pick a small, stable vocabulary, keep it consistent, and write it down (a
`CONTRIBUTING` note or commit template) so contributors and agents reuse the same
names. Omit the scope when a change is genuinely cross-cutting rather than
inventing a vague one.

## Rules

- **Description**: imperative mood ("add", not "added"/"adds"), lowercase, no
  trailing period. Keep it under ~72 characters.
- **Body** (optional): explain *what* and *why*, not *how*. Wrap at ~72 columns.
  Separate it from the subject with a blank line.
- **One logical change per commit.** A focused commit is easier to review, revert,
  and changelog.
- **Breaking changes**: append `!` after the type/scope (e.g. `feat(api)!:`) **and**
  add a `BREAKING CHANGE:` footer describing the break and how to migrate. A
  breaking change is anything that forces users to change how they call,
  configure, or depend on your project — a removed/renamed public API, a changed
  default, an incompatible config or schema.

## Examples

```text
feat(auth): add OAuth2 login flow

fix(parser): handle empty input without crashing

docs: document the configuration options in the README

refactor(api): extract request validation into middleware

test(checkout): cover the expired-coupon path

ci: run the test suite on pull requests

chore(deps): bump the http client to 2.4.1
```

Breaking-change example with its footer:

```text
feat(api)!: require an API key on all endpoints

BREAKING CHANGE: unauthenticated requests now return 401. Clients must send an
`Authorization: Bearer <key>` header. See the migration note in the README.
```

## Versioning — derived from commits

Conventional Commits map directly onto
[Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`):

- `fix:` / `perf:` → **patch** bump (`x.y.Z`).
- `feat:` → **minor** bump (`x.Y.0`).
- any commit with `!` or a `BREAKING CHANGE:` footer → **major** bump (`X.0.0`).
- `docs`, `test`, `chore`, `ci`, `build`, `refactor` (without `!`) → no release on
  their own.

This is why the type and breaking marker matter: a tool (or the `devops` agent)
can compute the next version and generate a changelog from history. Write the
commit correctly and the version follows automatically — don't hand-edit version
numbers when commits can derive them.
