import assert from "node:assert/strict";
import test from "node:test";

const extensionUrl = new URL("./timeline-telemetry.ts", import.meta.url);

const lifecycleEvents = [
  "input",
  "agent_start",
  "turn_start",
  "turn_end",
  "tool_execution_start",
  "tool_execution_end",
  "agent_settled",
  "session_shutdown",
];

function makePi() {
  const handlers = new Map();
  const entries = [];

  return {
    handlers,
    entries,
    on(name, handler) {
      handlers.set(name, handler);
    },
    appendEntry(type, data) {
      entries.push({ type, data });
    },
  };
}

async function setup() {
  const { default: registerTimelineTelemetry } = await import(extensionUrl.href);
  const pi = makePi();
  registerTimelineTelemetry(pi);
  return pi;
}

test("subscribes to the durable timeline lifecycle events", async () => {
  const pi = await setup();

  assert.deepEqual([...pi.handlers.keys()], lifecycleEvents);
});

test("input records its source and queued delivery behavior without storing content", async () => {
  const pi = await setup();

  pi.handlers.get("input")({
    type: "input",
    text: "private prompt",
    images: [{ type: "image", data: "private image", mimeType: "image/png" }],
    source: "rpc",
    streamingBehavior: "steer",
  });
  pi.handlers.get("input")({
    type: "input",
    text: "private follow-up",
    source: "extension",
    streamingBehavior: "followUp",
  });

  assert.deepEqual(pi.entries, [
    {
      type: "timeline-telemetry",
      data: { event: "input", source: "pi", inputSource: "rpc", streamingBehavior: "steer" },
    },
    {
      type: "timeline-telemetry",
      data: { event: "input", source: "pi", inputSource: "extension", streamingBehavior: "followUp" },
    },
  ]);
});

test("turn events record their index and final response accounting", async () => {
  const pi = await setup();
  const usage = {
    input: 100,
    output: 25,
    cacheRead: 60,
    cacheWrite: 10,
    totalTokens: 195,
    cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
  };

  pi.handlers.get("turn_start")({ type: "turn_start", turnIndex: 3, timestamp: 1_725_000_000_000 });
  pi.handlers.get("turn_end")({
    type: "turn_end",
    turnIndex: 3,
    message: {
      role: "assistant",
      content: [],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude",
      usage,
      stopReason: "toolUse",
      timestamp: 1_725_000_000_100,
    },
    toolResults: [
      { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [], isError: false, timestamp: 1 },
      { role: "toolResult", toolCallId: "call-2", toolName: "bash", content: [], isError: true, timestamp: 2 },
    ],
  });

  assert.deepEqual(pi.entries, [
    {
      type: "timeline-telemetry",
      data: { event: "turn_start", source: "pi", turnIndex: 3 },
    },
    {
      type: "timeline-telemetry",
      data: {
        event: "turn_end",
        source: "pi",
        turnIndex: 3,
        stopReason: "toolUse",
        usage: { input: 100, output: 25, cacheRead: 60, cacheWrite: 10, totalTokens: 195 },
        toolResultCount: 2,
      },
    },
  ]);
});

test("tool events record identity and only the final error status", async () => {
  const pi = await setup();

  pi.handlers.get("tool_execution_start")({
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "bash",
    args: { command: "private command" },
  });
  pi.handlers.get("tool_execution_end")({
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "bash",
    result: { content: [{ type: "text", text: "private output" }] },
    isError: false,
  });

  assert.deepEqual(pi.entries, [
    {
      type: "timeline-telemetry",
      data: { event: "tool_execution_start", source: "pi", toolCallId: "call-1", toolName: "bash" },
    },
    {
      type: "timeline-telemetry",
      data: { event: "tool_execution_end", source: "pi", toolCallId: "call-1", toolName: "bash", isError: false },
    },
  ]);
});

test("session shutdown records the supplied reason", async () => {
  const pi = await setup();

  pi.handlers.get("session_shutdown")({
    type: "session_shutdown",
    reason: "resume",
    targetSessionFile: "/sessions/private.jsonl",
  });

  assert.deepEqual(pi.entries, [
    {
      type: "timeline-telemetry",
      data: { event: "session_shutdown", source: "pi", reason: "resume" },
    },
  ]);
});

test("absent optional lifecycle values are omitted", async () => {
  const pi = await setup();

  pi.handlers.get("input")({ type: "input", text: "private prompt", source: "interactive" });
  pi.handlers.get("turn_end")({
    type: "turn_end",
    turnIndex: 0,
    message: { role: "user", content: "prompt", timestamp: 1 },
    toolResults: [],
  });

  assert.deepEqual(pi.entries, [
    {
      type: "timeline-telemetry",
      data: { event: "input", source: "pi", inputSource: "interactive" },
    },
    {
      type: "timeline-telemetry",
      data: { event: "turn_end", source: "pi", turnIndex: 0, toolResultCount: 0 },
    },
  ]);
});
