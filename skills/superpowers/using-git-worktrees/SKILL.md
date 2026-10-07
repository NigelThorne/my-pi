---
name: using-git-worktrees
description: Use when a task needs an isolated Git workspace or the user requests parallel branches.
---

# Using Git worktrees safely

Follow the repository's workflow first. A trunk-based repository may require work on main. A plan or design approval alone does not require a worktree.

## Establish ownership and base

1. Inspect repository instructions, Git status, and existing worktrees. Identify the correct repository in a multi-repo workspace.
2. Reuse an existing task-owned worktree when appropriate. Do not take over another user's or agent's workspace.
3. Choose the intended base explicitly. An integration branch may be correct; do not silently substitute main. Fetch the intended remote ref when needed and permitted, then resolve its commit. If unavailable, report the limitation rather than treating a stale ref as current.
4. Leave the primary workspace and its checked-out branch untouched. Creating isolation must not switch, pull into, reset, or stash the user's primary tree.
5. Use the `worktree` tool for creation, specifying repository and base. Follow project naming conventions; otherwise use a project or role prefix so the path is recognisable. Offer to open Pi in the new worktree, rather than launching another session without agreement.

For project-local worktrees, check that the exact chosen directory is ignored. Checking a different candidate directory is not sufficient. If it is not ignored, choose an external location or make a scoped ignore change under the repository's normal policy. Do not create a surprise commit just to prepare a workspace.

## Dependencies and local configuration

Use the project's supported setup or stack tool before inventing shell recipes.

- For PatientNotes, read `patientnotes-stack-manager` and use the installed `stack-manager` with the workspace configuration.
- For other configured workspaces, read `stack-manager`; let its dependency and `envFiles` declarations control setup.
- Otherwise inspect the declared package manager, toolchain, and lockfile. Install dependencies in the new workspace using the project's reproducible install command.
- Do not share a writable `node_modules` directory by default. Reuse requires an explicit project-supported strategy that checks runtime, lockfile, generated outputs, and mutation safety.
- Do not copy or symlink root `.env*` files wholesale. Identify only the local configuration needed for this task and its approved source. Confirm target endpoints are local or otherwise authorised before running commands.
- Follow the project's secret store policy. Do not expose credential values in tool output, command arguments, or artifacts. Preserve any existing worktree-specific configuration.

## Verify and hand off

Run the appropriate baseline checks before implementation. Report pre-existing failures and their impact; do not quietly broaden the task to fix them or describe an unverified workspace as ready. Ask if they make safe continuation uncertain.

Report the exact path, branch, base commit, checks actually run, and outstanding setup gaps. For running stacks, use a fresh health check before claiming readiness.

For cleanup, read `finishing-a-development-branch`. Preserve active workspaces, ignored and untracked work, and unmerged commits. Never force cleanup to make a task look finished.
