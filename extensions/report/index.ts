import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("report", {
    description: "Report the current plan of attack and progress as bullet points",
    handler: async (_args, ctx) => {
      pi.sendUserMessage(`Give a concise status report on the work currently underway. Do not start new work or make any changes.

Use exactly these bullet points:
- Plan of attack: the current plan, including the next concrete step.
- Where I am up to: completed work, current work, and anything still outstanding.
- Blockers: anything preventing progress, or "None".`, { deliverAs: "followUp" });
      ctx.ui.notify("Report prompt sent.", "info");
    },
  });
}
