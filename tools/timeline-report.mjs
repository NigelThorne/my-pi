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
