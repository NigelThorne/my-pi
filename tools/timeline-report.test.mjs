import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { parseJsonl, summarizeSession } from "./timeline-report.mjs";

const toolPath = join(dirname(fileURLToPath(import.meta.url)), "timeline-report.mjs");
const usage = "node tools/timeline-report.mjs session <session.jsonl> [--focus-log <focus.jsonl>]";

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

function runCli(args) {
  return spawnSync(process.execPath, [toolPath, ...args], {
    encoding: "utf8",
  });
}

function withFixtures(t, records) {
  const directory = mkdtempSync(join(tmpdir(), "timeline-report-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  return Object.fromEntries(Object.entries(records).map(([name, contents]) => {
    const path = join(directory, `${name}.jsonl`);
    writeFileSync(path, contents, "utf8");
    return [name, path];
  }));
}

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

test("session command renders a compact TOON report to stdout", (t) => {
  const session = jsonl([
    { type: "session", version: 3, id: "session-cli", timestamp: "2026-09-08T10:00:00.000Z" },
    telemetry("input-cli", null, "2026-09-08T10:00:00.000Z", "input", { inputSource: "interactive" }),
    telemetry("turn-cli", "input-cli", "2026-09-08T10:00:01.000Z", "turn_start", { turnIndex: 0 }),
    telemetry("turn-end-cli", "turn-cli", "2026-09-08T10:00:04.000Z", "turn_end", { turnIndex: 0 }),
    telemetry("settled-cli", "turn-end-cli", "2026-09-08T10:00:13.000Z", "agent_settled"),
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
  ]);
  const fixtures = withFixtures(t, { session, focus });

  const result = runCli(["session", fixtures.session, "--focus-log", fixtures.focus]);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, [
    "session:",
    "  start: \"2026-09-08T10:00:00.000Z\"",
    "  end: \"2026-09-08T10:00:13.000Z\"",
    "  calendar_ms: 13000",
    "  model_ms: 3000",
    "  tool_wait_ms: 0",
    "  idle_ms: 10000",
    "foreground_apps[2]{application_name,bundle_identifier,duration_ms}:",
    "  \"Ghostty\",\"com.mitchellh.ghostty\",10000",
    "  \"Finder\",\"com.apple.finder\",3000",
    "",
  ].join("\n"));
  assert.equal(result.stdout.includes("\r"), false);
});

test("session command reports a definitive empty state", (t) => {
  const fixtures = withFixtures(t, {
    session: jsonl([
      { type: "session", version: 3, id: "empty-session", timestamp: "2026-09-08T10:00:00.000Z" },
    ]),
  });

  const result = runCli(["session", fixtures.session]);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "session: \"0 timeline telemetry entries found\"\n");
});

test("command help describes the only supported invocation", () => {
  const expected = [
    `usage: ${JSON.stringify(usage)}`,
    "description: \"Summarize local Pi timeline telemetry and optional foreground-app intervals\"",
    "",
  ].join("\n");

  for (const args of [["--help"], ["session", "--help"]]) {
    const result = runCli(args);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  }
});

test("command rejects missing and unknown arguments with usage errors", (t) => {
  const fixtures = withFixtures(t, { session: "" });
  const cases = [
    {
      args: [],
      error: "missing command",
    },
    {
      args: ["session"],
      error: "missing <session.jsonl>",
    },
    {
      args: ["unknown"],
      error: "unknown command: unknown",
    },
    {
      args: ["session", fixtures.session, "--unexpected"],
      error: "unknown argument: --unexpected",
    },
    {
      args: ["session", fixtures.session, "--focus-log"],
      error: "missing value for --focus-log",
    },
  ];

  for (const example of cases) {
    const result = runCli(example.args);
    assert.equal(result.status, 2, example.error);
    assert.equal(result.stderr, "", example.error);
    assert.equal(
      result.stdout,
      `error: ${JSON.stringify(example.error)}\nhelp: ${JSON.stringify(usage)}\n`,
      example.error,
    );
  }
});
