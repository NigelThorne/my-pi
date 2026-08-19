import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const extensionPath = new URL("./index.ts", import.meta.url).pathname;
const rendererPath = new URL("./pi-session-view.mjs", import.meta.url).pathname;

test("session-view runs its bundled renderer instead of requiring an untracked home-directory script", async () => {
  const child = spawn(
    "pi",
    [
      "--mode",
      "rpc",
      "--no-session",
      "--no-extensions",
      "--no-context-files",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--extension",
      extensionPath,
    ],
    { cwd: process.env.HOME, stdio: ["pipe", "pipe", "pipe"] },
  );

  const events = [];
  let buffer = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line) events.push(JSON.parse(line));
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });

  child.stdin.write(`${JSON.stringify({
    id: "session-view",
    type: "prompt",
    message: "/session-view not-a-session",
  })}\n`);

  await new Promise((resolve) => setTimeout(resolve, 1_000));
  child.kill("SIGTERM");
  await exited;

  const notifications = events
    .filter((event) => event.type === "extension_ui_request" && event.method === "notify")
    .map((event) => event.message);

  assert.equal(stderr.includes("Cannot find module"), false, stderr);
  assert.equal(
    notifications.some((message) => message?.includes("Missing script:")),
    false,
    notifications.join("\n"),
  );
});

test("session-view renders messages from an explicit session file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-retro-test-"));
  const sessionPath = path.join(directory, "session.jsonl");
  fs.writeFileSync(sessionPath, `${JSON.stringify({ type: "message", id: "user", parentId: null, message: { role: "user", content: "Hello" } })}\n`);

  const result = spawnSync("node", [rendererPath, sessionPath], { encoding: "utf8" });
  fs.rmSync(directory, { recursive: true, force: true });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Session: .*session\.jsonl/);
  assert.match(result.stdout, /User: Hello/);
});
