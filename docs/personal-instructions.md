# Personal Agent Instructions

## Git Workflow

### `git mm` (merge-master)

Use `git mm` to rebase the current feature branch onto the latest `main`. This is a smart rebase alias that:

1. Fetches the latest `origin/main`
2. Finds the squash-merge commit on `main` whose tree matches already-merged commits
3. Rebases only **new** commits onto that point, skipping commits that were already squash-merged

Use it after a PR is merged and you want to continue working on the same branch with new commits on top of the updated `main`.
