import assert from "node:assert/strict";
import test from "node:test";

import { parseJsonl, summarizeSession } from "./timeline-report.mjs";

function jsonl(records) {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

function telemetry(id, parentId, timestamp, event, extra = {}) {
  return {
    type: "custom",
    id,
    parentId,
    timestamp,
    customType: "timeline-telemetry",
    data: { event, source: "pi", ...extra },
  };
}

test("summarizes model, unioned parallel tool, and residual idle time on the active branch", () => {
  const session = jsonl([
    { type: "session", version: 3, id: "session-1", timestamp: "2026-09-08T10:00:00.000Z" },
    telemetry("input", null, "2026-09-08T10:00:00.000Z", "input", { inputSource: "interactive" }),
    telemetry("turn-1-start", "input", "2026-09-08T10:00:01.000Z", "turn_start", { turnIndex: 0 }),
    telemetry("turn-1-end", "turn-1-start", "2026-09-08T10:00:04.000Z", "turn_end", { turnIndex: 0 }),
    telemetry("abandoned", "turn-1-end", "2026-09-08T10:01:00.000Z", "turn_end", { turnIndex: 99 }),
    telemetry("turn-2-start", "turn-1-end", "2026-09-08T10:00:05.000Z", "turn_start", { turnIndex: 1 }),
    telemetry("tool-a-start", "turn-2-start", "2026-09-08T10:00:07.000Z", "tool_execution_start", { toolCallId: "a", toolName: "read" }),
    telemetry("tool-b-start", "tool-a-start", "2026-09-08T10:00:08.000Z", "tool_execution_start", { toolCallId: "b", toolName: "bash" }),
    telemetry("tool-a-end", "tool-b-start", "2026-09-08T10:00:10.000Z", "tool_execution_end", { toolCallId: "a", toolName: "read", isError: false }),
    telemetry("tool-b-end", "tool-a-end", "2026-09-08T10:00:12.000Z", "tool_execution_end", { toolCallId: "b", toolName: "bash", isError: false }),
    telemetry("turn-2-end", "tool-b-end", "2026-09-08T10:00:13.000Z", "turn_end", { turnIndex: 1 }),
  ]);

  const summary = summarizeSession(parseJsonl(session));

  assert.deepEqual(summary.window, {
    start: "2026-09-08T10:00:00.000Z",
    end: "2026-09-08T10:00:13.000Z",
  });
  assert.equal(summary.calendarMs, 13_000);
  assert.equal(summary.modelMs, 5_000);
  assert.equal(summary.toolMs, 5_000);
  assert.equal(summary.idleMs, 3_000);
});

test("clips and aggregates foreground app intervals to the session window", () => {
  const session = jsonl([
    { type: "session", version: 3, id: "session-2", timestamp: "2026-09-08T10:00:00.000Z" },
    telemetry("input", null, "2026-09-08T10:00:00.000Z", "input", { inputSource: "interactive" }),
    telemetry("settled", "input", "2026-09-08T10:00:13.000Z", "agent_settled"),
  ]);
  const focus = jsonl([
    {
      timestamp: "2026-09-08T09:59:58.000Z",
      event: "focus_changed",
      application_name: "Finder",
      bundle_identifier: "com.apple.finder",
    },
    {
      timestamp: "2026-09-08T10:00:03.000Z",
      event: "focus_changed",
      application_name: "Ghostty",
      bundle_identifier: "com.mitchellh.ghostty",
    },
    {
      timestamp: "2026-09-08T10:00:05.000Z",
      event: "window_title_changed",
      application_name: "Ignored",
      bundle_identifier: "example.ignored",
      window_title: "Do not inspect this",
    },
    {
      timestamp: "2026-09-08T10:00:09.000Z",
      event: "focus_changed",
      application_name: "Finder",
      bundle_identifier: "com.apple.finder",
    },
  ]);

  const summary = summarizeSession(parseJsonl(session), parseJsonl(focus));

  assert.deepEqual(summary.foregroundApps, [
    {
      applicationName: "Finder",
      bundleIdentifier: "com.apple.finder",
      durationMs: 7_000,
    },
    {
      applicationName: "Ghostty",
      bundleIdentifier: "com.mitchellh.ghostty",
      durationMs: 6_000,
    },
  ]);
});
