import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const customEntryType = "timeline-telemetry";
const telemetrySource = "pi";

type TimelineEventName =
  | "input"
  | "agent_start"
  | "turn_start"
  | "turn_end"
  | "tool_execution_start"
  | "tool_execution_end"
  | "agent_settled"
  | "session_shutdown";

export default function registerTimelineTelemetry(pi: ExtensionAPI): void {
  const append = (event: TimelineEventName): void => {
    pi.appendEntry(customEntryType, { event, source: telemetrySource });
  };

  pi.on("input", () => append("input"));
  pi.on("agent_start", () => append("agent_start"));
  pi.on("turn_start", () => append("turn_start"));
  pi.on("turn_end", () => append("turn_end"));
  pi.on("tool_execution_start", () => append("tool_execution_start"));
  pi.on("tool_execution_end", () => append("tool_execution_end"));
  pi.on("agent_settled", () => append("agent_settled"));
  pi.on("session_shutdown", () => append("session_shutdown"));
}
