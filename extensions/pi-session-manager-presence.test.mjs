import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LiveSessionPresenceBridge } from "./pi-session-manager-presence.ts";

function context({ sessionID = "session-id", sessionFile = "/sessions/current.jsonl", idle = true } = {}) {
  return {
    cwd: "/projects/forms",
    isIdle: () => idle,
    sessionManager: {
      getSessionFile: () => sessionFile,
      getSessionId: () => sessionID,
    },
  };
}

test("atomically publishes exact presence, changes state, and cleans up", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => 10_000,
    terminalPath: () => "/dev/ttys001",
    workspace: () => "manager-session",
  });
  const record = join(directory, "session-id.json");

  try {
    bridge.start(context());
    assert.deepEqual(JSON.parse(readFileSync(record, "utf8")), {
      sessionID: "session-id",
      sessionFile: "/sessions/current.jsonl",
      cwd: "/projects/forms",
      pid: 123,
      tty: "/dev/ttys001",
      workspace: "manager-session",
      state: "idle",
      updatedAt: 10_000,
    });

    bridge.publish(context({ idle: false }), "processing");
    assert.equal(JSON.parse(readFileSync(record, "utf8")).state, "processing");
    assert.equal(existsSync(`${record}.123.tmp`), false);

    bridge.stop(context());
    assert.equal(JSON.parse(readFileSync(record, "utf8")).state, "stopped");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("encodes session IDs before using them as registry filenames", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const bridge = new LiveSessionPresenceBridge({ directory, pid: 123, terminalPath: () => undefined });

  try {
    bridge.start(context({ sessionID: "nested/session" }));
    assert.equal(existsSync(join(directory, "nested%2Fsession.json")), true);
  } finally {
    bridge.stop(context({ sessionID: "nested/session" }));
    rmSync(directory, { recursive: true, force: true });
  }
});
