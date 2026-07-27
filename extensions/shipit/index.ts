import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("shipit", {
    description:
      "Ship the current changes: branch, rebase, lint-fix, push, and raise a PR",
    handler: async (args, ctx) => {
      // Gather context about what we're shipping
      const branchHint = args?.trim() || "";

      const prompt = `
You are shipping the current changes as a pull request. Follow these steps carefully, stopping if any step fails unexpectedly.

## 1. Create/switch to a feature branch

The branch name should follow the pattern: \`PAT-XXXX__short-goal-description\` (double underscore separator, kebab-case description).
${branchHint ? `Use this hint for the branch name: "${branchHint}"` : "Look at the recent commits, changes, and Linear (via linear-cli) to determine the appropriate PAT-XXXX ticket ID and a short description of the goal."}

If we're already on a feature branch (not main/master), confirm the branch name is appropriate and continue.
Otherwise, create a new branch from the current HEAD and commit all staged/unstaged changes.

Make sure all changes are committed before proceeding.

## 2. Smart rebase and push

Run:
\`\`\`bash
git mm
\`\`\`
This is a smart rebase command (it handles squash-merged branches by finding the common tree SHA and rebasing onto that).

If the rebase fails, try to resolve conflicts. If unresolvable, abort and notify me.

Then force-push:
\`\`\`bash
git push --force-with-lease
\`\`\`

If the remote branch doesn't exist yet, push with:
\`\`\`bash
git push --set-upstream origin HEAD --force-with-lease
\`\`\`

## 3. Merge latest main

\`\`\`bash
git fetch origin main
git merge origin/main
\`\`\`

If there are merge conflicts, resolve them, commit, and push again.

## 4. Lint and fix

Run:
\`\`\`bash
npm run lint
\`\`\`

If there are lint errors:
- Fix them
- Commit the fixes with message "fix: lint errors"
- Push again with \`git push --force-with-lease\`

Repeat until lint passes cleanly.

## 5. Raise the PR

Use \`gh\` CLI to create a pull request. Include:
- A clear title summarizing the change
- A description body that explains what changed and why, based on the commits in this branch

\`\`\`bash
gh pr create --fill --base main
\`\`\`

If a PR already exists for this branch, update it instead or just report the existing PR URL.

At the end, report the PR URL.
`;

      pi.sendUserMessage(prompt, { deliverAs: "followUp" });
      ctx.ui.notify("🚢 shipit — preparing your PR...", "info");
    },
  });
}
