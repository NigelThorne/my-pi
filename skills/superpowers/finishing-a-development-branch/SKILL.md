---
name: finishing-a-development-branch
description: Use when verified work is ready for delivery, or the user asks to merge, publish, preserve, or clean up a development branch.
---

# Finishing development work

Follow the repository's delivery policy and current user approval. Completion does not automatically authorise a push, PR, merge, restart, or cleanup.

## Verify and deliver

1. Inspect the actual diff, including staged and unstaged changes. Check acceptance criteria and run relevant tests, lint, build, and behaviour checks. Report any pre-existing failures separately.
2. Apply the proportional review policy through `requesting-code-review` when required. Blockers must be resolved; follow-ups do not hold delivery.
3. Determine the intended delivery from current instructions. Do not present a fixed menu when the outcome is already settled. If it is genuinely unresolved, ask one concrete question.
4. Before external or live mutations, report the exact action, target, validation, and recovery path and obtain current approval as required by applicable policy. Prepare local commits or PR drafts without treating them as permission to publish.
5. If an existing PR is known unsafe to merge, follow the applicable Draft safety rule. Do not claim it is ready while a blocker remains.
6. Report what is verified, committed locally, published, or blocked. Distinguish those states.

## Worktree and branch ownership

Preserve the worktree after opening a PR. A PR is not evidence that nobody still needs the workspace.

Remove a worktree only when cleanup is explicitly authorised and all of these checks pass:

- It is the exact worktree owned by this task, not another user's or worker's workspace.
- No active agent, dev stack, terminal task, or other process still relies on it. Stop owned processes only with the required approval; uncertainty means preserve it.
- Inspect tracked, untracked, and ignored files. Ignored work can still be valuable. A clean `git status` alone is insufficient.
- All unmerged commits are preserved in an agreed durable location. State what would be lost before any discard.
- Use the worktree tool or project lifecycle tool and its normal safety checks. No forced removal, automatic branch deletion, or broad cleanup.

A worktree removal does not delete its Git branch. Branch deletion is a separate action. Destructive discard requires explicit confirmation of the exact path, branch, commits, and local data being discarded.
