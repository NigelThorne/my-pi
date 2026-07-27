import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_shutdown", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (sessionId) {
      console.log(`\nTo resume this session:\n  pi --session ${sessionId}\n`);
    }
  });
}
