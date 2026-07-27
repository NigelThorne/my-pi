---
name: using-git-worktrees
description: Use when starting feature work that needs isolation from current workspace or before executing implementation plans - creates isolated git worktrees with smart directory selection and safety verification
---

# Using Git Worktrees

## Overview

Git worktrees create isolated workspaces sharing the same repository, allowing work on multiple branches simultaneously without switching.

**Core principle:** Systematic directory selection + safety verification = reliable isolation.

**Announce at start:** "I'm using the using-git-worktrees skill to set up an isolated workspace."

## Directory Selection Process

Follow this priority order:

### 1. Check Existing Directories

```bash
# Check in priority order
ls -d .worktrees 2>/dev/null     # Preferred (hidden)
ls -d worktrees 2>/dev/null      # Alternative
```

**If found:** Use that directory. If both exist, `.worktrees` wins.

### 2. Check Project Instructions

Check repo/workspace instruction files for both worktree location and naming conventions:

```bash
grep -i "worktree.*director\|worktree.*location\|worktree.*naming\|worktree.*prefix" AGENTS.md CLAUDE.md 2>/dev/null
```

**If a preference is specified:** Use it without asking. Project instructions override the generic naming rules below.

### 3. Ask User

If no directory exists and no CLAUDE.md preference:

```
No worktree directory found. Where should I create worktrees?

1. .worktrees/ (project-local, hidden)
2. ~/.config/superpowers/worktrees/<project-name>/ (global location)

Which would you prefer?
```

## Safety Verification

### For Project-Local Directories (.worktrees or worktrees)

**MUST verify directory is ignored before creating worktree:**

```bash
# Check if directory is ignored (respects local, global, and system gitignore)
git check-ignore -q .worktrees 2>/dev/null || git check-ignore -q worktrees 2>/dev/null
```

**If NOT ignored:**

Per Jesse's rule "Fix broken things immediately":
1. Add appropriate line to .gitignore
2. Commit the change
3. Proceed with worktree creation

**Why critical:** Prevents accidentally committing worktree contents to repository.

### For Global Directory (~/.config/superpowers/worktrees)

No .gitignore verification needed - outside project entirely.

## Creation Steps

### 1. Detect Project Name and Slugs

Every worktree directory basename MUST include a project/repo slug prefix so editors and terminal tabs are recognizable.

```bash
project=$(basename "$(git rev-parse --show-toplevel)")
branch_slug=$(printf '%s' "$BRANCH_NAME" | tr '/[:upper:]' '-[:lower:]' | sed 's/[^a-z0-9._-]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//')
project_slug=$(printf '%s' "$project" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//')
worktree_dir="${project_slug}-${branch_slug}"
```

If project instructions define a shorter role slug, use that instead of the repository basename. Example: PatientNotes uses `web` for `patientnotes-web` and `firebase` for `patientnotes-firebase`, producing `web-nigel-pat-1843-fix-session` and `firebase-nigel-pat-1843-fix-session`.

### 2. Update Base Branch

Before creating a worktree from `main`/`master`, update the primary repo's base branch so local `main` stays current and the new worktree starts from the latest remote base.

```bash
base_branch="${BASE_BRANCH:-main}"
primary_repo=$(git worktree list --porcelain | awk -v b="$base_branch" 'BEGIN{p=""} /^worktree /{p=$2} $0=="branch refs/heads/" b {print p; exit}')
: "${primary_repo:=$(git rev-parse --show-toplevel)}"

git -C "$primary_repo" fetch origin "$base_branch"
git -C "$primary_repo" checkout "$base_branch"
git -C "$primary_repo" pull --ff-only origin "$base_branch"
```

If the base branch is not `main`/`master`, fetch/pull that branch instead. If the primary repo cannot switch because of uncommitted work, stop and resolve/report it before creating the worktree.

### 3. Create Worktree

```bash
# Determine full path
case $LOCATION in
  .worktrees|worktrees)
    path="$LOCATION/$worktree_dir"
    ;;
  ~/.config/superpowers/worktrees/*)
    path="~/.config/superpowers/worktrees/$project/$worktree_dir"
    ;;
esac

# Create worktree with new branch from updated base
git worktree add "$path" -b "$BRANCH_NAME" "$base_branch"
cd "$path"
```

### 4. Hydrate Local-Only Shared Files

Git does not copy ignored local files into new worktrees. Before running setup, hydrate common local-only entries from the primary repo/root worktree.

**For Node.js repos:** Prefer symlinking `node_modules` from the primary repo if it exists. Only install if no reusable `node_modules` exists.

```bash
primary_repo=$(git worktree list --porcelain | awk 'BEGIN{p=""} /^worktree /{p=$2} /^branch refs\/heads\/(main|master)$/{print p; exit}')
: "${primary_repo:=$(git rev-parse --show-toplevel)}"

if [ -d "$primary_repo/node_modules" ] && [ ! -e node_modules ]; then
  ln -s "$primary_repo/node_modules" node_modules
fi
```

**For env files:** Copy root repo `.env*` files into the worktree when missing, excluding examples/templates. Do not overwrite existing worktree-specific files.

```bash
find "$primary_repo" -maxdepth 1 -type f -name '.env*' \
  ! -iname '.env.example' ! -iname '.env.sample' ! -iname '.env.template' \
  -print0 | while IFS= read -r -d '' env_file; do
    name=$(basename "$env_file")
    [ -e "$name" ] || cp -p "$env_file" "$name"
  done
```

**PatientNotes exception:** If using `/Users/nigelthorne/code/patientnotes/patientnotes-dev-manager`, `discover`, `create`, `up`, and `start` also ensure shared entries for PatientNotes worktrees: `node_modules` and non-local `.env*` files are symlinked, while `.env.local` is copied when missing so new stacks inherit local settings without editing the root file. Still hydrate immediately after creating the worktree if the worker needs tests/lint/dev commands before a stack is started.

### 5. Run Project Setup

Auto-detect and run appropriate setup. For Node.js, do not run an install if `node_modules` was successfully symlinked.

```bash
# Node.js
if [ -f package.json ] && [ ! -e node_modules ]; then npm install; fi

# Rust
if [ -f Cargo.toml ]; then cargo build; fi

# Python
if [ -f requirements.txt ]; then pip install -r requirements.txt; fi
if [ -f pyproject.toml ]; then poetry install; fi

# Go
if [ -f go.mod ]; then go mod download; fi
```

### 6. Verify Worktree Hydration

Check local-only shared entries before tests:

```bash
[ ! -d "$primary_repo/node_modules" ] || [ -L node_modules ] || [ -d node_modules ]
find "$primary_repo" -maxdepth 1 -type f -name '.env*' \
  ! -iname '.env.example' ! -iname '.env.sample' ! -iname '.env.template' \
  -exec basename {} \; | while read -r name; do [ -e "$name" ] || echo "Missing $name"; done
```

If expected env files or `node_modules` are missing, fix the hydration before proceeding.

### 7. Verify Clean Baseline

Run tests to ensure worktree starts clean:

```bash
# Examples - use project-appropriate command
npm test
cargo test
pytest
go test ./...
```

**If tests fail:** Report failures, ask whether to proceed or investigate.

**If tests pass:** Report ready.

### 5. Report Location

```
Worktree ready at <full-path>
Tests passing (<N> tests, 0 failures)
Ready to implement <feature-name>
```

## Quick Reference

| Situation | Action |
|-----------|--------|
| `.worktrees/` exists | Use it (verify ignored) |
| `worktrees/` exists | Use it (verify ignored) |
| Both exist | Use `.worktrees/` |
| Neither exists | Check AGENTS.md/CLAUDE.md → Ask user |
| Project/role prefix specified | Use it in worktree directory basename |
| No prefix specified | Prefix directory basename with sanitized repo/project slug |
| Directory not ignored | Add to .gitignore + commit |
| Creating from `main`/`master` | Fetch + `pull --ff-only` primary repo base branch first |
| Primary repo has dirty work blocking base checkout | Stop and resolve/report before creating worktree |
| Tests fail during baseline | Report failures + ask |
| Root repo has `.env*` files | Copy them into the worktree when missing, excluding examples/templates |
| Root repo has `node_modules` | Symlink it into Node.js worktrees before installing |
| No package.json/Cargo.toml | Skip dependency install |

## Common Mistakes

### Skipping ignore verification

- **Problem:** Worktree contents get tracked, pollute git status
- **Fix:** Always use `git check-ignore` before creating project-local worktree

### Assuming directory location

- **Problem:** Creates inconsistency, violates project conventions
- **Fix:** Follow priority: existing > AGENTS.md/CLAUDE.md > ask

### Omitting project/role slug prefix

- **Problem:** Worktrees named only after branches are ambiguous in editors, terminals, and multi-repo workspaces
- **Fix:** Name the worktree directory `<project-slug>-<branch-slug>` unless project instructions specify a role slug such as `web-` or `firebase-`

### Creating from a stale base branch

- **Problem:** New worktree starts behind remote `main`, causing avoidable conflicts or missing fixes
- **Fix:** Fetch and `pull --ff-only` the primary repo's base branch before `git worktree add`

### Proceeding with failing tests

- **Problem:** Can't distinguish new bugs from pre-existing issues
- **Fix:** Report failures, get explicit permission to proceed

### Hardcoding setup commands

- **Problem:** Breaks on projects using different tools
- **Fix:** Auto-detect from project files (package.json, etc.)

### Forgetting ignored local files

- **Problem:** New worktree lacks `.env*` files or wastes time reinstalling dependencies
- **Fix:** Copy root `.env*` files when missing and symlink root `node_modules` before setup

## Example Workflow

```
You: I'm using the using-git-worktrees skill to set up an isolated workspace.

[Check .worktrees/ - exists]
[Verify ignored - git check-ignore confirms .worktrees/ is ignored]
[Update primary repo main: git fetch && git pull --ff-only]
[Create worktree: git worktree add .worktrees/auth -b feature/auth main]
[Copy missing root .env* files, excluding examples/templates]
[Symlink root node_modules if present; otherwise run npm install]
[Run npm test - 47 passing]

Worktree ready at /Users/jesse/myproject/.worktrees/auth
Tests passing (47 tests, 0 failures)
Ready to implement auth feature
```

## Red Flags

**Never:**
- Create worktree without verifying it's ignored (project-local)
- Create a worktree directory basename without a project/role slug prefix
- Create a worktree from `main`/`master` without updating the primary repo base branch first
- Skip `.env*` hydration and `node_modules` symlink/setup
- Skip baseline test verification
- Proceed with failing tests without asking
- Assume directory location when ambiguous
- Skip AGENTS.md/CLAUDE.md checks

**Always:**
- Follow directory priority: existing > AGENTS.md/CLAUDE.md > ask
- Verify directory is ignored for project-local
- Fetch and `pull --ff-only` the primary repo base branch before creating a new worktree
- Prefix the worktree directory basename with the project slug, or with the role slug from project instructions
- Copy missing root `.env*` files and symlink root `node_modules` when available
- Auto-detect and run project setup
- Verify clean test baseline

## Integration

**Called by:**
- **brainstorming** (Phase 4) - REQUIRED when design is approved and implementation follows
- **subagent-driven-development** - REQUIRED before executing any tasks
- **branch-driven-development** - REQUIRED before executing any tasks
- **executing-plans** - REQUIRED before executing any tasks
- Any skill needing isolated workspace

**Pairs with:**
- **finishing-a-development-branch** - REQUIRED for cleanup after work complete
