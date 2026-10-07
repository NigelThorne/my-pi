---
name: branch-driven-development
description: Execute an agreed plan using Pi conversation checkpoints to limit context growth.
disable-model-invocation: true
---

# Context-branch execution

Use only when the user selects this workflow. Conversation branching is not a Git branch, a worktree, a disk rollback, or an independent reviewer.

Before choosing it, check that Pi's context tools are available. Do not perform a destructive context experiment just to test availability. If the required operation is unavailable, report that and continue with ordinary execution if authorised.

## Workflow

1. Read the agreed plan, acceptance criteria, and current workspace state. Track tasks with Pi todo tools.
2. Use `context_tag` at meaningful milestones, not every small step.
3. Implement a bounded task, inspect its diff, and run the relevant checks.
4. When context reduction is useful, save a handoff with `write_artifact`. Include changed files, commit IDs if any, verification commands and results, remaining risks, unresolved requests, active worker handles, and the next task.
5. Use `context_checkout` with a detailed carryover message and a `backupTag`. It changes conversation history only. Re-read the actual disk state before continuing.
6. Apply the repository's proportional review policy. Read `requesting-code-review` when appropriate. Self-review in a new conversation branch does not satisfy an independent-review requirement.
7. Finish according to the repository's delivery policy, without automatically cleaning up worktrees.

Do not add per-task spec and quality reviewers or repeated broad reviews. Fix concrete blockers together and recheck only the affected findings and regressions. Record non-blocking suggestions as follow-up work.
