#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const showTree = args.includes("--tree");
const target = args.find((arg) => !arg.startsWith("--"));

if (!target) {
  console.error("Usage: /session-view <id-or-path> [--tree] [--color]");
  process.exit(1);
}

function findSessionById(id) {
  const sessionsDir = process.env.PI_CODING_AGENT_SESSION_DIR
    ?? path.join(os.homedir(), ".pi", "agent", "sessions");
  const matches = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (entry.isFile() && entry.name.endsWith(".jsonl") && entry.name.includes(id)) matches.push(entryPath);
    }
  };

  if (fs.existsSync(sessionsDir)) walk(sessionsDir);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`More than one session matches "${id}". Use a full path.`);
  throw new Error(`No session matches "${id}".`);
}

function resolveSession(target) {
  const directPath = path.resolve(target.replace(/^~(?=\/)/, os.homedir()));
  return fs.existsSync(directPath) ? directPath : findSessionById(target);
}

function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text")
    .map((block) => block.text)
    .filter(Boolean)
    .join("\n");
}

function formatEntry(entry) {
  if (entry.type !== "message") return null;
  const message = entry.message ?? {};
  const text = textContent(message.content).trim();
  if (!text) return null;

  const labels = { user: "User", assistant: "Assistant", toolResult: message.toolName ?? "Tool" };
  return `${labels[message.role] ?? message.role ?? "Message"}: ${text}`;
}

function renderLinear(entries) {
  return entries.map(formatEntry).filter(Boolean).join("\n\n");
}

function renderTree(entries) {
  const byParent = new Map();
  for (const entry of entries) {
    const key = entry.parentId ?? null;
    const children = byParent.get(key) ?? [];
    children.push(entry);
    byParent.set(key, children);
  }

  const lines = [];
  const visit = (entry, depth) => {
    const formatted = formatEntry(entry);
    if (formatted) lines.push(`${"  ".repeat(depth)}${formatted}`);
    for (const child of byParent.get(entry.id) ?? []) visit(child, depth + 1);
  };
  for (const root of byParent.get(null) ?? []) visit(root, 0);
  return lines.join("\n");
}

try {
  const sessionPath = resolveSession(target);
  const entries = fs.readFileSync(sessionPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const rendered = showTree ? renderTree(entries) : renderLinear(entries);

  console.log(`Session: ${sessionPath}`);
  if (rendered) console.log(`\n${rendered}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
