/**
 * Token Audit Extension
 *
 * Track and report token usage across all pi sessions.
 *
 * Commands:
 *   /tokens          - Token usage summary (today by default)
 *   /tokens today    - Today's usage
 *   /tokens yesterday - Yesterday's usage
 *   /tokens week     - Last 7 days
 *   /tokens month    - Last 30 days
 *   /tokens all      - All time
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

interface UsageRecord {
  timestamp: number;
  model: string;
  provider: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  sessionDir: string;
}

interface AggregatedUsage {
  model: string;
  provider: string;
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
}

function getSessionsDir(): string {
  return path.join(
    process.env.HOME || process.env.USERPROFILE || "~",
    ".pi",
    "agent",
    "sessions",
  );
}

async function* parseSessionFile(
  filePath: string,
): AsyncGenerator<UsageRecord> {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  const sessionDir = path.basename(path.dirname(filePath));

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      if (
        entry.type === "message" &&
        entry.message?.role === "assistant" &&
        entry.message?.usage
      ) {
        const msg = entry.message;
        yield {
          timestamp: msg.timestamp,
          model: msg.model ?? "unknown",
          provider: msg.provider ?? "unknown",
          input: msg.usage.input ?? 0,
          output: msg.usage.output ?? 0,
          cacheRead: msg.usage.cacheRead ?? 0,
          cacheWrite: msg.usage.cacheWrite ?? 0,
          totalTokens: msg.usage.totalTokens ?? 0,
          cost: {
            input: msg.usage.cost?.input ?? 0,
            output: msg.usage.cost?.output ?? 0,
            cacheRead: msg.usage.cost?.cacheRead ?? 0,
            cacheWrite: msg.usage.cost?.cacheWrite ?? 0,
            total: msg.usage.cost?.total ?? 0,
          },
          sessionDir,
        };
      }
    } catch {
      // skip malformed lines
    }
  }
}

function getTimeRange(period: string): { start: number; end: number; label: string } {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 86400000;

  switch (period) {
    case "today":
      return { start: todayStart, end: Date.now(), label: "Today" };
    case "yesterday": {
      const yesterdayStart = todayStart - dayMs;
      return { start: yesterdayStart, end: todayStart, label: "Yesterday" };
    }
    case "week":
      return { start: todayStart - 7 * dayMs, end: Date.now(), label: "Last 7 days" };
    case "month":
      return { start: todayStart - 30 * dayMs, end: Date.now(), label: "Last 30 days" };
    case "all":
      return { start: 0, end: Date.now(), label: "All time" };
    default:
      return { start: todayStart, end: Date.now(), label: "Today" };
  }
}

async function collectUsage(
  start: number,
  end: number,
): Promise<UsageRecord[]> {
  const sessionsDir = getSessionsDir();
  const records: UsageRecord[] = [];

  if (!fs.existsSync(sessionsDir)) return records;

  const projectDirs = fs.readdirSync(sessionsDir, { withFileTypes: true });

  for (const projDir of projectDirs) {
    if (!projDir.isDirectory()) continue;

    const projPath = path.join(sessionsDir, projDir.name);
    let sessionFiles: string[];
    try {
      sessionFiles = fs.readdirSync(projPath).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const file of sessionFiles) {
      // Quick filter: session filename starts with ISO timestamp
      // e.g. 2026-03-17T03-39-08-307Z_uuid.jsonl
      const fileTimestamp = file.substring(0, 24).replace(/-/g, (m, offset) => {
        // Restore ISO format: keep hyphens in date part, replace in time part
        return offset <= 9 ? "-" : ":";
      });

      // Check if the file could possibly contain entries in our range
      // Session files are named by creation time; if created after `end`, skip
      const fileDate = new Date(fileTimestamp.replace(/:/g, "-")).getTime();
      if (!isNaN(fileDate) && fileDate > end) continue;

      const filePath = path.join(projPath, file);
      for await (const record of parseSessionFile(filePath)) {
        if (record.timestamp >= start && record.timestamp < end) {
          records.push(record);
        }
      }
    }
  }

  return records;
}

function aggregate(records: UsageRecord[]): {
  byModel: AggregatedUsage[];
  byProject: { project: string; requests: number; totalTokens: number; cost: number }[];
  totals: { requests: number; input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: number };
} {
  // By model
  const modelMap = new Map<string, AggregatedUsage>();
  for (const r of records) {
    const key = `${r.provider}/${r.model}`;
    const existing = modelMap.get(key) ?? {
      model: r.model,
      provider: r.provider,
      requests: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: 0,
    };
    existing.requests++;
    existing.input += r.input;
    existing.output += r.output;
    existing.cacheRead += r.cacheRead;
    existing.cacheWrite += r.cacheWrite;
    existing.totalTokens += r.totalTokens;
    existing.cost += r.cost.total;
    modelMap.set(key, existing);
  }

  // By project
  const projMap = new Map<string, { project: string; requests: number; totalTokens: number; cost: number }>();
  for (const r of records) {
    const projName = r.sessionDir
      .replace(/^--/, "")
      .replace(/--$/, "")
      .replace(/--/g, "/");
    const existing = projMap.get(projName) ?? { project: projName, requests: 0, totalTokens: 0, cost: 0 };
    existing.requests++;
    existing.totalTokens += r.totalTokens;
    existing.cost += r.cost.total;
    projMap.set(projName, existing);
  }

  // Totals
  const totals = {
    requests: records.length,
    input: records.reduce((s, r) => s + r.input, 0),
    output: records.reduce((s, r) => s + r.output, 0),
    cacheRead: records.reduce((s, r) => s + r.cacheRead, 0),
    cacheWrite: records.reduce((s, r) => s + r.cacheWrite, 0),
    totalTokens: records.reduce((s, r) => s + r.totalTokens, 0),
    cost: records.reduce((s, r) => s + r.cost.total, 0),
  };

  const byModel = [...modelMap.values()].sort((a, b) => b.cost - a.cost);
  const byProject = [...projMap.values()].sort((a, b) => b.cost - a.cost);

  return { byModel, byProject, totals };
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatReport(
  label: string,
  data: ReturnType<typeof aggregate>,
): string {
  const lines: string[] = [];

  lines.push(`📊 Token Audit — ${label}`);
  lines.push("═".repeat(50));

  if (data.totals.requests === 0) {
    lines.push("  No usage found for this period.");
    return lines.join("\n");
  }

  // Totals
  lines.push("");
  lines.push(`  Requests:     ${data.totals.requests}`);
  lines.push(`  Total tokens: ${formatTokens(data.totals.totalTokens)}`);
  lines.push(`    Input:      ${formatTokens(data.totals.input)}`);
  lines.push(`    Output:     ${formatTokens(data.totals.output)}`);
  lines.push(`    Cache read: ${formatTokens(data.totals.cacheRead)}`);
  lines.push(`    Cache write:${formatTokens(data.totals.cacheWrite)}`);
  lines.push(`  Total cost:   ${formatCost(data.totals.cost)}`);

  // By model
  if (data.byModel.length > 0) {
    lines.push("");
    lines.push("  By Model:");
    lines.push("  " + "─".repeat(48));
    for (const m of data.byModel) {
      lines.push(`    ${m.provider}/${m.model}`);
      lines.push(`      ${m.requests} requests · ${formatTokens(m.totalTokens)} tokens · ${formatCost(m.cost)}`);
    }
  }

  // By project (top 10)
  if (data.byProject.length > 0) {
    lines.push("");
    lines.push("  By Project:");
    lines.push("  " + "─".repeat(48));
    const top = data.byProject.slice(0, 10);
    for (const p of top) {
      const shortName = p.project.length > 40
        ? "…" + p.project.slice(-39)
        : p.project;
      lines.push(`    ${shortName}`);
      lines.push(`      ${p.requests} requests · ${formatTokens(p.totalTokens)} tokens · ${formatCost(p.cost)}`);
    }
    if (data.byProject.length > 10) {
      lines.push(`    ... and ${data.byProject.length - 10} more projects`);
    }
  }

  return lines.join("\n");
}

export default function tokenAuditExtension(pi: ExtensionAPI) {
  pi.registerCommand("tokens", {
    description: "Token usage audit (today/yesterday/week/month/all)",
    getArgumentCompletions: (prefix) => {
      const options = ["today", "yesterday", "week", "month", "all"];
      const filtered = options.filter((o) => o.startsWith(prefix));
      return filtered.length > 0
        ? filtered.map((o) => ({ value: o, label: o }))
        : null;
    },
    handler: async (args, ctx) => {
      const period = args.trim().toLowerCase() || "today";
      const { start, end, label } = getTimeRange(period);

      ctx.ui.notify("Scanning sessions…", "info");

      const records = await collectUsage(start, end);
      const data = aggregate(records);
      const report = formatReport(label, data);

      ctx.ui.notify(report, "info");
    },
  });
}
