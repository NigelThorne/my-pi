---
name: executing-plans
description: Execute an existing plan with checkpoints at real decisions or blockers.
disable-model-invocation: true
---

# Executing plans

Use this workflow when the user explicitly selects it. Follow current repository policy, including trunk-based development where required.

1. Read the plan and inspect the current workspace. Confirm that its assumptions still hold. Resolve material gaps before editing.
2. Track tasks with Pi todo tools. Work in dependency order, preserving unrelated changes.
3. Run the focused verification for each meaningful change. Record results in a session artifact when a handoff needs them.
4. Continue through approved tasks while no decision or blocker requires the user. Report useful milestones without imposing fixed-size batch pauses. Honour checkpoints the user explicitly requested.
5. Inspect the complete diff and run relevant final checks. Apply the `requesting-code-review` skill when the risk warrants it.
6. Follow the repository's delivery policy and current external-change approval requirements. Preserve the workspace unless cleanup is authorised and safe.

Use a worktree only for actual isolation needs and when permitted. Delegate only when the benefit exceeds coordination cost.

Stop for an unresolved requirement, missing permission, unsafe workspace state, or evidence that the plan is wrong. Explain what is blocked and the decision needed. Do not end a turn claiming execution will continue without an active executor.
