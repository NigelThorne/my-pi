---
description: Verify completed PatientNotes work is merged, then remove its worktrees/branches and complete the Linear issue
argument-hint: "[PAT-123]"
---
Perform a **safe post-merge cleanup** for `${1:-the current PatientNotes work item}`.

1. Read the workspace and relevant repo `AGENTS.md` files. Identify the Linear issue and all associated PRs, branches, and worktrees. If no issue is supplied, infer it from the active branch/PR/conversation; stop and ask only if it remains ambiguous.
2. Before deleting anything, verify every associated PR is merged with GitHub (`gh pr view`), and fetch `origin/main` in each affected repo. If any PR is open, draft, unmerged, or has an unresolved follow-up, **do not clean it up**; report the blocker.
3. Inspect every candidate worktree with `git status --short`. Do not discard uncommitted source changes. Agent-generated artifacts such as `.mycelium/` may be removed. If meaningful uncommitted work exists, preserve it and report it rather than force-removing the worktree.
4. Remove only worktrees related to this issue using `git worktree remove`; then delete their local branches and their matching remote branches. Tolerate branches GitHub already auto-deleted after merging. Never delete unrelated worktrees or branches.
5. Run `git worktree prune`, prune stale remote refs, and update each affected main checkout with a fast-forward-only pull. Verify no issue-related worktrees or local/remote branches remain, and that the retained main checkouts are clean.
6. Only after merge and cleanup verification, update the Linear issue with `linear-axi update <PAT-ID> --status '🧪 Code Complete: Testing'`, then re-read it to confirm the state. Do not change Linear if merge verification failed.

Report: merged PRs verified, worktrees/branches removed, anything intentionally retained, final main-checkout cleanliness, and confirmed Linear status. Keep the response concise.
