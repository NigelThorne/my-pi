/**
 * Git Worktree Extension (Multi-Repo)
 *
 * Makes working with git worktrees simple across one or more repos.
 * Auto-detects repos in the working directory and its immediate children.
 * When multiple repos are present, prompts for repo selection.
 *
 * Commands:
 *   /wt          - Interactive worktree manager (list, add, open, remove)
 *   /wt-add      - Create a new worktree + branch
 *   /wt-open     - Open pi in a worktree (new terminal)
 *   /wt-list     - List all worktrees (across all repos)
 *   /wt-remove   - Remove a worktree
 *   /wt-repos    - Manage tracked repositories
 *
 * Tools:
 *   worktree     - LLM-callable tool for worktree operations
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

interface WorktreeInfo {
  path: string;
  branch: string;
  commit: string;
  isBare: boolean;
  isMain: boolean;
}

interface RepoInfo {
  /** Absolute path to the repo root */
  root: string;
  /** Short display name (e.g. "frontend", "backend") */
  name: string;
}

interface RepoWorktrees {
  repo: RepoInfo;
  worktrees: WorktreeInfo[];
}

export default function gitWorktreeExtension(pi: ExtensionAPI) {
  // ── State ────────────────────────────────────────────────

  /** Manually added repo paths (persisted via appendEntry) */
  let extraRepoPaths: string[] = [];

  // ── Repo Discovery ───────────────────────────────────────

  async function isGitRepo(dir: string): Promise<boolean> {
    const { code } = await pi.exec("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"]);
    return code === 0;
  }

  async function getRepoRootAt(dir: string): Promise<string | null> {
    const { stdout, code } = await pi.exec("git", ["-C", dir, "rev-parse", "--show-toplevel"]);
    return code === 0 ? stdout.trim() : null;
  }

  /** Discover all repos: cwd itself, immediate child dirs, and manually added paths */
  async function discoverRepos(cwd: string): Promise<RepoInfo[]> {
    const seen = new Set<string>();
    const repos: RepoInfo[] = [];

    async function tryAdd(dir: string, name?: string) {
      const root = await getRepoRootAt(dir);
      if (root && !seen.has(root)) {
        seen.add(root);
        repos.push({ root, name: name ?? path.basename(root) });
      }
    }

    // Check cwd itself
    await tryAdd(cwd);

    // Check immediate children of cwd
    try {
      const entries = fs.readdirSync(cwd, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.includes("node_modules")) {
          await tryAdd(path.join(cwd, entry.name), entry.name);
        }
      }
    } catch {
      // ignore read errors
    }

    // Check manually added repos
    for (const p of extraRepoPaths) {
      await tryAdd(p);
    }

    return repos;
  }

  // ── Worktree Helpers ─────────────────────────────────────

  async function listWorktreesForRepo(repoRoot: string): Promise<WorktreeInfo[]> {
    const { stdout, code } = await pi.exec("git", ["-C", repoRoot, "worktree", "list", "--porcelain"]);
    if (code !== 0) return [];

    const worktrees: WorktreeInfo[] = [];
    let current: Partial<WorktreeInfo> = {};

    for (const line of stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        current.path = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        current.commit = line.slice("HEAD ".length).substring(0, 8);
      } else if (line.startsWith("branch ")) {
        current.branch = line.slice("branch ".length).replace("refs/heads/", "");
      } else if (line === "bare") {
        current.isBare = true;
      } else if (line === "") {
        if (current.path) {
          worktrees.push({
            path: current.path,
            branch: current.branch ?? "(detached)",
            commit: current.commit ?? "unknown",
            isBare: current.isBare ?? false,
            isMain: worktrees.length === 0,
          });
        }
        current = {};
      }
    }

    return worktrees;
  }

  async function listAllRepoWorktrees(cwd: string): Promise<RepoWorktrees[]> {
    const repos = await discoverRepos(cwd);
    const results: RepoWorktrees[] = [];
    for (const repo of repos) {
      const worktrees = await listWorktreesForRepo(repo.root);
      results.push({ repo, worktrees });
    }
    return results;
  }

  function defaultWorktreePath(repoRoot: string, branchName: string): string {
    const repoName = path.basename(repoRoot);
    const parentDir = path.dirname(repoRoot);
    const safeDir = branchName.replace(/\//g, "-");
    return path.join(parentDir, `${repoName}.worktrees`, safeDir);
  }

  /**
   * Symlinks common development files from the main repo into a new worktree.
   * Handles: node_modules, .env*, and config files like .firebaserc, firebase.json, etc.
   */
  async function symlinkCommonFiles(repoRoot: string, wtPath: string): Promise<string[]> {
    const linked: string[] = [];

    // Patterns to symlink (if they exist in the main repo)
    const exactFiles = [
      "node_modules",
      ".firebaserc",
      "firebase.json",
      ".secret.local",
    ];

    for (const name of exactFiles) {
      const source = path.join(repoRoot, name);
      const target = path.join(wtPath, name);
      if (fs.existsSync(source) && !fs.existsSync(target)) {
        try {
          fs.symlinkSync(source, target);
          linked.push(name);
        } catch {
          // ignore — may fail on some platforms or if target exists
        }
      }
    }

    // Symlink .env* files (glob pattern)
    try {
      const entries = fs.readdirSync(repoRoot);
      for (const entry of entries) {
        if (entry.startsWith(".env")) {
          const source = path.join(repoRoot, entry);
          const target = path.join(wtPath, entry);
          if (fs.statSync(source).isFile() && !fs.existsSync(target)) {
            try {
              fs.symlinkSync(source, target);
              linked.push(entry);
            } catch {
              // ignore
            }
          }
        }
      }
    } catch {
      // ignore read errors
    }

    return linked;
  }

  async function addWorktree(
    repoRoot: string,
    branchName: string,
    baseBranch?: string,
  ): Promise<{ success: boolean; path: string; linked?: string[]; error?: string }> {
    const wtPath = defaultWorktreePath(repoRoot, branchName);

    const { code: branchExists } = await pi.exec("git", [
      "-C", repoRoot,
      "show-ref", "--verify", "--quiet", `refs/heads/${branchName}`,
    ]);

    let args: string[];
    if (branchExists === 0) {
      args = ["worktree", "add", wtPath, branchName];
    } else {
      args = ["worktree", "add", "-b", branchName, wtPath];
      if (baseBranch) args.push(baseBranch);
    }

    const { stdout, stderr, code } = await pi.exec("git", ["-C", repoRoot, ...args]);
    if (code !== 0) {
      return { success: false, path: wtPath, error: stderr.trim() || stdout.trim() };
    }

    // Auto-symlink common dev files from the main repo
    const linked = await symlinkCommonFiles(repoRoot, wtPath);

    return { success: true, path: wtPath, linked };
  }

  async function removeWorktree(
    repoRoot: string,
    identifier: string,
    force: boolean = false,
  ): Promise<{ success: boolean; error?: string }> {
    const worktrees = await listWorktreesForRepo(repoRoot);
    const wt = worktrees.find(
      (w) => w.branch === identifier || w.path === identifier || w.path.endsWith(`/${identifier}`),
    );

    if (!wt) {
      return { success: false, error: `Worktree not found: ${identifier}` };
    }

    if (wt.isMain) {
      return { success: false, error: "Cannot remove the main worktree" };
    }

    const args = ["-C", repoRoot, "worktree", "remove", wt.path];
    if (force) args.push("--force");

    const { stderr, code } = await pi.exec("git", args);
    if (code !== 0) {
      return { success: false, error: stderr.trim() };
    }

    return { success: true };
  }

  async function openInTerminal(wtPath: string): Promise<{ success: boolean; error?: string }> {
    const platform = os.platform();

    if (platform === "darwin") {
      const script = `
        tell application "Terminal"
          activate
          do script "cd ${wtPath.replace(/"/g, '\\"')} && pi"
        end tell
      `;
      const { code, stderr } = await pi.exec("osascript", ["-e", script]);
      if (code !== 0) {
        return { success: false, error: stderr.trim() };
      }
      return { success: true };
    } else if (platform === "linux") {
      for (const term of [
        ["gnome-terminal", "--", "bash", "-c", `cd ${wtPath} && pi; exec bash`],
        ["xterm", "-e", `cd ${wtPath} && pi; exec bash`],
        ["konsole", "-e", "bash", "-c", `cd ${wtPath} && pi; exec bash`],
      ]) {
        const { code } = await pi.exec("which", [term[0]]);
        if (code === 0) {
          await pi.exec(term[0], term.slice(1));
          return { success: true };
        }
      }
      return {
        success: false,
        error: `No supported terminal found. Run manually:\n  cd ${wtPath} && pi`,
      };
    } else {
      return {
        success: false,
        error: `Unsupported platform: ${platform}. Run manually:\n  cd ${wtPath} && pi`,
      };
    }
  }

  // ── Formatting ───────────────────────────────────────────

  function formatWorktreeList(allRepoWorktrees: RepoWorktrees[], cwd: string): string {
    if (allRepoWorktrees.length === 0) return "No repositories found.";

    const lines: string[] = [];
    const multiRepo = allRepoWorktrees.length > 1;

    for (const { repo, worktrees } of allRepoWorktrees) {
      if (multiRepo) {
        lines.push(`📦 ${repo.name} (${repo.root})`);
      }

      if (worktrees.length === 0) {
        lines.push("  No worktrees found.");
      } else {
        for (const wt of worktrees) {
          const isCurrent = wt.path === cwd;
          const marker = isCurrent ? " ◀ (current)" : "";
          const tag = wt.isMain ? " [main]" : "";
          const indent = multiRepo ? "    " : "  ";
          lines.push(`${indent}${wt.branch}${tag}${marker}`);
          lines.push(`${indent}  ${wt.commit}  ${wt.path}`);
        }
      }

      if (multiRepo) lines.push("");
    }

    return lines.join("\n");
  }

  // ── Repo Selection Helper ────────────────────────────────

  /** If multiple repos, prompt user to pick one. If one, return it directly. */
  async function selectRepo(
    repos: RepoInfo[],
    ctx: { ui: { select: (title: string, items: string[]) => Promise<string | undefined> } },
    title: string = "Select repository",
  ): Promise<RepoInfo | undefined> {
    if (repos.length === 0) return undefined;
    if (repos.length === 1) return repos[0];

    const items = repos.map((r) => `${r.name} (${r.root})`);
    const selected = await ctx.ui.select(title, items);
    if (!selected) return undefined;

    return repos[items.indexOf(selected)];
  }

  // ── Status Widget ────────────────────────────────────────

  async function updateStatus(ctx: { ui: { setStatus: (id: string, text: string | undefined) => void }; cwd: string }) {
    const allRepoWt = await listAllRepoWorktrees(ctx.cwd);
    const totalWorktrees = allRepoWt.reduce((sum, r) => sum + r.worktrees.length, 0);
    const totalRepos = allRepoWt.length;

    if (totalRepos === 0) {
      ctx.ui.setStatus("git-wt", undefined);
      return;
    }

    if (totalWorktrees <= totalRepos) {
      // Each repo only has its main worktree — nothing interesting
      ctx.ui.setStatus("git-wt", undefined);
      return;
    }

    // Find current branch
    let currentBranch = "?";
    for (const { worktrees } of allRepoWt) {
      const current = worktrees.find((w) => w.path === ctx.cwd);
      if (current) {
        currentBranch = current.branch;
        break;
      }
    }

    const repoLabel = totalRepos > 1 ? ` across ${totalRepos} repos` : "";
    ctx.ui.setStatus("git-wt", `🌳 ${currentBranch} (${totalWorktrees} worktrees${repoLabel})`);
  }

  // ── State Persistence ────────────────────────────────────

  function persistRepos() {
    pi.appendEntry("git-wt-repos", { extraRepoPaths });
  }

  // ── Commands ─────────────────────────────────────────────

  pi.registerCommand("wt-repos", {
    description: "Manage tracked repositories for worktrees",
    handler: async (_args, ctx) => {
      const repos = await discoverRepos(ctx.cwd);

      const items = [
        "📋 List tracked repos",
        "➕ Add a repo path",
        ...(extraRepoPaths.length > 0 ? ["➖ Remove a manually added repo"] : []),
      ];

      const choice = await ctx.ui.select("Repository Management", items);
      if (!choice) return;

      if (choice.includes("List")) {
        if (repos.length === 0) {
          ctx.ui.notify("No repositories found. Use 'Add a repo path' to track one.", "info");
        } else {
          const lines = repos.map((r) => `  📦 ${r.name} — ${r.root}`);
          ctx.ui.notify(`Tracked repositories:\n${lines.join("\n")}`, "info");
        }
      } else if (choice.includes("Add")) {
        const repoPath = await ctx.ui.input("Repo path (absolute):", "");
        if (!repoPath) return;

        const resolved = path.resolve(repoPath);
        if (!(await isGitRepo(resolved))) {
          ctx.ui.notify(`❌ Not a git repository: ${resolved}`, "error");
          return;
        }

        const root = await getRepoRootAt(resolved);
        if (!root) {
          ctx.ui.notify(`❌ Could not determine repo root for: ${resolved}`, "error");
          return;
        }

        if (!extraRepoPaths.includes(root)) {
          extraRepoPaths.push(root);
          persistRepos();
        }

        ctx.ui.notify(`✅ Added repo: ${path.basename(root)} (${root})`, "info");
        await updateStatus(ctx);
      } else if (choice.includes("Remove")) {
        const items = extraRepoPaths.map((p) => `${path.basename(p)} (${p})`);
        const selected = await ctx.ui.select("Remove repo", items);
        if (!selected) return;

        const idx = items.indexOf(selected);
        const removed = extraRepoPaths.splice(idx, 1)[0];
        persistRepos();

        ctx.ui.notify(`✅ Removed repo: ${path.basename(removed)}`, "info");
        await updateStatus(ctx);
      }
    },
  });

  pi.registerCommand("wt", {
    description: "Interactive worktree manager",
    handler: async (_args, ctx) => {
      const repos = await discoverRepos(ctx.cwd);

      if (repos.length === 0) {
        ctx.ui.notify("No git repositories found. Use /wt-repos to add one.", "error");
        return;
      }

      const allRepoWt = await listAllRepoWorktrees(ctx.cwd);
      const totalWorktrees = allRepoWt.reduce((sum, r) => sum + r.worktrees.length, 0);
      const hasExtraWorktrees = totalWorktrees > repos.length;

      const items = [
        "📋 List worktrees",
        "➕ Add new worktree",
        ...(hasExtraWorktrees
          ? ["🚀 Open worktree in new terminal", "🗑️  Remove worktree"]
          : []),
        "📦 Manage repos",
      ];

      const choice = await ctx.ui.select("Git Worktrees", items);
      if (!choice) return;

      if (choice.includes("List")) {
        ctx.ui.notify(formatWorktreeList(allRepoWt, ctx.cwd), "info");
      } else if (choice.includes("Add")) {
        const repo = await selectRepo(repos, ctx, "Add worktree in which repo?");
        if (!repo) return;

        const branchName = await ctx.ui.input(`Branch name (in ${repo.name}):`, "feature/my-feature");
        if (!branchName) return;

        const baseBranch = await ctx.ui.input("Base branch (leave empty for HEAD):", "");
        const result = await addWorktree(repo.root, branchName, baseBranch || undefined);

        if (result.success) {
          const linkedInfo = result.linked?.length
            ? `\n   Symlinked: ${result.linked.join(", ")}`
            : "";
          ctx.ui.notify(`✅ Worktree created in ${repo.name} at ${result.path}${linkedInfo}`, "info");

          const openNow = await ctx.ui.confirm(
            "Open in new terminal?",
            `Open pi in ${result.path}?`,
          );
          if (openNow) {
            const openResult = await openInTerminal(result.path);
            if (!openResult.success) {
              ctx.ui.notify(openResult.error!, "error");
            }
          }
        } else {
          ctx.ui.notify(`❌ ${result.error}`, "error");
        }

        await updateStatus(ctx);
      } else if (choice.includes("Open")) {
        // Gather all non-current worktrees across repos
        const openable: { repo: RepoInfo; wt: WorktreeInfo }[] = [];
        for (const { repo, worktrees } of allRepoWt) {
          for (const wt of worktrees) {
            if (wt.path !== ctx.cwd) {
              openable.push({ repo, wt });
            }
          }
        }

        if (openable.length === 0) {
          ctx.ui.notify("No other worktrees to open.", "info");
          return;
        }

        const multiRepo = repos.length > 1;
        const wtItems = openable.map(({ repo, wt }) =>
          multiRepo
            ? `[${repo.name}] ${wt.branch} (${wt.path})`
            : `${wt.branch} (${wt.path})`,
        );
        const selected = await ctx.ui.select("Open worktree", wtItems);
        if (!selected) return;

        const selectedEntry = openable[wtItems.indexOf(selected)];
        const openResult = await openInTerminal(selectedEntry.wt.path);
        if (!openResult.success) {
          ctx.ui.notify(openResult.error!, "error");
        } else {
          ctx.ui.notify(`🚀 Opened pi in ${selectedEntry.wt.branch}`, "info");
        }
      } else if (choice.includes("Remove")) {
        // Gather all removable worktrees across repos
        const removable: { repo: RepoInfo; wt: WorktreeInfo }[] = [];
        for (const { repo, worktrees } of allRepoWt) {
          for (const wt of worktrees) {
            if (!wt.isMain) {
              removable.push({ repo, wt });
            }
          }
        }

        if (removable.length === 0) {
          ctx.ui.notify("No removable worktrees found.", "info");
          return;
        }

        const multiRepo = repos.length > 1;
        const wtItems = removable.map(({ repo, wt }) =>
          multiRepo
            ? `[${repo.name}] ${wt.branch} (${wt.path})`
            : `${wt.branch} (${wt.path})`,
        );
        const selected = await ctx.ui.select("Remove worktree", wtItems);
        if (!selected) return;

        const selectedEntry = removable[wtItems.indexOf(selected)];
        const ok = await ctx.ui.confirm(
          "Remove worktree?",
          `Remove ${selectedEntry.wt.branch} at ${selectedEntry.wt.path}?`,
        );
        if (!ok) return;

        const result = await removeWorktree(selectedEntry.repo.root, selectedEntry.wt.path);
        if (result.success) {
          ctx.ui.notify(`✅ Removed worktree for ${selectedEntry.wt.branch}`, "info");
        } else {
          ctx.ui.notify(`❌ ${result.error}`, "error");
        }

        await updateStatus(ctx);
      } else if (choice.includes("Manage repos")) {
        // Delegate to /wt-repos
        pi.sendUserMessage("/wt-repos", { deliverAs: "followUp" });
      }
    },
  });

  pi.registerCommand("wt-list", {
    description: "List all git worktrees across all repos",
    handler: async (_args, ctx) => {
      const allRepoWt = await listAllRepoWorktrees(ctx.cwd);
      if (allRepoWt.length === 0) {
        ctx.ui.notify("No git repositories found. Use /wt-repos to add one.", "error");
        return;
      }
      ctx.ui.notify(formatWorktreeList(allRepoWt, ctx.cwd), "info");
    },
  });

  pi.registerCommand("wt-add", {
    description: "Create a new worktree + branch (picks repo if multiple)",
    getArgumentCompletions: (_prefix) => null,
    handler: async (args, ctx) => {
      const repos = await discoverRepos(ctx.cwd);

      if (repos.length === 0) {
        ctx.ui.notify("No git repositories found. Use /wt-repos to add one.", "error");
        return;
      }

      // Parse args: [repo-name] branch-name [base-branch]
      const parts = args.trim().split(/\s+/).filter(Boolean);

      let repo: RepoInfo | undefined;
      let branchName: string | undefined;
      let baseBranch: string | undefined;

      if (parts.length >= 1 && repos.length > 1) {
        // Try to match first arg as a repo name
        const matchedRepo = repos.find((r) => r.name === parts[0]);
        if (matchedRepo) {
          repo = matchedRepo;
          branchName = parts[1];
          baseBranch = parts[2];
        } else {
          // First arg is the branch name; need to select repo interactively
          branchName = parts[0];
          baseBranch = parts[1];
        }
      } else if (parts.length >= 1) {
        branchName = parts[0];
        baseBranch = parts[1];
      }

      if (!repo) {
        repo = await selectRepo(repos, ctx, "Add worktree in which repo?");
        if (!repo) return;
      }

      if (!branchName) {
        branchName = (await ctx.ui.input(`Branch name (in ${repo.name}):`, "feature/my-feature")) ?? "";
        if (!branchName) return;
      }

      const result = await addWorktree(repo.root, branchName, baseBranch);

      if (result.success) {
        const linkedMsg = result.linked?.length
            ? `\n   Symlinked: ${result.linked.join(", ")}`
            : "";
        ctx.ui.notify(`✅ Worktree created in ${repo.name}: ${branchName}\n   ${result.path}${linkedMsg}`, "info");

        if (ctx.hasUI) {
          const openNow = await ctx.ui.confirm(
            "Open in new terminal?",
            `Open pi in ${result.path}?`,
          );
          if (openNow) {
            const openResult = await openInTerminal(result.path);
            if (!openResult.success) {
              ctx.ui.notify(openResult.error!, "error");
            }
          }
        }
      } else {
        ctx.ui.notify(`❌ ${result.error}`, "error");
      }

      await updateStatus(ctx);
    },
  });

  pi.registerCommand("wt-open", {
    description: "Open pi in a worktree (new terminal)",
    handler: async (args, ctx) => {
      const allRepoWt = await listAllRepoWorktrees(ctx.cwd);
      const repos = allRepoWt.map((r) => r.repo);

      // Gather all non-current worktrees
      const openable: { repo: RepoInfo; wt: WorktreeInfo }[] = [];
      for (const { repo, worktrees } of allRepoWt) {
        for (const wt of worktrees) {
          if (wt.path !== ctx.cwd) {
            openable.push({ repo, wt });
          }
        }
      }

      if (openable.length === 0) {
        ctx.ui.notify("No other worktrees. Use /wt-add to create one.", "info");
        return;
      }

      let selectedEntry: { repo: RepoInfo; wt: WorktreeInfo } | undefined;

      if (args.trim()) {
        selectedEntry = openable.find(
          ({ wt }) =>
            wt.branch === args.trim() ||
            wt.path.endsWith(`/${args.trim()}`),
        );
        if (!selectedEntry) {
          ctx.ui.notify(`Worktree not found: ${args.trim()}`, "error");
          return;
        }
      } else {
        const multiRepo = repos.length > 1;
        const items = openable.map(({ repo, wt }) =>
          multiRepo
            ? `[${repo.name}] ${wt.branch} (${wt.path})`
            : `${wt.branch} (${wt.path})`,
        );
        const selected = await ctx.ui.select("Open worktree in new terminal", items);
        if (!selected) return;
        selectedEntry = openable[items.indexOf(selected)];
      }

      const openResult = await openInTerminal(selectedEntry.wt.path);
      if (openResult.success) {
        ctx.ui.notify(`🚀 Opened pi in ${selectedEntry.wt.branch}`, "info");
      } else {
        ctx.ui.notify(openResult.error!, "error");
      }
    },
  });

  pi.registerCommand("wt-remove", {
    description: "Remove a git worktree",
    handler: async (args, ctx) => {
      const allRepoWt = await listAllRepoWorktrees(ctx.cwd);
      const repos = allRepoWt.map((r) => r.repo);

      // Gather all removable worktrees
      const removable: { repo: RepoInfo; wt: WorktreeInfo }[] = [];
      for (const { repo, worktrees } of allRepoWt) {
        for (const wt of worktrees) {
          if (!wt.isMain) {
            removable.push({ repo, wt });
          }
        }
      }

      if (removable.length === 0) {
        ctx.ui.notify("No removable worktrees found.", "info");
        return;
      }

      let selectedEntry: { repo: RepoInfo; wt: WorktreeInfo } | undefined;

      if (args.trim()) {
        selectedEntry = removable.find(
          ({ wt }) =>
            wt.branch === args.trim() ||
            wt.path.endsWith(`/${args.trim()}`),
        );
        if (!selectedEntry) {
          ctx.ui.notify(`Worktree not found: ${args.trim()}`, "error");
          return;
        }
      } else {
        const multiRepo = repos.length > 1;
        const items = removable.map(({ repo, wt }) =>
          multiRepo
            ? `[${repo.name}] ${wt.branch} (${wt.path})`
            : `${wt.branch} (${wt.path})`,
        );
        const selected = await ctx.ui.select("Remove worktree", items);
        if (!selected) return;
        selectedEntry = removable[items.indexOf(selected)];
      }

      const ok = await ctx.ui.confirm(
        "Remove worktree?",
        `Remove ${selectedEntry.wt.branch} at ${selectedEntry.wt.path}?\nThe branch will NOT be deleted.`,
      );
      if (!ok) return;

      const result = await removeWorktree(selectedEntry.repo.root, selectedEntry.wt.path);
      if (result.success) {
        ctx.ui.notify(`✅ Removed worktree for ${selectedEntry.wt.branch}`, "info");
      } else {
        ctx.ui.notify(`❌ ${result.error}`, "error");
      }

      await updateStatus(ctx);
    },
  });

  // ── LLM Tool ─────────────────────────────────────────────

  pi.registerTool({
    name: "worktree",
    label: "Git Worktree",
    description:
      "Manage git worktrees across one or more repositories. " +
      "Supports multi-repo workspaces (e.g. frontend + backend). " +
      "Use this to set up parallel workstreams.",
    promptSnippet: "Manage git worktrees (list, add, remove, open in new terminal) across multiple repos",
    promptGuidelines: [
      "Use the worktree tool when the user wants to work on multiple branches simultaneously.",
      "In multi-repo workspaces, specify the repo name to target a specific codebase.",
      "After creating a worktree, offer to open pi in the new worktree.",
      "When removing worktrees, the git branch is NOT deleted — only the working directory.",
    ],
    parameters: Type.Object({
      action: StringEnum(["list", "add", "remove"] as const),
      repo: Type.Optional(
        Type.String({
          description: "Repository name (e.g. 'frontend', 'backend'). Required when multiple repos exist.",
        }),
      ),
      branch: Type.Optional(
        Type.String({ description: "Branch name (for add/remove)" }),
      ),
      baseBranch: Type.Optional(
        Type.String({
          description: "Base branch for new worktree (for add, defaults to HEAD)",
        }),
      ),
      force: Type.Optional(
        Type.Boolean({ description: "Force remove even with changes" }),
      ),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const repos = await discoverRepos(ctx.cwd);

      if (repos.length === 0) {
        throw new Error("No git repositories found. Use /wt-repos to add one.");
      }

      switch (params.action) {
        case "list": {
          const allRepoWt = await listAllRepoWorktrees(ctx.cwd);
          const text = formatWorktreeList(allRepoWt, ctx.cwd);
          return {
            content: [{ type: "text", text }],
            details: { repos: allRepoWt },
          };
        }

        case "add": {
          if (!params.branch) {
            throw new Error("Branch name is required for 'add' action");
          }

          let repo: RepoInfo | undefined;
          if (repos.length === 1) {
            repo = repos[0];
          } else if (params.repo) {
            repo = repos.find(
              (r) => r.name.toLowerCase() === params.repo!.toLowerCase(),
            );
            if (!repo) {
              const available = repos.map((r) => r.name).join(", ");
              throw new Error(
                `Repository '${params.repo}' not found. Available repos: ${available}`,
              );
            }
          } else {
            const available = repos.map((r) => r.name).join(", ");
            throw new Error(
              `Multiple repos found. Specify 'repo' parameter. Available: ${available}`,
            );
          }

          const result = await addWorktree(repo.root, params.branch, params.baseBranch);
          if (!result.success) {
            throw new Error(result.error);
          }

          await updateStatus(ctx);

          return {
            content: [
              {
                type: "text",
                text: `Worktree created in ${repo.name} for branch '${params.branch}' at ${result.path}${result.linked?.length ? `\n\nAuto-symlinked from main repo: ${result.linked.join(", ")}` : ""}\n\nThe user can open pi in this worktree with /wt-open or by running:\n  cd ${result.path} && pi`,
              },
            ],
            details: { repo: repo.name, branch: params.branch, path: result.path },
          };
        }

        case "remove": {
          if (!params.branch) {
            throw new Error("Branch name is required for 'remove' action");
          }

          // Find the worktree across all repos
          let foundRepo: RepoInfo | undefined;
          let foundWt: WorktreeInfo | undefined;

          for (const { repo, worktrees } of await listAllRepoWorktrees(ctx.cwd)) {
            // If repo is specified, filter
            if (params.repo && repo.name.toLowerCase() !== params.repo.toLowerCase()) {
              continue;
            }

            const wt = worktrees.find(
              (w) =>
                w.branch === params.branch ||
                w.path === params.branch ||
                w.path.endsWith(`/${params.branch}`),
            );
            if (wt) {
              foundRepo = repo;
              foundWt = wt;
              break;
            }
          }

          if (!foundRepo || !foundWt) {
            throw new Error(`Worktree not found: ${params.branch}`);
          }

          const result = await removeWorktree(foundRepo.root, foundWt.path, params.force);
          if (!result.success) {
            throw new Error(result.error);
          }

          await updateStatus(ctx);

          return {
            content: [
              {
                type: "text",
                text: `Worktree for '${foundWt.branch}' removed from ${foundRepo.name}. The branch still exists and can be checked out normally.`,
              },
            ],
            details: { repo: foundRepo.name, branch: foundWt.branch },
          };
        }

        default:
          throw new Error(`Unknown action: ${params.action}`);
      }
    },
  });

  // ── Lifecycle ────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    // Restore persisted extra repo paths
    extraRepoPaths = [];
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === "git-wt-repos") {
        extraRepoPaths = (entry as any).data?.extraRepoPaths ?? [];
      }
    }

    await updateStatus(ctx);
  });
}
