import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export default function (pi: ExtensionAPI) {
  const retroDir = path.join(os.homedir(), ".pi", "agent", "retro");
  const sessionViewScript = path.join(__dirname, "pi-session-view.mjs");

  pi.registerCommand("session-view", {
    description: "Pretty-print a pi session by id or path. Flags: --tree --color",
    handler: async (args, ctx) => {
      const parsedArgs = args?.trim() ? args.trim().split(/\s+/) : [];
      if (parsedArgs.length === 0) {
        ctx.ui.notify("Usage: /session-view <id-or-path> [--tree] [--color]", "warning");
        return;
      }

      if (!fs.existsSync(sessionViewScript)) {
        ctx.ui.notify(`Missing script: ${sessionViewScript}`, "error");
        return;
      }

      ctx.ui.setStatus("session-view", "Rendering session...");
      const result = await pi.exec("node", [sessionViewScript, ...parsedArgs], { timeout: 60_000 });
      ctx.ui.setStatus("session-view", undefined);

      if (result.code !== 0) {
        const message = [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "session-view failed";
        ctx.ui.notify(message, "error");
        return;
      }

      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trimEnd();
      ctx.ui.setWidget("session-view", output.split(/\r?\n/));
      ctx.ui.notify("Session view rendered in widget", "info");
    },
  });

  pi.registerCommand("retro", {
    description: "Run a session retrospective — reflect on time/money spent and suggest improvements",
    handler: async (_args, ctx) => {
      // Ensure the retro directory exists
      if (!fs.existsSync(retroDir)) {
        fs.mkdirSync(retroDir, { recursive: true });
      }

      const missingToolsPath = path.join(retroDir, "missing-tools.md");
      const today = new Date().toISOString().split("T")[0];

      const prompt = `Please reflect on our current session and answer these questions:

1. **Where did we lose time or waste money in this session?**
   Think about false starts, misunderstandings, unnecessary iterations, overly verbose responses, or tasks that could have been done more efficiently.

2. **Update AGENTS.md with lessons learned from this session.**

   First, find all AGENTS.md files in the project:
   \`\`\`bash
   # Find project root and all AGENTS.md files
   git rev-parse --show-toplevel 2>/dev/null && find "$(git rev-parse --show-toplevel)" -name AGENTS.md -not -path "*/node_modules/*" -not -path "*/.git/*"
   \`\`\`

   Then read the existing AGENTS.md files to understand what's already documented.

   Now think about what you learned in this session that **isn't obvious from reading the code** — things like:
   - Gotchas, footguns, or surprising behaviour that tripped us up
   - Implicit conventions or patterns that aren't enforced by tooling
   - Architectural boundaries or rules (e.g. "module X never calls module Y directly")
   - Environment/deployment quirks (auth, config files, deploy steps)
   - Common tasks and the non-obvious steps to do them correctly
   - Test commands with the right flags (e.g. \`--no-start\` to avoid port conflicts)
   - Which files to update together (e.g. "if you change X, also update Y")

   **What makes AGENTS.md high-value (and what to avoid):**
   - ✅ Things an agent would waste tokens discovering by trial and error
   - ✅ Things that cause silent bugs if you don't know them (wrong auth source, stale env vars, etc.)
   - ✅ Relationships between components that aren't expressed in imports/deps
   - ✅ "Don't do X, do Y instead" — anti-patterns specific to this codebase
   - ✅ Concise — every line should save future token spend or prevent mistakes
   - ❌ Don't repeat what's obvious from file names, directory structure, or type signatures
   - ❌ Don't add generic best practices — only project-specific knowledge
   - ❌ Don't document things that are already in README, DESIGN.md, or code comments
   - ❌ Don't pad with filler — if there's nothing to add, say so

   **Where to write:**
   - If the lesson is about a specific subdirectory that has its own AGENTS.md, update that file
   - If it's project-wide, update the root AGENTS.md (create it if missing)
   - If it's cross-project (applies to all your work), update \`~/.pi/agent/AGENTS.md\`
   - **Append to the appropriate section** — don't restructure existing content
   - If adding a new section, place it logically near related content

   Use the \`edit\` tool to surgically add your suggestions to the right AGENTS.md file(s).
   Show me what you're adding before you write it, so I can approve or adjust.

3. **What tools or extensions are we missing that would have saved time or money?**
   Think about repetitive manual steps, lookups we had to do the hard way, or capabilities that would have made this session smoother.

For question 3, use \`${missingToolsPath}\` in **two steps**:

**Step A — Add new ideas from this session**
Append any genuinely new tool/extension suggestions under a date header like:

\`\`\`
## ${today}
\`\`\`

For each new suggestion, include a brief description of what it would do and why it would help.
If the tool already exists elsewhere in the file, do **not** duplicate it.

**Step B — Review the entire missing-tools file and add votes**
After adding new ideas, read **all existing entries** in \`${missingToolsPath}\` and add votes to any tool you think would have helped in **this specific session**.

Voting rules:
- Use the existing `(+N)` style already present in the file
- If a tool already has votes, increment the count
- If a tool has no vote count yet, add `(+1)`
- Vote for every existing tool that plausibly would have saved time, tokens, or money in this session — not just the new ones you added today
- Do not change descriptions unless needed for a tiny clarification
- Do not duplicate entries

The goal is that, over time, vote totals reveal which missing tools would have been most valuable across many sessions.

For question 1, just output your answer as text.
For question 2, follow the instructions above to propose and write AGENTS.md changes.
For question 3, update the missing-tools file with both new ideas and votes as described.`;

      pi.sendUserMessage(prompt, { deliverAs: "followUp" });
      ctx.ui.notify("Retro prompt sent — the LLM will now reflect on this session.", "info");
    },
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.notify("Run /retro before ending your session!", "warning");
  });
}
