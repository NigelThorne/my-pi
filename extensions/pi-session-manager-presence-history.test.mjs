import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { LiveSessionPresenceBridge } from "./pi-session-manager-presence.ts";

const options = {
  terminalPath: () => undefined,
  workspace: () => undefined,
  zellijPaneID: () => undefined,
  tmuxRuntime: () => false,
  managedGhosttyIdentity: () => ({}),
  writeTerminalTitleSequence: () => {},
  sendAdvisoryPoke: () => {},
};

function context(sessionID = "session-id") {
  return {
    cwd: "/project",
    isIdle: () => true,
    sessionManager: {
      getSessionId: () => sessionID,
      getSessionFile: () => "/sessions/current.jsonl",
    },
  };
}

function fixture(t, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "pi-presence-history-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bridge = new LiveSessionPresenceBridge({ ...options, directory, ...overrides });
  return { directory, bridge };
}

function history(directory, sessionID = "session-id") {
  const text = readFileSync(join(directory, `${encodeURIComponent(sessionID)}.jsonl`), "utf8");
  assert.ok(text.endsWith("\n"));
  return text.trimEnd().split("\n").map((line) => JSON.parse(line));
}

function captureErrors(t) {
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  return errors;
}

test("JSONL appends each full state without changing snapshot format or previous bytes", (t) => {
  let time = 1000;
  const { directory, bridge } = fixture(t, { pid: 123, now: () => time++ });
  const snapshots = [];
  let previous = "";
  const check = () => {
    snapshots.push(JSON.parse(readFileSync(join(directory, "session-id.json"), "utf8")));
    const text = readFileSync(join(directory, "session-id.jsonl"), "utf8");
    assert.ok(text.startsWith(previous));
    previous = text;
    assert.deepEqual(history(directory), snapshots);
  };

  try {
    bridge.start(context());
    check();
    bridge.publish(context(), "processing");
    check();
    bridge.publish(context(), "processing");
    check();
    bridge.stop(context());
    check();
    assert.deepEqual(history(directory).map(({ state }) => state), ["idle", "processing", "processing", "stopped"]);
    assert.deepEqual(history(directory).map(({ updatedAt }) => updatedAt), [1000, 1001, 1002, 1003]);
    assert.ok(history(directory).every(({ pid }) => pid === 123));
    assert.equal(statSync(join(directory, "session-id.jsonl")).mode & 0o777, 0o600);
  } finally {
    bridge.stop(context());
  }
});

test("JSONL records every heartbeat even when state is unchanged", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { directory, bridge } = fixture(t, { heartbeatIntervalMs: 10 });
  try {
    bridge.start(context());
    t.mock.timers.tick(30);
    assert.equal(history(directory).length, 4);
    assert.ok(history(directory).every(({ state }) => state === "idle"));
  } finally {
    bridge.stop(context());
  }
});

test("JSONL survives session switches and a new publisher PID using the same encoded session ID", (t) => {
  const sessionID = "a/b";
  const { directory, bridge } = fixture(t, { pid: 123 });
  const resumed = new LiveSessionPresenceBridge({ ...options, directory, pid: 456 });
  try {
    bridge.start(context(sessionID));
    const previous = readFileSync(join(directory, "a%2Fb.jsonl"), "utf8");
    bridge.start(context("other"));
    assert.equal(readFileSync(join(directory, "a%2Fb.jsonl"), "utf8"), previous);
    resumed.start(context(sessionID));
    assert.deepEqual(history(directory, sessionID).map(({ pid }) => pid), [123, 456]);
    assert.equal(history(directory, "other").length, 1);
  } finally {
    bridge.stop(context("other"));
    resumed.stop(context(sessionID));
  }
});

test("JSONL append failures are reported but do not block snapshots or advisory pokes", (t) => {
  let pokes = 0;
  const { directory, bridge } = fixture(t, { sendAdvisoryPoke: () => pokes++ });
  const errors = captureErrors(t);
  mkdirSync(join(directory, "session-id.jsonl"));
  bridge.publish(context(), "processing");
  assert.equal(JSON.parse(readFileSync(join(directory, "session-id.json"), "utf8")).state, "processing");
  assert.equal(pokes, 1);
  assert.ok(errors.some(([message]) => message === "pi-session-manager-presence: could not append presence history"));
});

test("JSONL still records a publication when the compatibility snapshot cannot be replaced", (t) => {
  const { directory, bridge } = fixture(t);
  const errors = captureErrors(t);
  mkdirSync(join(directory, "session-id.json"));
  bridge.publish(context(), "processing");
  assert.equal(history(directory)[0].state, "processing");
  assert.ok(errors.some(([message]) => message === "pi-session-manager-presence: could not publish presence"));
});

test("JSONL retains complete records from concurrent publisher processes", async (t) => {
  const { directory } = fixture(t);
  const moduleURL = new URL("./pi-session-manager-presence.ts", import.meta.url).href;
  const script = `
    import { LiveSessionPresenceBridge } from ${JSON.stringify(moduleURL)};
    const bridge = new LiveSessionPresenceBridge({
      directory: process.argv[1],
      terminalPath: () => undefined, workspace: () => undefined,
      zellijPaneID: () => undefined, tmuxRuntime: () => false,
      managedGhosttyIdentity: () => ({}),
      writeTerminalTitleSequence: () => {}, sendAdvisoryPoke: () => {},
    });
    const ctx = {
      cwd: '/project', isIdle: () => true,
      sessionManager: { getSessionId: () => 'session-id', getSessionFile: () => '/sessions/current.jsonl' },
    };
    for (let i = 0; i < 20; i++) bridge.publish(ctx);
    console.log(process.pid);
  `;
  const outputs = await Promise.all(Array.from({ length: 3 }, () =>
    promisify(execFile)(process.execPath, ["--input-type=module", "-e", script, directory], { timeout: 10_000 }),
  ));
  const records = history(directory);
  assert.equal(records.length, 60);
  for (const { stdout } of outputs) {
    assert.equal(records.filter(({ pid }) => pid === Number(stdout.trim())).length, 20);
  }
});
