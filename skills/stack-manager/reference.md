# Stack Manager reference

Use the installed CLI's help and repository documentation for its current schema. These notes cover lifecycle behavior observed while running the Little wins example, not a license to bypass the tool's safety checks.

## A local Cloudflare stack

The [tested example config](https://github.com/NigelThorne/foldkit-demo/blob/b9ce57972e47f8378985c8818a2bf20d2111fef9/.stack-manager.config) gives each stack a Git worktree, dynamically allocated port, dependencies and local SQLite directory. Its startup script uses mise and the lockfile, then runs built frontend assets and Miniflare. It neither copies cloud credentials nor deploys infrastructure.

Check the configured command before treating any stack as local-only. Port allocation alone does not isolate data; give each instance its own persistence directory. A same-UUID session in another stack should not access the same database. New worktrees start from committed code, not the canonical checkout's uncommitted changes.

Dependency installation and builds count toward readiness time. Capture bounded startup diagnostics without environment dumps. Prefer cached packages when appropriate, but retain lockfile verification; do not blindly increase timeouts without identifying which startup step failed. In the observed CLI, a crashed stack must be stopped before `start` accepts it.

## Deletion is a reviewed plan

1. Confirm the exact stack and current user intent. Stop its owned processes before removing worktrees. Do not signal a process solely because it occupies a configured port.
2. Inspect tracked, untracked and ignored files. Identify local databases and other data that deletion would discard. Verify every branch commit is preserved where agreed. A clean tracked diff is not proof that the directory contains nothing valuable.
3. Run `stack-manager delete <stack> --json` to prepare a plan. It is a preview, not deletion approval. Inspect step targets, process identities, worktree paths, branch refs, warnings and recovery metadata.
4. Obtain approval for the exact destructive scope under the current workflow. Use `stack-manager delete-action <operation> --step <step-id> --decision approve --json` only for an approved step. `--all` approves all remaining displayed actions; use it only when each is understood and approved. Never extend it to newly discovered resources.
5. Read per-step statuses, including `failed` and `skipped`, and their errors. A top-level `completed` means the operation finished processing its decisions, not that every requested resource disappeared.
6. Verify the intended result independently: owned listeners closed, worktree absence, branch state and registration state. Removing a worktree and deleting its branch are separate actions. Preserve any branch not included in approval.

## Partial failure is not completion

During the trial, the tool's internal 10-second Git timeout interrupted removal of a large worktree. Some tracked files had already been deleted. The branch removal then failed because Git still registered the worktree, but stack registration removal succeeded. The operation nevertheless reported `completed` with two failed steps.

That is a tool defect to report, not a recipe for automatic forced deletion or raising timeouts everywhere. After a failure:

- Preserve the operation report and inspect actual files, Git worktree metadata, branch commits and process ownership. Do not assume a timeout means no change occurred or that the subprocess has definitely stopped.
- Do not retry against stale identities or automatically approve a new plan. Reconcile the partial result first. If targets or destructive scope change, obtain new approval.
- If registration is already gone, report leftover resources explicitly. Do not invent a replacement registration or directly edit the manager's stored state to make the operation look successful.
- Use the documented lifecycle or worktree tools for a reviewed recovery within the approved scope. Preserve unexpected changes and stop on uncertain ownership. Do not reset or restore files merely because a deletion attempt failed.
- Verify recovery independently. The original operation report can truthfully record failures even when a later, separately verified recovery removes the remaining resources.
