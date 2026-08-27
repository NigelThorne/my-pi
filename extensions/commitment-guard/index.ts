import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import {
  findOperationalPromise,
  shellStartsDurableExecutor,
} from "./detector.mjs";

const DURABLE_EXECUTOR_TOOLS = new Set(["subagent", "subagent_resume"]);

function assistantText(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text"
      ) {
        return String((part as { text?: unknown }).text ?? "");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Stops a session becoming silently idle after a future-work promise.
 *
 * The extension does not pretend that a waiting marker is work. It accepts only
 * executor-backed work: an interactive subagent or a shell command that starts
 * a detached process/pane. Any unsupported operational promise triggers one
 * automatic repair turn that tells the agent to start real work or retract it.
 */
export default function commitmentGuard(pi: ExtensionAPI) {
  let latestAssistantText = "";
  let hasDurableExecutor = false;
  let repairPending = false;
  const candidateToolCalls = new Set<string>();

  pi.on("before_agent_start", (event) => ({
    systemPrompt:
      event.systemPrompt +
      "\n\nCommitment guard: never say you will monitor, check, fix, implement, or otherwise do future work unless a durable executor has already been started. A status marker or intention is not an executor. If no executor is running, start the work before responding, or state only the current status.",
  }));

  pi.on("agent_start", (_event, ctx) => {
    latestAssistantText = "";
    hasDurableExecutor = false;
    candidateToolCalls.clear();
    ctx.ui.setStatus(
      "commitment-guard",
      repairPending ? "⚠ repairing an unsupported promise" : undefined,
    );
  });

  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") {
      latestAssistantText = assistantText(event.message);
    }
  });

  pi.on("tool_execution_start", (event) => {
    if (DURABLE_EXECUTOR_TOOLS.has(event.toolName)) {
      candidateToolCalls.add(event.toolCallId);
      return;
    }

    if (event.toolName === "bash") {
      const command = (event.input as { command?: unknown })?.command;
      if (shellStartsDurableExecutor(command)) {
        candidateToolCalls.add(event.toolCallId);
      }
    }
  });

  pi.on("tool_execution_end", (event) => {
    if (!candidateToolCalls.delete(event.toolCallId)) return;
    const result = event.result as { isError?: boolean } | undefined;
    if (!result?.isError) hasDurableExecutor = true;
  });

  pi.on("agent_settled", (_event, ctx) => {
    const promise = findOperationalPromise(latestAssistantText);

    if (!promise || hasDurableExecutor) {
      repairPending = false;
      ctx.ui.setStatus("commitment-guard", undefined);
      return;
    }

    const reason = `Unsupported promise detected: “${promise.phrase}”. No durable executor was started.`;
    ctx.ui.setStatus("commitment-guard", `⚠ ${reason}`);

    // One automatic repair turn avoids leaving the user with a silent idle
    // session, while the latch prevents an infinite loop if the model refuses
    // to comply. The visible status remains as an explicit escalation in that
    // exceptional case.
    if (repairPending) {
      ctx.ui.notify(
        `${reason} The automatic repair already ran; user action is needed.`,
        "error",
      );
      return;
    }

    repairPending = true;
    pi.sendMessage(
      {
        customType: "commitment-guard",
        display: true,
        content:
          `COMMITMENT GUARD BLOCKED: ${reason}\n\n` +
          "Do not give another status-only response. Start the promised work now with a real executor (for example a foreground `sleep && check` command, a detached process/pane, or an active subagent), then report the handle; otherwise explicitly retract the promise.",
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  });

  pi.registerCommand("commitment-guard", {
    description:
      "Show whether the guard is awaiting repair of an unsupported promise",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        repairPending
          ? "Commitment guard: automatic repair is pending or has been requested."
          : "Commitment guard: no unsupported promise is awaiting repair.",
        repairPending ? "warning" : "info",
      );
    },
  });
}
