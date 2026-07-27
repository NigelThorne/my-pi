import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as path from "node:path";

interface ProjectDetection {
  type: string;
  command: string;
  args: string[];
}

const detectors: Array<{
  file: string;
  check?: (cwd: string) => boolean;
  type: string;
  command: string;
  args: string[];
}> = [
  { file: "mix.exs", type: "Elixir", command: "mix", args: ["test", "--no-start"] },
  { file: "package.json", type: "Node.js", command: "npm", args: ["test"] },
  { file: "Cargo.toml", type: "Rust", command: "cargo", args: ["test"] },
  { file: "go.mod", type: "Go", command: "go", args: ["test", "./..."] },
  {
    file: "Makefile",
    check: (cwd) => {
      try {
        const content = fs.readFileSync(path.join(cwd, "Makefile"), "utf-8");
        return /^test\s*:/m.test(content);
      } catch {
        return false;
      }
    },
    type: "Make",
    command: "make",
    args: ["test"],
  },
  { file: "pyproject.toml", type: "Python", command: "pytest", args: [] },
  { file: "setup.py", type: "Python", command: "pytest", args: [] },
];

function detectProject(cwd: string): ProjectDetection | null {
  for (const detector of detectors) {
    const filePath = path.join(cwd, detector.file);
    if (fs.existsSync(filePath)) {
      if (detector.check && !detector.check(cwd)) continue;
      return { type: detector.type, command: detector.command, args: detector.args };
    }
  }
  return null;
}

export default function (pi: ExtensionAPI) {
  let project: ProjectDetection | null = null;

  pi.on("session_start", async (_event, ctx) => {
    project = detectProject(ctx.cwd);
    if (project) {
      ctx.ui.notify(`Detected ${project.type} project — /test ready`, "info");
    } else {
      ctx.ui.notify("Could not auto-detect test command. Use /test after configuring.", "warning");
    }
  });

  async function runTests(extraArgs: string | undefined, signal?: AbortSignal) {
    if (!project) {
      return { success: false, output: "No project detected. Could not determine test command." };
    }

    const args = [...project.args];
    if (extraArgs?.trim()) {
      args.push(...extraArgs.trim().split(/\s+/));
    }

    const result = await pi.exec(project.command, args, { signal, timeout: 300_000 });
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    const success = result.code === 0;

    return { success, output, code: result.code };
  }

  pi.registerCommand("test", {
    description: "Run project tests (auto-detected). Pass extra args: /test --only my_test",
    handler: async (args, ctx) => {
      if (!project) {
        const input = await ctx.ui.input(
          "Test command not detected. Enter test command (e.g. 'mix test --no-start'):"
        );
        if (!input) {
          ctx.ui.notify("No test command configured.", "error");
          return;
        }
        const parts = input.trim().split(/\s+/);
        project = { type: "custom", command: parts[0], args: parts.slice(1) };
        ctx.ui.notify(`Test command set to: ${input}`, "info");
      }

      const cmdDisplay = `${project.command} ${project.args.join(" ")}${args ? " " + args : ""}`;
      ctx.ui.setStatus("quick-test", `Running: ${cmdDisplay}`);

      const result = await runTests(args);

      ctx.ui.setStatus("quick-test", undefined);

      if (result.success) {
        ctx.ui.notify(`✅ Tests passed: ${cmdDisplay}`, "info");
      } else {
        ctx.ui.notify(`❌ Tests failed (exit ${result.code}): ${cmdDisplay}`, "error");
      }
    },
  });

  pi.registerTool({
    name: "run_tests",
    label: "Run Tests",
    description:
      "Run the project's test suite. Auto-detects the test framework (Elixir, Node.js, Rust, Go, Python, Make). Returns test output with pass/fail status.",
    parameters: Type.Object({
      args: Type.Optional(
        Type.String({ description: "Extra arguments to append to the test command" })
      ),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (!project) {
        return {
          content: [
            {
              type: "text",
              text: "No test command detected. Ask the user what test command to use.",
            },
          ],
          details: { success: false },
        };
      }

      const cmdDisplay = `${project.command} ${project.args.join(" ")}${params.args ? " " + params.args : ""}`;

      onUpdate?.({
        content: [{ type: "text", text: `Running: ${cmdDisplay}` }],
      });

      const result = await runTests(params.args, signal);
      const status = result.success ? "PASSED" : "FAILED";
      const summary = `Tests ${status} (exit code ${result.code})\nCommand: ${cmdDisplay}\n\n${result.output}`;

      ctx.ui.notify(
        result.success ? `✅ Tests passed` : `❌ Tests failed`,
        result.success ? "info" : "error"
      );

      return {
        content: [{ type: "text", text: summary }],
        details: { success: result.success, code: result.code, command: cmdDisplay },
      };
    },
  });
}
