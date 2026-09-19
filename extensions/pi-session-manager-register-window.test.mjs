import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import registerPresenceExtension from "./pi-session-manager-presence.ts";

function fixture(t, options = {}, metadata = {}) {
  const directory = mkdtempSync(join(tmpdir(), "pi-register-window-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const commands = new Map();
  const notifications = [];
  let pokes = 0;
  registerPresenceExtension({
    registerCommand: (name, command) => commands.set(name, command),
    on() {},
    appendEntry() {},
  }, {
    directory,
    pid: 123,
    now: () => 1000,
    terminalPath: () => "/dev/ttys007",
    workspace: () => undefined,
    zellijPaneID: () => undefined,
    tmuxRuntime: () => false,
    tmuxRoute: () => undefined,
    managedGhosttyIdentity: () => ({ appPID: 300, windowID: "window-1", terminalID: "terminal-1", parentTTY: "/dev/ttys001" }),
    writeTerminalTitleSequence: () => false,
    sendAdvisoryPoke: () => { pokes++; },
    ...options,
  });
  const ctx = {
    cwd: "/project",
    isIdle: () => true,
    sessionManager: {
      getSessionId: () => metadata.sessionID === undefined ? "session-id" : metadata.sessionID,
      getSessionFile: () => metadata.sessionFile === undefined ? "/sessions/current.jsonl" : metadata.sessionFile,
    },
    ui: { notify: (message, level) => notifications.push({ message, level }) },
  };
  return {
    directory, notifications,
    run: () => commands.get("register-window").handler("", ctx),
    pokes: () => pokes,
  };
}

function payload(message) {
  const match = message.match(/Payload \(null = unavailable; omitted fields are not sent\):\n([\s\S]+)$/);
  assert.ok(match, "Command must show its registration payload");
  return JSON.parse(match[1]);
}

test("register-window displays the exact published Ghostty and tmux payload without re-querying", async (t) => {
  let queries = 0;
  const route = { socketPath: "/tmp/tmux socket", serverPID: 42, serverStartTime: "12345", sessionID: "$1", windowID: "@2", paneID: "%3" };
  const f = fixture(t, {
    tmuxRuntime: () => true,
    tmuxRoute: () => { queries++; return { ...route, paneID: `%${queries + 2}` }; },
    workspace: () => "stale-zellij",
    zellijPaneID: () => "999",
  });
  const message = await f.run();
  const record = JSON.parse(readFileSync(join(f.directory, "session-id.json"), "utf8"));
  assert.deepEqual(payload(message), record);
  assert.deepEqual(record.tmux, route);
  assert.equal(record.workspace, null);
  assert.equal(record.zellijPaneID, null);
  assert.equal(record.tty, "/dev/ttys007");
  assert.equal(record.ghosttyParentTTY, "/dev/ttys001");
  assert.equal(queries, 1);
  assert.match(message, /Registry write: succeeded/);
  assert.ok(message.includes(JSON.stringify(join(f.directory, "session-id.json"))));
  assert.deepEqual(f.notifications, [{ message, level: "info" }]);
  assert.equal(f.pokes(), 1);
});

test("register-window displays exact Zellij settings and escapes terminal controls", async (t) => {
  const f = fixture(t, { workspace: () => "workspace\u001b[31m", zellijPaneID: () => "8" });
  const message = await f.run();
  assert.equal(payload(message).workspace, "workspace\u001b[31m");
  assert.equal(payload(message).zellijPaneID, "8");
  assert.equal("tmux" in payload(message), false);
  assert.equal(message.includes("\u001b"), false);
});

test("register-window shows null and omitted fields for incomplete identity and missing tty", async (t) => {
  const f = fixture(t, { terminalPath: () => undefined, managedGhosttyIdentity: () => ({ appPID: 300, terminalID: "partial" }) });
  const message = await f.run();
  const record = payload(message);
  assert.equal(record.tty, null);
  assert.equal(record.ghosttyWindowID, null);
  assert.equal(record.ghosttyTerminalID, null);
  assert.equal("ghosttyAppPID" in record, false);
  assert.equal("ghosttyParentTTY" in record, false);
  assert.match(message, /did not provide a complete window identity/);
  assert.match(message, /Registry write: succeeded/);
  assert.equal(f.notifications[0].level, "warning");
});

test("register-window reports a failed write and the attempted payload, not success", async (t) => {
  const blocked = mkdtempSync(join(tmpdir(), "pi-register-blocked-"));
  t.after(() => rmSync(blocked, { recursive: true, force: true }));
  const file = join(blocked, "not-a-directory");
  writeFileSync(file, "keep");
  t.mock.method(console, "error", () => {});
  const f = fixture(t, { directory: file });
  const message = await f.run();
  assert.match(message, /Registry write: FAILED/);
  assert.doesNotMatch(message, /Republished/);
  assert.equal(payload(message).ghosttyWindowID, "window-1");
  assert.equal(f.notifications[0].level, "warning");
  assert.equal(f.pokes(), 0);
});

test("register-window does not claim a payload was sent without session metadata", async (t) => {
  const f = fixture(t, {}, { sessionID: null, sessionFile: null });
  const message = await f.run();
  assert.match(message, /No registration payload was sent/);
  assert.equal(f.pokes(), 0);
  assert.equal(f.notifications[0].level, "warning");
});
