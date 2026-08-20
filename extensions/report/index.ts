import { streamSimple, type Message } from "@mariozechner/pi-ai";
import { buildSessionContext, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { parseReportStep } from "./report-format.mjs";

interface ReportSlot {
  thinking: string;
  answer: string;
  done: boolean;
}

const reportPrompt = `Give a concise status report on the work currently underway. Do not start new work or make any changes.

Return only a short Markdown task list. Use one discrete step per line and exactly one of these status tags:
- [done] completed work
- [pending] current or next work
- [blocked] work that cannot proceed, followed by the reason in parentheses

Order the list as: completed work, the current step, the next step, then blockers. Do not add headings, introductory prose, summaries, or filler. Omit blocked items when there are no blockers.`;

export default function (pi: ExtensionAPI) {
  let report: ReportSlot | undefined;
  let reportController: AbortController | undefined;
  let reportGeneration = 0;

  function renderWidget(ctx: ExtensionContext) {
    if (!report) {
      ctx.ui.setWidget("report", undefined);
      return;
    }

    const currentReport = report;
    ctx.ui.setWidget("report", (_tui, theme) => {
      const dim = (text: string) => theme.fg("dim", text);
      const green = (text: string) => theme.fg("success", text);
      const italic = (text: string) => theme.fg("dim", theme.italic(text));
      const yellow = (text: string) => theme.fg("warning", text);
      const cursor = !currentReport.done ? yellow(" ▍") : "";
      const parts = [
        dim("╭ 💬 report ───────────── /report:clear to dismiss ────────────╮"),
      ];

      if (currentReport.thinking) {
        parts.push(dim("│ ") + italic(currentReport.thinking) + cursor);
      }
      if (currentReport.answer) {
        for (const line of currentReport.answer.split("\n")) {
          const step = parseReportStep(line);
          if (!step) {
            if (line.startsWith("❌ ")) parts.push(dim("│ ") + yellow(line));
            continue;
          }

          if (step.status === "done") {
            parts.push(dim("│ ") + green("✓ ") + dim(step.text));
          } else if (step.status === "blocked") {
            parts.push(dim("│ ") + yellow("⊘ ") + yellow(step.text));
          } else {
            parts.push(dim("│ ") + dim("○ ") + step.text);
          }
        }
      } else if (!currentReport.thinking) {
        parts.push(dim("│ ") + yellow("⏳ preparing report...") + cursor);
      }

      parts.push(dim("╰────────────────────────────────────────────────────────────╯"));
      return new Text(parts.join("\n"), 0, 0);
    }, { placement: "aboveEditor" });
  }

  // This deliberately creates an in-memory fork: Pi's compaction-aware context
  // is snapshotted and sent to a separate model stream, leaving the main session untouched.
  function buildSnapshotMessages(ctx: ExtensionContext): Message[] {
    const snapshot = buildSessionContext(
      ctx.sessionManager.getEntries(),
      ctx.sessionManager.getLeafId(),
    );
    return [
      ...snapshot.messages,
      {
        role: "user",
        content: [{ type: "text", text: reportPrompt }],
        timestamp: Date.now(),
      },
    ] as Message[];
  }

  function cancelReport() {
    reportGeneration += 1;
    reportController?.abort();
    reportController = undefined;
    report = undefined;
  }

  function clearReport(ctx: ExtensionContext) {
    cancelReport();
    renderWidget(ctx);
  }

  function runReport(ctx: ExtensionContext) {
    const model = ctx.model;
    if (!model) {
      ctx.ui.notify("No model selected", "error");
      return;
    }

    reportController?.abort();
    const controller = new AbortController();
    reportController = controller;
    const generation = ++reportGeneration;
    const thinkingLevel = ctx.thinkingLevel ?? pi.getThinkingLevel();
    const reasoning = thinkingLevel === "off" ? undefined : thinkingLevel;
    const slot: ReportSlot = { thinking: "", answer: "", done: false };
    report = slot;
    const messages = buildSnapshotMessages(ctx);
    renderWidget(ctx);

    void (async () => {
      try {
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
        if (generation !== reportGeneration || report !== slot) return;
        if (!auth.ok) {
          slot.answer = `❌ ${auth.error}`;
          slot.done = true;
          reportController = undefined;
          renderWidget(ctx);
          return;
        }

        const requestModel = auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;
        const eventStream = streamSimple(
          requestModel,
          {
            systemPrompt: "You are a read-only status reporter. The supplied messages are an immutable snapshot of another agent's working session. Produce only the requested report. Do not continue the work, suggest tool calls, or imply that you made changes.",
            messages,
          },
          { apiKey: auth.apiKey, headers: auth.headers, env: auth.env, reasoning, signal: controller.signal },
        );

        for await (const event of eventStream) {
          if (generation !== reportGeneration || report !== slot) return;
          if (event.type === "thinking_delta") {
            slot.thinking += event.delta;
          } else if (event.type === "text_delta") {
            slot.answer += event.delta;
          } else if (event.type === "error") {
            slot.answer += `\n❌ ${event.error.errorMessage ?? "Model request failed"}`;
            slot.done = true;
            reportController = undefined;
          }
          renderWidget(ctx);
          if (event.type === "error") return;
        }

        if (generation !== reportGeneration || report !== slot) return;
        slot.done = true;
        reportController = undefined;
        renderWidget(ctx);
      } catch (error: any) {
        if (generation !== reportGeneration || report !== slot) return;
        slot.answer = `❌ ${error.message}`;
        slot.done = true;
        reportController = undefined;
        renderWidget(ctx);
      }
    })();
  }

  pi.on("session_shutdown", () => cancelReport());

  pi.registerCommand("report", {
    description: "Show a read-only report from a snapshot of the current session",
    handler: async (_args, ctx) => runReport(ctx),
  });

  pi.registerCommand("report:clear", {
    description: "Dismiss the report widget",
    handler: async (_args, ctx) => clearReport(ctx),
  });
}
