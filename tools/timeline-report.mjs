import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const usage = "node tools/timeline-report.mjs session <session.jsonl> [--focus-log <focus.jsonl>]";

function timestampMs(record) {
  const value = Date.parse(record.timestamp);
  return Number.isFinite(value) ? value : null;
}

export function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

export function selectActiveBranch(entries) {
  const branchEntries = entries.filter((entry) => typeof entry?.id === "string");
  if (branchEntries.length === 0) return [];

  const byId = new Map(branchEntries.map((entry) => [entry.id, entry]));
  const activeIds = new Set();
  let current = branchEntries.at(-1);

  while (current && !activeIds.has(current.id)) {
    activeIds.add(current.id);
    current = current.parentId == null ? null : byId.get(current.parentId);
  }

  return entries.filter((entry) => entry.type === "session" || activeIds.has(entry.id));
}

export function timelineTelemetry(entries) {
  return selectActiveBranch(entries)
    .filter((entry) => entry?.type === "custom" && entry.customType === "timeline-telemetry" && timestampMs(entry) !== null)
    .sort((left, right) => timestampMs(left) - timestampMs(right));
}

export function unionIntervals(intervals) {
  const sorted = intervals
    .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .toSorted((left, right) => left.start - right.start || left.end - right.end);
  const unioned = [];

  for (const interval of sorted) {
    const previous = unioned.at(-1);
    if (!previous || interval.start > previous.end) {
      unioned.push({ ...interval });
    } else {
      previous.end = Math.max(previous.end, interval.end);
    }
  }

  return unioned;
}

function totalDuration(intervals) {
  return unionIntervals(intervals).reduce((total, interval) => total + interval.end - interval.start, 0);
}

function modelIntervals(events) {
  const intervals = [];

  for (let index = 0; index < events.length; index += 1) {
    if (events[index].data?.event !== "turn_start") continue;
    const start = timestampMs(events[index]);

    for (let cursor = index + 1; cursor < events.length; cursor += 1) {
      const event = events[cursor].data?.event;
      if (event === "tool_execution_start" || event === "turn_end") {
        intervals.push({ start, end: timestampMs(events[cursor]) });
        break;
      }
      if (event === "turn_start") break;
    }
  }

  return unionIntervals(intervals);
}

function toolIntervals(events) {
  const starts = new Map();
  const intervals = [];

  for (const entry of events) {
    const event = entry.data?.event;
    const toolCallId = entry.data?.toolCallId;
    if (event === "tool_execution_start" && typeof toolCallId === "string") {
      starts.set(toolCallId, timestampMs(entry));
    } else if (event === "tool_execution_end" && starts.has(toolCallId)) {
      intervals.push({ start: starts.get(toolCallId), end: timestampMs(entry) });
      starts.delete(toolCallId);
    }
  }

  return unionIntervals(intervals);
}

export function foregroundAppDurations(focusEntries, windowStart, windowEnd) {
  const changes = focusEntries
    .filter((entry) => entry?.event === "focus_changed" && timestampMs(entry) !== null)
    .sort((left, right) => timestampMs(left) - timestampMs(right));
  const totals = new Map();

  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    const start = Math.max(windowStart, timestampMs(change));
    const nextStart = index + 1 < changes.length ? timestampMs(changes[index + 1]) : windowEnd;
    const end = Math.min(windowEnd, nextStart);
    if (end <= start) continue;

    const applicationName = typeof change.application_name === "string" ? change.application_name : null;
    const bundleIdentifier = typeof change.bundle_identifier === "string" ? change.bundle_identifier : null;
    const key = JSON.stringify([applicationName, bundleIdentifier]);
    const current = totals.get(key) ?? { applicationName, bundleIdentifier, durationMs: 0 };
    current.durationMs += end - start;
    totals.set(key, current);
  }

  return [...totals.values()].sort(
    (left, right) => right.durationMs - left.durationMs
      || (left.applicationName ?? "").localeCompare(right.applicationName ?? "")
      || (left.bundleIdentifier ?? "").localeCompare(right.bundleIdentifier ?? ""),
  );
}

export function summarizeSession(entries, focusEntries = []) {
  const events = timelineTelemetry(entries);
  if (events.length === 0) {
    return {
      window: null,
      calendarMs: 0,
      modelMs: 0,
      toolMs: 0,
      idleMs: 0,
      foregroundApps: [],
    };
  }

  const start = timestampMs(events[0]);
  const end = timestampMs(events.at(-1));
  const models = modelIntervals(events);
  const tools = toolIntervals(events);
  const calendarMs = Math.max(0, end - start);
  const activeMs = totalDuration([...models, ...tools]);

  return {
    window: {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
    },
    calendarMs,
    modelMs: totalDuration(models),
    toolMs: totalDuration(tools),
    idleMs: Math.max(0, calendarMs - activeMs),
    foregroundApps: foregroundAppDurations(focusEntries, start, end),
  };
}

function toonString(value) {
  return JSON.stringify(value);
}

export function renderSessionToon(summary) {
  if (summary.window === null) {
    return `session: ${toonString("0 timeline telemetry entries found")}\n`;
  }

  const lines = [
    "session:",
    `  start: ${toonString(summary.window.start)}`,
    `  end: ${toonString(summary.window.end)}`,
    `  calendar_ms: ${summary.calendarMs}`,
    `  model_ms: ${summary.modelMs}`,
    `  tool_wait_ms: ${summary.toolMs}`,
    `  idle_ms: ${summary.idleMs}`,
  ];

  if (summary.foregroundApps.length === 0) {
    lines.push(`foreground_apps: ${toonString("0 focus intervals found")}`);
  } else {
    lines.push(`foreground_apps[${summary.foregroundApps.length}]{application_name,bundle_identifier,duration_ms}:`);
    for (const app of summary.foregroundApps) {
      const applicationName = app.applicationName === null ? "null" : toonString(app.applicationName);
      const bundleIdentifier = app.bundleIdentifier === null ? "null" : toonString(app.bundleIdentifier);
      lines.push(`  ${applicationName},${bundleIdentifier},${app.durationMs}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function helpOutput() {
  return [
    `usage: ${toonString(usage)}`,
    `description: ${toonString("Summarize local Pi timeline telemetry and optional foreground-app intervals")}`,
    "",
  ].join("\n");
}

function usageError(message) {
  process.stdout.write(`error: ${toonString(message)}\nhelp: ${toonString(usage)}\n`);
  return 2;
}

function parseCommandArguments(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  if (args.length === 0) return { error: "missing command" };
  if (args[0] !== "session") return { error: `unknown command: ${args[0]}` };
  if (args.length === 2 && args[1] === "--help") return { help: true };
  if (args.length === 1 || args[1].startsWith("--")) return { error: "missing <session.jsonl>" };

  const command = { sessionPath: args[1], focusPath: null };
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index];
    if (argument !== "--focus-log") return { error: `unknown argument: ${argument}` };
    if (command.focusPath !== null) return { error: "duplicate argument: --focus-log" };
    if (index + 1 >= args.length || args[index + 1].startsWith("--")) {
      return { error: "missing value for --focus-log" };
    }
    command.focusPath = args[index + 1];
    index += 1;
  }
  return command;
}

function runCommand(args) {
  const command = parseCommandArguments(args);
  if (command.help) {
    process.stdout.write(helpOutput());
    return 0;
  }
  if (command.error) return usageError(command.error);

  try {
    const sessionEntries = parseJsonl(readFileSync(command.sessionPath, "utf8"));
    const focusEntries = command.focusPath === null
      ? []
      : parseJsonl(readFileSync(command.focusPath, "utf8"));
    process.stdout.write(renderSessionToon(summarizeSession(sessionEntries, focusEntries)));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`error: ${toonString(message)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runCommand(process.argv.slice(2));
}
