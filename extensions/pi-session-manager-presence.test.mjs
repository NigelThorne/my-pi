import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import registerPresenceExtension, { LiveSessionPresenceBridge, resolveTmuxRoute } from "./pi-session-manager-presence.ts";

// The test runner itself may be hosted in tmux and a managed Ghostty window.
// Unit tests must not inherit that route unless a case supplies it explicitly.
for (const name of [
  "TMUX", "TMUX_PANE", "ZELLIJ", "ZELLIJ_SESSION_NAME", "ZELLIJ_PANE_ID",
  "PI_GHOSTTY_APP_PID", "PI_GHOSTTY_WINDOW_ID", "PI_GHOSTTY_TERMINAL_ID", "PI_GHOSTTY_PARENT_TTY",
]) delete process.env[name];

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

function makePi({ onAppend = () => {} } = {}) {
  const commands = new Map();
  const handlers = new Map();
  const entries = [];
  return {
    commands,
    handlers,
    entries,
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
    on(name, handler) {
      handlers.set(name, handler);
    },
    appendEntry(type, data) {
      onAppend(type, data);
      entries.push({ type, data });
    },
  };
}

function entriesOfType(pi, type) {
  return pi.entries.filter((entry) => entry.type === type);
}

test.skip("superseded: matchUniqueGhosttySurface returns an exact title match", () => {
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

test.skip('superseded: matchUniqueGhosttySurface returns a stable "<title> |" prefix match', () => {
  assert.deepEqual(
    matchUniqueGhosttySurface(
      [{ windowID: "window-a", terminalID: "terminal-a", name: "Pi Session session-id | bash" }],
      "Pi Session session-id"
    ),
    { windowID: "window-a", terminalID: "terminal-a" }
  );
});

test.skip("superseded: matchUniqueGhosttySurface returns undefined when no surface matches", () => {
  assert.equal(
    matchUniqueGhosttySurface([{ windowID: "window-a", terminalID: "terminal-a", name: "Other title" }], "Pi Session session-id"),
    undefined
  );
});

test.skip("superseded: matchUniqueGhosttySurface rejects duplicate matches", () => {
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

test.skip("superseded: resolveGhosttySurface skips Ghostty surface listing when Ghostty is not running", () => {
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

test.skip("superseded: parseGhosttySurfaces preserves PID scope and tabs in terminal names", () => {
  assert.deepEqual(parseGhosttySurfaces("8686\twindow-a\tterminal-a\tPi Session session-id\t|\tbash\n"), [
    { appPID: 8686, windowID: "window-a", terminalID: "terminal-a", name: "Pi Session session-id\t|\tbash" },
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

test("retries missing session metadata promptly and publishes the latest pending state before the heartbeat", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  let sessionFile;
  let sessionID;
  const sessionManager = {
    getSessionFile: () => sessionFile,
    getSessionId: () => sessionID,
  };
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => 10_000,
    terminalPath: () => "/dev/ttys001",
    workspace: () => "manager-session",
    zellijPaneID: () => "terminal_11",
    heartbeatIntervalMs: 60_000,
    sessionMetadataRetryMs: 5,
  });

  try {
    bridge.start({ cwd: "/projects/forms", isIdle: () => true, sessionManager });
    bridge.publish({ cwd: "/projects/forms", isIdle: () => false, sessionManager }, "processing");
    assert.equal(existsSync(record), false);

    sessionFile = "/sessions/current.jsonl";
    sessionID = "session-id";
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.deepEqual(readRecord(record), {
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
      state: "processing",
      updatedAt: 10_000,
    });
  } finally {
    bridge.stop({ cwd: "/projects/forms", isIdle: () => false, sessionManager });
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

test.skip("superseded: publishes base presence before resolving Ghostty surface IDs, then republishes with resolved IDs", () => {
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

test.skip("superseded: keeps base presence when Ghostty resolution throws after the initial publish", () => {
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

test.skip("superseded: retries unresolved Ghostty surface lookups on later heartbeats", () => {
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

test.skip("superseded: does not resolve Ghostty surface again after stable IDs have been captured", () => {
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

test.skip("superseded: does not query Ghostty for non-interactive sessions", () => {
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

test.skip("superseded: does not query Ghostty for Zellij-managed sessions", () => {
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

test("registers the /register-window command", () => {
  const pi = makePi();

  registerPresenceExtension(pi);

  assert.equal(typeof pi.commands.get("register-window")?.handler, "function");
});

test("appends the initial complete managed Ghostty binding to the Pi session", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const pi = makePi();
  registerPresenceExtension(pi, {
    directory,
    terminalPath: () => "/dev/ttys007",
    managedGhosttyIdentity: () => ({
      appPID: 300,
      windowID: "window-1",
      terminalID: "terminal-1",
      parentTTY: "/dev/ttys123",
    }),
    sendAdvisoryPoke: () => {},
    heartbeatIntervalMs: 60_000,
  });

  try {
    pi.handlers.get("session_start")({}, context());

    assert.deepEqual(entriesOfType(pi, "pi-session-manager-window-binding"), [{
      type: "pi-session-manager-window-binding",
      data: {
        event: "ghostty_binding",
        source: "pi-session-manager-presence",
        sessionID: "session-id",
        sessionFile: "/sessions/current.jsonl",
        cwd: "/projects/forms",
        ghosttyAppPID: 300,
        ghosttyWindowID: "window-1",
        ghosttyTerminalID: "terminal-1",
        ghosttyParentTTY: "/dev/ttys123",
      },
    }]);
  } finally {
    pi.handlers.get("session_shutdown")({}, context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not append duplicate managed Ghostty bindings on heartbeats", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const pi = makePi();
  let identityReads = 0;
  registerPresenceExtension(pi, {
    directory,
    terminalPath: () => "/dev/ttys007",
    managedGhosttyIdentity: () => {
      identityReads += 1;
      return { appPID: 300, windowID: "window-1", terminalID: "terminal-1" };
    },
    sendAdvisoryPoke: () => {},
    heartbeatIntervalMs: 5,
  });

  try {
    pi.handlers.get("session_start")({}, context());
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.equal(identityReads > 1, true);
    const bindingEntries = entriesOfType(pi, "pi-session-manager-window-binding");
    assert.equal(bindingEntries.length, 1);
    assert.equal("ghosttyParentTTY" in bindingEntries[0].data, false);
  } finally {
    pi.handlers.get("session_shutdown")({}, context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("appends a new managed Ghostty binding after a rebind", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  const bindingAppendObservations = [];
  const pi = makePi({
    onAppend: (type, data) => {
      if (type === "pi-session-manager-window-binding") {
        bindingAppendObservations.push({ event: data.event, publishedWindowID: existsSync(record) ? readRecord(record).ghosttyWindowID : undefined });
      }
    },
  });
  let identity = { appPID: 300, windowID: "window-1", terminalID: "terminal-1", parentTTY: "/dev/ttys123" };
  registerPresenceExtension(pi, {
    directory,
    terminalPath: () => "/dev/ttys007",
    managedGhosttyIdentity: () => identity,
    sendAdvisoryPoke: () => {},
    heartbeatIntervalMs: 60_000,
  });

  try {
    pi.handlers.get("session_start")({}, context());
    identity = { appPID: 301, windowID: "window-2", terminalID: "terminal-2", parentTTY: "/dev/ttys124" };
    pi.handlers.get("agent_settled")({}, context());

    assert.deepEqual(bindingAppendObservations, [
      { event: "ghostty_binding", publishedWindowID: "window-1" },
      { event: "ghostty_binding_ended", publishedWindowID: "window-2" },
      { event: "ghostty_binding", publishedWindowID: "window-2" },
    ]);
    assert.deepEqual(entriesOfType(pi, "pi-session-manager-window-binding").map(({ data }) => data), [
      {
        event: "ghostty_binding",
        source: "pi-session-manager-presence",
        sessionID: "session-id",
        sessionFile: "/sessions/current.jsonl",
        cwd: "/projects/forms",
        ghosttyAppPID: 300,
        ghosttyWindowID: "window-1",
        ghosttyTerminalID: "terminal-1",
        ghosttyParentTTY: "/dev/ttys123",
      },
      {
        event: "ghostty_binding_ended",
        source: "pi-session-manager-presence",
        sessionID: "session-id",
        sessionFile: "/sessions/current.jsonl",
        cwd: "/projects/forms",
        ghosttyAppPID: 300,
        ghosttyWindowID: "window-1",
        ghosttyTerminalID: "terminal-1",
        ghosttyParentTTY: "/dev/ttys123",
      },
      {
        event: "ghostty_binding",
        source: "pi-session-manager-presence",
        sessionID: "session-id",
        sessionFile: "/sessions/current.jsonl",
        cwd: "/projects/forms",
        ghosttyAppPID: 301,
        ghosttyWindowID: "window-2",
        ghosttyTerminalID: "terminal-2",
        ghosttyParentTTY: "/dev/ttys124",
      },
    ]);
  } finally {
    pi.handlers.get("session_shutdown")({}, context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("appends an end event when a managed Ghostty identity is lost", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const pi = makePi();
  let identity = { appPID: 300, windowID: "window-1", terminalID: "terminal-1" };
  registerPresenceExtension(pi, {
    directory,
    managedGhosttyIdentity: () => identity,
    sendAdvisoryPoke: () => {},
    heartbeatIntervalMs: 60_000,
  });

  try {
    pi.handlers.get("session_start")({}, context());
    identity = {};
    pi.handlers.get("agent_settled")({}, context());

    const bindingEntries = entriesOfType(pi, "pi-session-manager-window-binding");
    assert.deepEqual(bindingEntries.map(({ data }) => data.event), ["ghostty_binding", "ghostty_binding_ended"]);
    assert.deepEqual(bindingEntries[1].data, {
      event: "ghostty_binding_ended",
      source: "pi-session-manager-presence",
      sessionID: "session-id",
      sessionFile: "/sessions/current.jsonl",
      cwd: "/projects/forms",
      ghosttyAppPID: 300,
      ghosttyWindowID: "window-1",
      ghosttyTerminalID: "terminal-1",
    });
  } finally {
    pi.handlers.get("session_shutdown")({}, context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("appends an end event when the Pi session shuts down", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const pi = makePi();
  registerPresenceExtension(pi, {
    directory,
    managedGhosttyIdentity: () => ({ appPID: 300, windowID: "window-1", terminalID: "terminal-1" }),
    sendAdvisoryPoke: () => {},
    heartbeatIntervalMs: 60_000,
  });

  try {
    pi.handlers.get("session_start")({}, context());
    pi.handlers.get("session_shutdown")({}, context());

    assert.deepEqual(
      entriesOfType(pi, "pi-session-manager-window-binding").map(({ data }) => data.event),
      ["ghostty_binding", "ghostty_binding_ended"],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("appends a privacy-limited history entry after the initial presence publish", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  const appendObservations = [];
  const pi = makePi({
    onAppend: (type) => {
      if (type === "pi-session-manager-presence") {
        appendObservations.push({ exists: existsSync(record), state: readRecord(record).state });
      }
    },
  });
  registerPresenceExtension(pi, {
    directory,
    terminalPath: () => "/dev/ttys007",
    workspace: () => "manager-session",
    zellijPaneID: () => "terminal_11",
    managedGhosttyIdentity: () => ({
      appPID: 300,
      windowID: "window-1",
      terminalID: "terminal-1",
      parentTTY: "/dev/ttys123",
    }),
    sendAdvisoryPoke: () => {},
    heartbeatIntervalMs: 60_000,
  });

  try {
    pi.handlers.get("session_start")({}, context());

    assert.deepEqual(entriesOfType(pi, "pi-session-manager-presence"), [{
      type: "pi-session-manager-presence",
      data: {
        event: "presence_published",
        source: "pi-session-manager-presence",
        sessionID: "session-id",
        sessionFile: "/sessions/current.jsonl",
        cwd: "/projects/forms",
        state: "idle",
        tty: "/dev/ttys007",
        workspace: "manager-session",
        zellijPaneID: "terminal_11",
        ghosttyAppPID: 300,
        ghosttyWindowID: "window-1",
        ghosttyTerminalID: "terminal-1",
        ghosttyParentTTY: "/dev/ttys123",
      },
    }]);
    assert.deepEqual(appendObservations, [{ exists: true, state: "idle" }]);
    const payload = entriesOfType(pi, "pi-session-manager-presence")[0].data;
    assert.equal("updatedAt" in payload, false);
    assert.equal("terminalTitle" in payload, false);
    assert.equal("windowTitle" in payload, false);
  } finally {
    pi.handlers.get("session_shutdown")({}, context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("appends every heartbeat and state publication with the current tmux route", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const pi = makePi();
  const tmux = {
    socketPath: "/private/tmp/tmux-test/socket",
    serverPID: 456,
    serverStartTime: "Tue Sep  8 12:00:01 2026",
    sessionID: "$2",
    windowID: "@3",
    paneID: "%7",
  };
  registerPresenceExtension(pi, {
    directory,
    terminalPath: () => "/dev/ttys007",
    tmuxRoute: () => tmux,
    managedGhosttyIdentity: () => ({}),
    sendAdvisoryPoke: () => {},
    heartbeatIntervalMs: 5,
  });

  try {
    pi.handlers.get("session_start")({}, context());
    await new Promise((resolve) => setTimeout(resolve, 25));

    const heartbeatEntries = entriesOfType(pi, "pi-session-manager-presence");
    assert.equal(heartbeatEntries.length >= 2, true);
    assert.equal(heartbeatEntries.every(({ data }) => data.state === "idle"), true);
    assert.equal(heartbeatEntries.every(({ data }) => data.tmux === tmux), true);

    const beforeStateChange = heartbeatEntries.length;
    pi.handlers.get("before_agent_start")({}, context({ idle: false }));
    const stateEntries = entriesOfType(pi, "pi-session-manager-presence");
    assert.equal(stateEntries.length, beforeStateChange + 1);
    assert.equal(stateEntries.at(-1).data.state, "processing");
  } finally {
    pi.handlers.get("session_shutdown")({}, context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("appends a stopped presence publication", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const pi = makePi();
  registerPresenceExtension(pi, {
    directory,
    managedGhosttyIdentity: () => ({}),
    sendAdvisoryPoke: () => {},
    heartbeatIntervalMs: 60_000,
  });

  try {
    pi.handlers.get("session_start")({}, context());
    pi.handlers.get("session_shutdown")({}, context());

    assert.deepEqual(
      entriesOfType(pi, "pi-session-manager-presence").map(({ data }) => data.state),
      ["idle", "stopped"],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not append presence or binding history when the initial atomic registry write fails", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const blockedDirectory = join(directory, "not-a-directory");
  writeFileSync(blockedDirectory, "blocked\n");
  const pi = makePi();
  registerPresenceExtension(pi, {
    directory: blockedDirectory,
    managedGhosttyIdentity: () => ({ appPID: 300, windowID: "window-1", terminalID: "terminal-1" }),
    sendAdvisoryPoke: () => {},
    heartbeatIntervalMs: 60_000,
  });

  try {
    withPatchedConsoleError(() => {
      pi.handlers.get("session_start")({}, context());
      pi.handlers.get("session_shutdown")({}, context());
    });
    assert.deepEqual(pi.entries, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not append stopped or binding-end history when the shutdown registry write fails", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const pi = makePi();
  registerPresenceExtension(pi, {
    directory,
    managedGhosttyIdentity: () => ({ appPID: 300, windowID: "window-1", terminalID: "terminal-1" }),
    sendAdvisoryPoke: () => {},
    heartbeatIntervalMs: 60_000,
  });

  try {
    pi.handlers.get("session_start")({}, context());
    rmSync(directory, { recursive: true, force: true });
    writeFileSync(directory, "blocked\n");
    withPatchedConsoleError(() => {
      pi.handlers.get("session_shutdown")({}, context());
    });

    assert.deepEqual(entriesOfType(pi, "pi-session-manager-presence").map(({ data }) => data.state), ["idle"]);
    assert.deepEqual(
      entriesOfType(pi, "pi-session-manager-window-binding").map(({ data }) => data.event),
      ["ghostty_binding"],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test.skip("superseded: registerWindow republishes the frontmost Ghostty PID and exact surface tuple", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  const timestamps = [10_000, 10_001, 10_002];
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => timestamps.shift() ?? 10_999,
    terminalPath: () => "/dev/ttys001",
    workspace: () => undefined,
    zellijPaneID: () => undefined,
    isInteractive: () => true,
    writeTerminalTitleSequence: () => false,
    resolveFocusedGhosttySurface: () => ({
      appPID: 8686,
      windowID: "window-z",
      terminalID: "terminal-live",
    }),
  });

  try {
    bridge.start(context());
    assert.equal(readRecord(record).ghosttyAppPID, undefined);

    assert.deepEqual(bridge.registerWindow(context({ idle: false })), {
      ok: true,
      message: "Registered the current Ghostty window for this session.",
    });
    assert.deepEqual(readRecord(record), {
      sessionID: "session-id",
      sessionFile: "/sessions/current.jsonl",
      cwd: "/projects/forms",
      pid: 123,
      tty: "/dev/ttys001",
      workspace: null,
      zellijPaneID: null,
      terminalTitle: null,
      ghosttyAppPID: 8686,
      ghosttyWindowID: "window-z",
      ghosttyTerminalID: "terminal-live",
      state: "processing",
      updatedAt: 10_001,
    });
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test.skip("superseded: registerWindow keeps two Zellij workspaces distinct despite a shared inherited Ghostty surface ID", () => {
  const firstDirectory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-first-"));
  const secondDirectory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-second-"));
  const previousSurfaceID = process.env.GHOSTTY_SURFACE_ID;
  process.env.GHOSTTY_SURFACE_ID = "terminal-inherited";

  const makeBridge = (directory, workspaceName) =>
    new LiveSessionPresenceBridge({
      directory,
      pid: 123,
      terminalPath: () => "/dev/ttys001",
      workspace: () => workspaceName,
      zellijPaneID: () => "terminal_11",
      isInteractive: () => true,
      resolveCurrentGhosttySurface: () => ({ windowID: "window-inherited", terminalID: "terminal-inherited" }),
      resolveFocusedGhosttySurface: () => ({
        appPID: workspaceName === "workspace-one" ? 8686 : 55803,
        windowID: `window-${workspaceName}`,
        terminalID: `terminal-${workspaceName}`,
      }),
    });

  const firstBridge = makeBridge(firstDirectory, "workspace-one");
  const secondBridge = makeBridge(secondDirectory, "workspace-two");

  try {
    firstBridge.start(context({ sessionID: "session-one", sessionFile: "/sessions/one.jsonl" }));
    secondBridge.start(context({ sessionID: "session-two", sessionFile: "/sessions/two.jsonl" }));
    firstBridge.registerWindow(context({ sessionID: "session-one", sessionFile: "/sessions/one.jsonl" }));
    secondBridge.registerWindow(context({ sessionID: "session-two", sessionFile: "/sessions/two.jsonl" }));

    const firstRecord = readRecord(join(firstDirectory, "session-one.json"));
    const secondRecord = readRecord(join(secondDirectory, "session-two.json"));
    assert.deepEqual(
      [firstRecord.ghosttyAppPID, firstRecord.ghosttyWindowID, firstRecord.ghosttyTerminalID],
      [8686, "window-workspace-one", "terminal-workspace-one"],
    );
    assert.deepEqual(
      [secondRecord.ghosttyAppPID, secondRecord.ghosttyWindowID, secondRecord.ghosttyTerminalID],
      [55803, "window-workspace-two", "terminal-workspace-two"],
    );
    assert.notEqual(firstRecord.ghosttyWindowID, secondRecord.ghosttyWindowID);
  } finally {
    if (previousSurfaceID === undefined) delete process.env.GHOSTTY_SURFACE_ID;
    else process.env.GHOSTTY_SURFACE_ID = previousSurfaceID;
    firstBridge.stop(context({ sessionID: "session-one", sessionFile: "/sessions/one.jsonl" }));
    secondBridge.stop(context({ sessionID: "session-two", sessionFile: "/sessions/two.jsonl" }));
    rmSync(firstDirectory, { recursive: true, force: true });
    rmSync(secondDirectory, { recursive: true, force: true });
  }
});

test.skip("superseded: preserves registered Ghostty IDs on a Zellij heartbeat", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    terminalPath: () => "/dev/ttys001",
    workspace: () => "manager-session",
    zellijPaneID: () => "terminal_11",
    isInteractive: () => true,
    resolveGhosttySurface: () => ({ windowID: "window-z", terminalID: "terminal-live" }),
    resolveFocusedGhosttySurface: () => ({ appPID: 8686, windowID: "window-z", terminalID: "terminal-live" }),
  });

  try {
    bridge.start(context());
    bridge.registerWindow(context());
    bridge.publish(context());

    assert.equal(readRecord(record).ghosttyWindowID, "window-z");
    assert.equal(readRecord(record).ghosttyTerminalID, "terminal-live");
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test.skip("superseded: registerWindow does not guess from a workspace title without frontmost process identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  let titleLookupCount = 0;
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    terminalPath: () => "/dev/ttys001",
    workspace: () => "manager-session",
    zellijPaneID: () => "terminal_11",
    isInteractive: () => true,
    resolveFocusedGhosttySurface: () => undefined,
    resolveGhosttySurface: () => {
      titleLookupCount += 1;
      return { appPID: 55803, windowID: "wrong-window", terminalID: "wrong-terminal" };
    },
  });

  try {
    bridge.start(context());
    assert.equal(bridge.registerWindow(context({ idle: false })).ok, false);
    assert.equal(titleLookupCount, 0);
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test.skip("superseded: registerWindow falls back to the focused Ghostty terminal when env and title lookup fail", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    terminalPath: () => "/dev/ttys001",
    workspace: () => "manager-session",
    zellijPaneID: () => "terminal_11",
    isInteractive: () => true,
    resolveCurrentGhosttySurface: () => undefined,
    resolveFocusedGhosttySurface: () => ({ appPID: 8686, windowID: "window-front", terminalID: "terminal-front" }),
    resolveGhosttySurface: () => undefined,
  });

  try {
    bridge.start(context());

    assert.deepEqual(bridge.registerWindow(context({ idle: false })), {
      ok: true,
      message: "Registered the current Ghostty window for this session.",
    });
    assert.equal(readRecord(record).ghosttyWindowID, "window-front");
    assert.equal(readRecord(record).ghosttyTerminalID, "terminal-front");
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test.skip("superseded: registerWindow fails safely when Ghostty identity cannot be determined", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  const timestamps = [10_000, 10_001, 10_002, 10_003];
  const previousSurfaceID = process.env.GHOSTTY_SURFACE_ID;
  let nextSurface = { appPID: 8686, windowID: "window-z", terminalID: "terminal-live" };
  process.env.GHOSTTY_SURFACE_ID = "terminal-live";
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => timestamps.shift() ?? 10_999,
    terminalPath: () => "/dev/ttys001",
    workspace: () => "manager-session",
    zellijPaneID: () => "terminal_11",
    isInteractive: () => true,
    resolveGhosttySurface: () => undefined,
    resolveFocusedGhosttySurface: () => nextSurface,
  });

  try {
    bridge.start(context());
    bridge.registerWindow(context());
    nextSurface = undefined;

    assert.deepEqual(bridge.registerWindow(context({ idle: false })), {
      ok: false,
      message: "Could not determine the current Ghostty window for this session. Run /register-window from the active Ghostty pane and try again.",
    });
    assert.deepEqual(readRecord(record), {
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
      state: "processing",
      updatedAt: 10_002,
    });
  } finally {
    if (previousSurfaceID === undefined) delete process.env.GHOSTTY_SURFACE_ID;
    else process.env.GHOSTTY_SURFACE_ID = previousSurfaceID;
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("publishes an advisory presence poke only after the authoritative file lands", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  const pokes = [];
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => 10_000,
    terminalPath: () => "/dev/ttys001",
    workspace: () => "manager-session",
    zellijPaneID: () => "terminal_11",
    sendAdvisoryPoke: (stream) => {
      pokes.push({ stream, exists: existsSync(record), state: readRecord(record).state });
    },
  });

  try {
    bridge.publish(context(), "idle");
    assert.deepEqual(pokes, [{ stream: "presence", exists: true, state: "idle" }]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ignores advisory socket failures and keeps the authoritative presence file", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const record = join(directory, "session-id.json");
  let attempts = 0;
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    now: () => 10_000,
    terminalPath: () => "/dev/ttys001",
    workspace: () => "manager-session",
    zellijPaneID: () => "terminal_11",
    sendAdvisoryPoke: () => {
      attempts += 1;
      throw new Error("connect failed");
    },
  });

  try {
    assert.doesNotThrow(() => bridge.publish(context({ idle: false }), "processing"));
    assert.equal(attempts, 1);
    assert.deepEqual(readRecord(record), {
      sessionID: "session-id",
      sessionFile: "/sessions/current.jsonl",
      cwd: "/projects/forms",
      pid: 123,
      tty: null,
      workspace: "manager-session",
      zellijPaneID: "terminal_11",
      terminalTitle: null,
      ghosttyWindowID: null,
      ghosttyTerminalID: null,
      state: "processing",
      updatedAt: 10_000,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("publishes a subagent launch advisory poke only after the authoritative file lands", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const launchDirectory = mkdtempSync(join(tmpdir(), "pi-session-manager-launch-"));
  const record = join(launchDirectory, "session-id-child.jsonl.json");
  const pokes = [];
  const bridge = new LiveSessionPresenceBridge({
    directory,
    launchDirectory,
    pid: 123,
    now: () => 10_000,
    sendAdvisoryPoke: (stream) => {
      pokes.push({ stream, exists: existsSync(record), childSessionFile: JSON.parse(readFileSync(record, "utf8")).childSessionFile });
    },
  });

  try {
    bridge.publishSubagentLaunch(context(), { details: { sessionFile: "/sessions/child.jsonl" } });
    assert.deepEqual(JSON.parse(readFileSync(record, "utf8")), {
      parentSessionID: "session-id",
      parentSessionFile: "/sessions/current.jsonl",
      childSessionFile: "/sessions/child.jsonl",
      updatedAt: 10_000,
    });
    assert.deepEqual(pokes, [{ stream: "launch", exists: true, childSessionFile: "/sessions/child.jsonl" }]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(launchDirectory, { recursive: true, force: true });
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

test("publishes the ordinary bootstrap parent TTY with its exact Ghostty identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const previous = Object.fromEntries([
    "PI_GHOSTTY_APP_PID", "PI_GHOSTTY_WINDOW_ID", "PI_GHOSTTY_TERMINAL_ID", "PI_GHOSTTY_PARENT_TTY",
  ].map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    PI_GHOSTTY_APP_PID: "300",
    PI_GHOSTTY_WINDOW_ID: "window-ordinary",
    PI_GHOSTTY_TERMINAL_ID: "terminal-ordinary",
    PI_GHOSTTY_PARENT_TTY: "/dev/ttys123",
  });
  const bridge = new LiveSessionPresenceBridge({ directory, pid: 123, terminalPath: () => "/dev/ttys007" });

  try {
    bridge.start(context());
    const record = readRecord(join(directory, "session-id.json"));
    assert.deepEqual(
      [record.ghosttyAppPID, record.ghosttyWindowID, record.ghosttyTerminalID, record.ghosttyParentTTY],
      [300, "window-ordinary", "terminal-ordinary", "/dev/ttys123"],
    );
  } finally {
    bridge.stop(context());
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("publishes and republishes the exact bootstrap Ghostty identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    terminalPath: () => "/dev/ttys007",
    managedGhosttyIdentity: () => ({ appPID: 300, windowID: "window-1", terminalID: "terminal-1", parentTTY: "/dev/ttys007" }),
  });

  try {
    bridge.start(context());
    assert.deepEqual(
      [readRecord(join(directory, "session-id.json")).ghosttyAppPID,
       readRecord(join(directory, "session-id.json")).ghosttyWindowID,
       readRecord(join(directory, "session-id.json")).ghosttyTerminalID],
      [300, "window-1", "terminal-1"],
    );
    assert.equal(readRecord(join(directory, "session-id.json")).ghosttyParentTTY, "/dev/ttys007");
    assert.equal(bridge.registerWindow(context()).ok, true);
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an incomplete bootstrap Ghostty identity is never published as an exact route", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    terminalPath: () => "/dev/ttys007",
    managedGhosttyIdentity: () => ({ appPID: 300, terminalID: "terminal-1" }),
  });

  try {
    bridge.start(context());
    const record = readRecord(join(directory, "session-id.json"));
    assert.equal("ghosttyAppPID" in record, false);
    assert.equal(record.ghosttyWindowID, null);
    assert.equal(record.ghosttyTerminalID, null);
    assert.equal(bridge.registerWindow(context()).ok, false);
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resolveTmuxRoute uses the explicit socket and verifies the server incarnation", () => {
  const calls = [];
  const route = resolveTmuxRoute({
    tmuxEnvironment: "/private/tmp/tmux-test/socket,456,0",
    tmuxPaneID: "%7",
    tmuxExecutable: "/custom/bin/tmux",
    execFile: (command, args, options) => {
      calls.push({ command, args, options });
      if (command === "/custom/bin/tmux") return "456|$2|@3|%7\n";
      if (command === "/bin/ps") return " Tue Sep  8 12:00:01 2026 \n";
      throw new Error(`unexpected command: ${command}`);
    },
  });

  assert.deepEqual(route, {
    socketPath: "/private/tmp/tmux-test/socket",
    serverPID: 456,
    serverStartTime: "Tue Sep  8 12:00:01 2026",
    sessionID: "$2",
    windowID: "@3",
    paneID: "%7",
  });
  assert.deepEqual(calls[0].args.slice(0, 6), [
    "-S",
    "/private/tmp/tmux-test/socket",
    "display-message",
    "-p",
    "-t",
    "%7",
  ]);
  assert.equal(calls[0].args[6], "#{pid}|#{session_id}|#{window_id}|#{pane_id}");
  assert.equal(calls[0].options.timeout > 0, true);
  assert.deepEqual(calls[1].args, ["-p", "456", "-o", "lstart="]);
  assert.equal(calls[1].options.env.LC_ALL, "C");
});

test("resolveTmuxRoute rejects a stale inherited TMUX server PID", () => {
  const route = resolveTmuxRoute({
    tmuxEnvironment: "/private/tmp/tmux-test/socket,456,0",
    tmuxPaneID: "%7",
    tmuxExecutable: "/custom/bin/tmux",
    execFile: () => "999|$2|@3|%7\n",
  });

  assert.equal(route, undefined);
});

test("publishes the additive tmux route and suppresses stale Zellij routing", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const tmux = {
    socketPath: "/private/tmp/tmux-test/socket",
    serverPID: 456,
    serverStartTime: "Tue Sep  8 12:00:01 2026",
    sessionID: "$2",
    windowID: "@3",
    paneID: "%7",
  };
  const titleWrites = [];
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    terminalPath: () => "/dev/ttys007",
    workspace: () => "stale-zellij-workspace",
    zellijPaneID: () => "stale-zellij-pane",
    tmuxRoute: () => tmux,
    writeTerminalTitleSequence: (value) => titleWrites.push(value),
  });

  try {
    bridge.start(context());
    const record = readRecord(join(directory, "session-id.json"));
    assert.deepEqual(record.tmux, tmux);
    assert.equal(record.workspace, null);
    assert.equal(record.zellijPaneID, null);
    assert.equal(record.terminalTitle, null);
    assert.deepEqual(titleWrites, []);
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed tmux query never falls back to stale inherited Zellij routing", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    terminalPath: () => "/dev/ttys007",
    workspace: () => "stale-zellij-workspace",
    zellijPaneID: () => "stale-zellij-pane",
    tmuxRuntime: () => true,
    tmuxRoute: () => undefined,
  });

  try {
    bridge.start(context());
    const record = readRecord(join(directory, "session-id.json"));
    assert.equal("tmux" in record, false);
    assert.equal(record.workspace, null);
    assert.equal(record.zellijPaneID, null);
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});

test("omits a tmux route when a later bounded identity query fails", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-session-manager-presence-"));
  const tmux = {
    socketPath: "/private/tmp/tmux-test/socket",
    serverPID: 456,
    serverStartTime: "Tue Sep  8 12:00:01 2026",
    sessionID: "$2",
    windowID: "@3",
    paneID: "%7",
  };
  let queryCount = 0;
  const bridge = new LiveSessionPresenceBridge({
    directory,
    pid: 123,
    terminalPath: () => "/dev/ttys007",
    tmuxRoute: () => ++queryCount === 1 ? tmux : undefined,
  });

  try {
    bridge.start(context());
    assert.deepEqual(readRecord(join(directory, "session-id.json")).tmux, tmux);
    bridge.publish(context());
    assert.equal("tmux" in readRecord(join(directory, "session-id.json")), false);
  } finally {
    bridge.stop(context());
    rmSync(directory, { recursive: true, force: true });
  }
});
