import type {
  ExtensionAPI,
  InputEvent,
  SessionShutdownEvent,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
  TurnEndEvent,
  TurnStartEvent,
} from "@earendil-works/pi-coding-agent";

const customEntryType = "timeline-telemetry";
const telemetrySource = "pi" as const;

type TokenUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
};

type TimelineTelemetryData =
  | {
      event: "input";
      source: typeof telemetrySource;
      inputSource: InputEvent["source"];
      streamingBehavior?: NonNullable<InputEvent["streamingBehavior"]>;
    }
  | { event: "agent_start"; source: typeof telemetrySource }
  | { event: "turn_start"; source: typeof telemetrySource; turnIndex: number }
  | {
      event: "turn_end";
      source: typeof telemetrySource;
      turnIndex: number;
      stopReason?: string;
      usage?: TokenUsage;
      toolResultCount: number;
    }
  | {
      event: "tool_execution_start";
      source: typeof telemetrySource;
      toolCallId: string;
      toolName: string;
    }
  | {
      event: "tool_execution_end";
      source: typeof telemetrySource;
      toolCallId: string;
      toolName: string;
      isError: boolean;
    }
  | { event: "agent_settled"; source: typeof telemetrySource }
  | {
      event: "session_shutdown";
      source: typeof telemetrySource;
      reason: SessionShutdownEvent["reason"];
    };

function inputData(event: InputEvent): TimelineTelemetryData {
  return {
    event: "input",
    source: telemetrySource,
    inputSource: event.source,
    ...(event.streamingBehavior === undefined ? {} : { streamingBehavior: event.streamingBehavior }),
  };
}

function turnStartData(event: TurnStartEvent): TimelineTelemetryData {
  return {
    event: "turn_start",
    source: telemetrySource,
    turnIndex: event.turnIndex,
  };
}

function turnEndData(event: TurnEndEvent): TimelineTelemetryData {
  const responseData =
    event.message.role === "assistant"
      ? {
          stopReason: event.message.stopReason,
          usage: {
            input: event.message.usage.input,
            output: event.message.usage.output,
            cacheRead: event.message.usage.cacheRead,
            cacheWrite: event.message.usage.cacheWrite,
            totalTokens: event.message.usage.totalTokens,
          },
        }
      : {};

  return {
    event: "turn_end",
    source: telemetrySource,
    turnIndex: event.turnIndex,
    ...responseData,
    toolResultCount: event.toolResults.length,
  };
}

function toolStartData(event: ToolExecutionStartEvent): TimelineTelemetryData {
  return {
    event: "tool_execution_start",
    source: telemetrySource,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
  };
}

function toolEndData(event: ToolExecutionEndEvent): TimelineTelemetryData {
  return {
    event: "tool_execution_end",
    source: telemetrySource,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    isError: event.isError,
  };
}

function shutdownData(event: SessionShutdownEvent): TimelineTelemetryData {
  return {
    event: "session_shutdown",
    source: telemetrySource,
    reason: event.reason,
  };
}

export default function registerTimelineTelemetry(pi: ExtensionAPI): void {
  const append = (data: TimelineTelemetryData): void => {
    pi.appendEntry(customEntryType, data);
  };

  pi.on("input", (event) => append(inputData(event)));
  pi.on("agent_start", () => append({ event: "agent_start", source: telemetrySource }));
  pi.on("turn_start", (event) => append(turnStartData(event)));
  pi.on("turn_end", (event) => append(turnEndData(event)));
  pi.on("tool_execution_start", (event) => append(toolStartData(event)));
  pi.on("tool_execution_end", (event) => append(toolEndData(event)));
  pi.on("agent_settled", () => append({ event: "agent_settled", source: telemetrySource }));
  pi.on("session_shutdown", (event) => append(shutdownData(event)));
}
