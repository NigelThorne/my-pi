import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LiveSessionPresenceBridge, matchUniqueGhosttySurface, parseGhosttySurfaces, resolveGhosttySurface } from "./pi-session-manager-presence.ts";

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

function withPatchedStdout({ isTTY, write }, callback) {
  const originalWrite = process.stdout.write;
  const isTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

  process.stdout.write = write;
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: isTTY });

  try {
    callback();
  } finally {
    process.stdout.write = originalWrite;
    if (isTTYDescriptor) {
      Object.defineProperty(process.stdout, "isTTY", isTTYDescriptor);
    } else {
      delete process.stdout.isTTY;
    }
  }
}

function withPatchedConsoleError(callback) {
  const originalConsoleError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);

  try {
    callback(errors);
  } finally {
    console.error = originalConsoleError;
  }
}

function readRecord(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("matchUniqueGhosttySurface returns an exact title match", () => {
  assert.deepEqual(
    matchUniqueGhosttySurface(
      [
        { windowID: "window-a", terminalID: "terminal-a", name: "Pi Session session-id" },
        { windowID: "window-b", terminalID: "terminal-b", name: "Other title" },
      ],
      "Pi Session session-id"
    ),
    { windowID: "window-a", terminalID: "terminal-a" }
  );
});

test('matchUniqueGhosttySurface returns a stable "<title> |" prefix match', () => {
  assert.deepEqual(
    matchUniqueGhosttySurface(
      [{ windowID: "window-a", terminalID: "terminal-a", name: "Pi Session session-id | bash" }],
      "Pi Session session-id"
    ),
    { windowID: "window-a", terminalID: "terminal-a" }
  );
});

test("matchUniqueGhosttySurface returns undefined when no surface matches", () => {
  assert.equal(
    matchUniqueGhosttySurface([{ windowID: "window-a", terminalID: "terminal-a", name: "Other title" }], "Pi Session session-id"),
    undefined
  );
});

test("matchUniqueGhosttySurface rejects duplicate matches", () => {
  assert.equal(
    matchUniqueGhosttySurface(
      [
        { windowID: "window-a", terminalID: "terminal-a", name: "Pi Session session-id" },
        { windowID: "window-b", terminalID: "terminal-b", name: "Pi Session session-id | bash" },
      ],
      "Pi Session session-id"
    ),
    undefined
  );
});

test("resolveGhosttySurface skips Ghostty surface listing when Ghostty is not running", () => {
  let listed = false;

  assert.equal(
    resolveGhosttySurface("Pi Session session-id", {
      isGhosttyRunning: () => false,
      listGhosttySurfaces: () => {
        listed = true;
        return [{ windowID: "window-a", terminalID: "terminal-a", name: "Pi Session session-id" }];
      },
    }),
    undefined
  );
  assert.equal(listed, false);
});

test("parseGhosttySurfaces preserves tabs in terminal names after the first two separators", () => {
  assert.deepEqual(parseGhosttySurfaces("window-a\tterminal-a\tPi Session session-id\t|\tbash\n"), [
    { windowID: "window-a", terminalID: "terminal-a", name: "Pi Session session-id\t|\tbash" },
  ]);
});

test("atomically publishes exact presence, changes state, and cleans up", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => 10_000,
    terminalPath: () => "/dev/ttys001",
    workspace: () => "manager-session",
    zellijPaneID: () => "terminal_11",
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
      zellijPaneID: "terminal_11",
      terminalTitle: null,
      ghosttyWindowID: null,
      ghosttyTerminalID: null,
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

test(
  "publishes the controlling tty from inherited stdin for native Terminal sessions",
  {
    skip: process.platform !== "darwin" ? "macOS-only: relies on /usr/bin/script allocating a Darwin tty" : false,
  },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
    const record = join(directory, "session-id.json");
    const moduleURL = new URL("./pi-session-manager-presence.ts", import.meta.url).href;
    const program = `
      import { LiveSessionPresenceBridge } from ${JSON.stringify(moduleURL)};

      const bridge = new LiveSessionPresenceBridge({
        directory: ${JSON.stringify(directory)},
        pid: 123,
        now: () => 10_000,
        heartbeatIntervalMs: 60_000,
      });

      bridge.start({
        cwd: "/projects/forms",
        isIdle: () => true,
        sessionManager: {
          getSessionFile: () => "/sessions/current.jsonl",
          getSessionId: () => "session-id",
        },
      });
    `;

    try {
      execFileSync("/usr/bin/script", ["-q", "/dev/null", process.execPath, "--input-type=module", "-e", program], {
        cwd: process.cwd(),
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 5_000,
      });

      assert.match(JSON.parse(readFileSync(record, "utf8")).tty, /^\/dev\/ttys\d+$/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
);

test("publishes a session-specific terminalTitle for non-Zellij sessions", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  const writes = [];
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => 10_000,
    terminalPath: () => "/dev/ttys001",
    workspace: () => undefined,
    zellijPaneID: () => undefined,
    writeTerminalTitleSequence: (value) => writes.push(value),
  });

  try {
    bridge.start(context());

    assert.equal(JSON.parse(readFileSync(record, "utf8")).terminalTitle, "Pi Session session-id");
    assert.deepEqual(writes, ["\u001b]0;Pi Session session-id\u0007"]);
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("strips control characters from published and emitted terminal titles", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const sessionID = "session\u0000-\u001b\n\r\u007fid";
  const record = join(directory, "session%00-%1B%0A%0D%7Fid.json");
  const writes = [];
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => 10_000,
    terminalPath: () => "/dev/ttys001",
    workspace: () => undefined,
    zellijPaneID: () => undefined,
    writeTerminalTitleSequence: (value) => writes.push(value),
  });

  try {
    bridge.start(context({ sessionID }));

    assert.equal(JSON.parse(readFileSync(record, "utf8")).terminalTitle, "Pi Session session-id");
    assert.deepEqual(writes, ["\u001b]0;Pi Session session-id\u0007"]);
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("default OSC writer only emits when stdout is interactive", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  const writes = [];
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => 10_000,
    terminalPath: () => "/dev/ttys001",
    workspace: () => undefined,
    zellijPaneID: () => undefined,
  });

  try {
    withPatchedStdout(
      {
        isTTY: false,
        write: (value) => {
          writes.push(value);
          return true;
        },
      },
      () => bridge.start(context())
    );

    assert.equal(JSON.parse(readFileSync(record, "utf8")).terminalTitle, null);
    assert.deepEqual(writes, []);
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("injected terminal title writer remains testable when stdout is not interactive", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  const writes = [];
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => 10_000,
    terminalPath: () => "/dev/ttys001",
    workspace: () => undefined,
    zellijPaneID: () => undefined,
    writeTerminalTitleSequence: (value) => writes.push(value),
  });

  try {
    withPatchedStdout(
      {
        isTTY: false,
        write: () => {
          throw new Error("default writer should not be used when a seam is injected");
        },
      },
      () => bridge.start(context())
    );

    assert.equal(JSON.parse(readFileSync(record, "utf8")).terminalTitle, "Pi Session session-id");
    assert.deepEqual(writes, ["\u001b]0;Pi Session session-id\u0007"]);
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("publishes presence when a terminal title write fails, records no false title, and retries later", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  const writes = [];
  let attempts = 0;
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => 10_000,
    terminalPath: () => "/dev/ttys001",
    workspace: () => undefined,
    zellijPaneID: () => undefined,
    writeTerminalTitleSequence: (value) => {
      attempts += 1;
      if (attempts === 1) throw new Error("write failed");
      writes.push(value);
    },
  });

  try {
    withPatchedConsoleError((errors) => {
      bridge.start(context());
      assert.deepEqual(JSON.parse(readFileSync(record, "utf8")), {
        sessionID: "session-id",
        sessionFile: "/sessions/current.jsonl",
        cwd: "/projects/forms",
        pid: 123,
        tty: "/dev/ttys001",
        workspace: null,
        zellijPaneID: null,
        terminalTitle: null,
        ghosttyWindowID: null,
        ghosttyTerminalID: null,
        state: "idle",
        updatedAt: 10_000,
      });

      bridge.publish(context({ idle: false }), "processing");
      assert.equal(JSON.parse(readFileSync(record, "utf8")).terminalTitle, "Pi Session session-id");
      assert.equal(JSON.parse(readFileSync(record, "utf8")).state, "processing");
      assert.equal(attempts, 2);
      assert.deepEqual(writes, ["\u001b]0;Pi Session session-id\u0007"]);
      assert.equal(errors.length, 1);
      assert.equal(errors[0][0], "pi-session-manager-presence: could not write terminal title");
      assert.match(String(errors[0][1]), /write failed/);
    });
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("publishes base presence before resolving Ghostty surface IDs, then republishes with resolved IDs", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  const events = [];
  const timestamps = [10_000, 10_001];
  let observedRecord;
  let observedError;
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => timestamps.shift() ?? 10_999,
    terminalPath: () => "/dev/ttys001",
    workspace: () => undefined,
    zellijPaneID: () => undefined,
    isInteractive: () => true,
    writeTerminalTitleSequence: (value) => events.push(["write", value]),
    resolveGhosttySurface: (title) => {
      events.push(["resolve", title]);
      try {
        observedRecord = readRecord(record);
      } catch (error) {
        observedError = error;
      }
      return { windowID: "window-a", terminalID: "terminal-a" };
    },
  });

  try {
    bridge.start(context());

    assert.deepEqual(events, [
      ["write", "\u001b]0;Pi Session session-id\u0007"],
      ["resolve", "Pi Session session-id"],
    ]);
    assert.equal(observedError, undefined);
    assert.deepEqual(observedRecord, {
      sessionID: "session-id",
      sessionFile: "/sessions/current.jsonl",
      cwd: "/projects/forms",
      pid: 123,
      tty: "/dev/ttys001",
      workspace: null,
      zellijPaneID: null,
      terminalTitle: "Pi Session session-id",
      ghosttyWindowID: null,
      ghosttyTerminalID: null,
      state: "idle",
      updatedAt: 10_000,
    });
    assert.deepEqual(readRecord(record), {
      sessionID: "session-id",
      sessionFile: "/sessions/current.jsonl",
      cwd: "/projects/forms",
      pid: 123,
      tty: "/dev/ttys001",
      workspace: null,
      zellijPaneID: null,
      terminalTitle: "Pi Session session-id",
      ghosttyWindowID: "window-a",
      ghosttyTerminalID: "terminal-a",
      state: "idle",
      updatedAt: 10_001,
    });
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps base presence when Ghostty resolution throws after the initial publish", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  let observedRecord;
  let observedError;
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => 10_000,
    terminalPath: () => "/dev/ttys001",
    workspace: () => undefined,
    zellijPaneID: () => undefined,
    isInteractive: () => true,
    writeTerminalTitleSequence: () => true,
    resolveGhosttySurface: () => {
      try {
        observedRecord = readRecord(record);
      } catch (error) {
        observedError = error;
      }
      throw new Error("ghostty unavailable");
    },
  });

  try {
    withPatchedConsoleError((errors) => {
      bridge.start(context());

      assert.equal(observedError, undefined);
      assert.deepEqual(observedRecord, {
        sessionID: "session-id",
        sessionFile: "/sessions/current.jsonl",
        cwd: "/projects/forms",
        pid: 123,
        tty: "/dev/ttys001",
        workspace: null,
        zellijPaneID: null,
        terminalTitle: "Pi Session session-id",
        ghosttyWindowID: null,
        ghosttyTerminalID: null,
        state: "idle",
        updatedAt: 10_000,
      });
      assert.deepEqual(readRecord(record), {
        sessionID: "session-id",
        sessionFile: "/sessions/current.jsonl",
        cwd: "/projects/forms",
        pid: 123,
        tty: "/dev/ttys001",
        workspace: null,
        zellijPaneID: null,
        terminalTitle: "Pi Session session-id",
        ghosttyWindowID: null,
        ghosttyTerminalID: null,
        state: "idle",
        updatedAt: 10_000,
      });
      assert.equal(errors.length, 1);
      assert.equal(errors[0][0], "pi-session-manager-presence: could not resolve Ghostty surface");
      assert.match(String(errors[0][1]), /ghostty unavailable/);
    });
  } finally {
    withPatchedConsoleError(() => bridge.stop(context()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("retries unresolved Ghostty surface lookups on later heartbeats", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  let attempts = 0;
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => 10_000,
    terminalPath: () => "/dev/ttys001",
    workspace: () => undefined,
    zellijPaneID: () => undefined,
    isInteractive: () => true,
    writeTerminalTitleSequence: () => true,
    resolveGhosttySurface: () => {
      attempts += 1;
      return attempts === 2 ? { windowID: "window-a", terminalID: "terminal-a" } : undefined;
    },
  });

  try {
    bridge.start(context());
    assert.equal(readRecord(record).ghosttyWindowID, null);
    assert.equal(readRecord(record).ghosttyTerminalID, null);

    bridge.publish(context({ idle: false }), "processing");
    assert.equal(attempts, 2);
    assert.equal(readRecord(record).ghosttyWindowID, "window-a");
    assert.equal(readRecord(record).ghosttyTerminalID, "terminal-a");
    assert.equal(readRecord(record).state, "processing");
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not resolve Ghostty surface again after stable IDs have been captured", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  let resolveCalls = 0;
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => 10_000,
    terminalPath: () => "/dev/ttys001",
    workspace: () => undefined,
    zellijPaneID: () => undefined,
    isInteractive: () => true,
    writeTerminalTitleSequence: () => true,
    resolveGhosttySurface: () => {
      resolveCalls += 1;
      return { windowID: "window-a", terminalID: "terminal-a" };
    },
  });

  try {
    bridge.start(context());
    assert.equal(resolveCalls, 1);
    assert.equal(readRecord(record).ghosttyWindowID, "window-a");
    assert.equal(readRecord(record).ghosttyTerminalID, "terminal-a");

    bridge.publish(context({ idle: false }), "processing");
    assert.equal(resolveCalls, 1);
    assert.equal(readRecord(record).ghosttyWindowID, "window-a");
    assert.equal(readRecord(record).ghosttyTerminalID, "terminal-a");
    assert.equal(readRecord(record).state, "processing");
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not query Ghostty for non-interactive sessions", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  let resolveCalls = 0;
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => 10_000,
    terminalPath: () => "/dev/ttys001",
    workspace: () => undefined,
    zellijPaneID: () => undefined,
    isInteractive: () => false,
    writeTerminalTitleSequence: () => true,
    resolveGhosttySurface: () => {
      resolveCalls += 1;
      return { windowID: "window-a", terminalID: "terminal-a" };
    },
  });

  try {
    bridge.start(context());

    assert.equal(resolveCalls, 0);
    assert.equal(readRecord(record).terminalTitle, "Pi Session session-id");
    assert.equal(readRecord(record).ghosttyWindowID, null);
    assert.equal(readRecord(record).ghosttyTerminalID, null);
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not query Ghostty for Zellij-managed sessions", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  let resolveCalls = 0;
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => 10_000,
    terminalPath: () => "/dev/ttys001",
    workspace: () => "manager-session",
    zellijPaneID: () => undefined,
    isInteractive: () => true,
    writeTerminalTitleSequence: () => true,
    resolveGhosttySurface: () => {
      resolveCalls += 1;
      return { windowID: "window-a", terminalID: "terminal-a" };
    },
  });

  try {
    bridge.start(context());

    assert.equal(resolveCalls, 0);
    assert.equal(readRecord(record).terminalTitle, null);
    assert.equal(readRecord(record).ghosttyWindowID, null);
    assert.equal(readRecord(record).ghosttyTerminalID, null);
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not overwrite workspace-managed terminal titles", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  const writes = [];
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => 10_000,
    terminalPath: () => "/dev/ttys001",
    workspace: () => "manager-session",
    zellijPaneID: () => undefined,
    writeTerminalTitleSequence: (value) => writes.push(value),
  });

  try {
    bridge.start(context());

    assert.equal(JSON.parse(readFileSync(record, "utf8")).terminalTitle, null);
    assert.deepEqual(writes, []);
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not overwrite Zellij pane-managed terminal titles", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  const writes = [];
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => 10_000,
    terminalPath: () => "/dev/ttys001",
    workspace: () => undefined,
    zellijPaneID: () => "terminal_11",
    writeTerminalTitleSequence: (value) => writes.push(value),
  });

  try {
    bridge.start(context());

    assert.equal(JSON.parse(readFileSync(record, "utf8")).terminalTitle, null);
    assert.deepEqual(writes, []);
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("publishes a subagent launch for immediate session-manager indexing", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const launchDirectory = mkdtempSync(join(tmpdir(), "pi-session-manager-launch-"));
  const bridge = new LiveSessionPresenceBridge({ directory, launchDirectory, pid: 123, now: () => 10_000 });

  try {
    bridge.publishSubagentLaunch(context(), { details: { sessionFile: "/sessions/child.jsonl" } });
    assert.deepEqual(JSON.parse(readFileSync(join(launchDirectory, "session-id-child.jsonl.json"), "utf8")), {
      parentSessionID: "session-id",
      parentSessionFile: "/sessions/current.jsonl",
      childSessionFile: "/sessions/child.jsonl",
      updatedAt: 10_000,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(launchDirectory, { recursive: true, force: true });
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
