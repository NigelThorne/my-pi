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

test("subscribes to the durable timeline lifecycle events", async () => {
  const { default: registerTimelineTelemetry } = await import(extensionUrl.href);
  const pi = makePi();

  registerTimelineTelemetry(pi);

  assert.deepEqual([...pi.handlers.keys()], lifecycleEvents);
});
