import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const extensionUrl = new URL("./index.ts", import.meta.url);

function makePi() {
  const commands = new Map();
  const tools = new Map();
  const handlers = new Map();
  const sentMessages = [];
  const entries = [];
  let activeTools = ["read", "bash", "subagent_done"];

  return {
    commands,
    tools,
    handlers,
    sentMessages,
    entries,
    registerCommand(name, definition) { commands.set(name, definition); },
    registerTool(definition) {
      tools.set(definition.name, definition);
      activeTools.push(definition.name);
    },
    getActiveTools() { return [...activeTools]; },
    setActiveTools(names) { activeTools = [...names]; },
    on(name, handler) { handlers.set(name, handler); },
    sendUserMessage(message, options) { sentMessages.push({ message, options }); },
    appendEntry(type, data) { entries.push({ type, data }); },
  };
}

function makeContext({
  sessionId = "previous",
  sessionFile = "/tmp/previous.jsonl",
  contextTokens = 10_000,
  contextWindow = 200_000,
} = {}) {
  const notifications = [];
  let shutdowns = 0;
  return {
    mode: "tui",
    cwd: "/work/project",
    model: { contextWindow },
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => sessionFile,
      getEntries: () => [],
      buildContextEntries: () => [{ type: "message", message: { role: "user", content: "Current task details" } }],
    },
    getContextUsage: () => ({ tokens: contextTokens }),
    shutdown: () => { shutdowns += 1; },
    get shutdowns() { return shutdowns; },
    ui: { notify(message, type) { notifications.push({ message, type }); } },
    notifications,
  };
}

async function setup(t, options = {}) {
  const relayRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-pass-the-buck-"));
  t.after(() => fs.rmSync(relayRoot, { recursive: true, force: true }));
  const mod = await import(`${extensionUrl.href}?${Math.random()}`);
  const pi = makePi();
  mod.createPassTheBuckExtension(pi, {
    relayRoot,
    createHandoffId: () => "handoff-test",
    summarizeHandoff: async () => "Default handoff checkpoint.",
    pollIntervalMs: 5,
    ...options,
  });
  t.after(() => pi.handlers.get("session_shutdown")({}, makeContext()));
  return { mod, pi, relayRoot };
}

function setHandoffEnv(t, value) {
  const previous = process.env.PI_PASS_THE_BUCK_HANDOFF_ID;
  if (value === undefined) delete process.env.PI_PASS_THE_BUCK_HANDOFF_ID;
  else process.env.PI_PASS_THE_BUCK_HANDOFF_ID = value;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_PASS_THE_BUCK_HANDOFF_ID;
    else process.env.PI_PASS_THE_BUCK_HANDOFF_ID = previous;
  });
}

function seedHandoff(mod, relayRoot, extra = {}) {
  return mod.__test__.writeProtocol(relayRoot, {
    handoffId: "handoff-test",
    predecessor: { sessionId: "previous", sessionFile: "/tmp/previous.jsonl" },
    successor: { sessionId: "successor" },
    cwd: "/work/project",
    request: "continue",
    summary: "Checkpoint.",
    status: "pending",
    ...extra,
  });
}

const ordinaryTools = ["read", "bash", "subagent_done"];

test("ordinary sessions hide all handoff tools without changing unrelated tools", async (t) => {
  setHandoffEnv(t, undefined);
  const { pi } = await setup(t);
  await pi.handlers.get("session_start")({}, makeContext());
  assert.deepEqual(pi.getActiveTools(), ordinaryTools);
});

test("only the exact pending successor sees ask and takeover, including after reload", async (t) => {
  setHandoffEnv(t, "handoff-test");
  const { pi, mod, relayRoot } = await setup(t);
  seedHandoff(mod, relayRoot);
  await pi.handlers.get("session_start")({ reason: "reload" }, makeContext({ sessionId: "successor", sessionFile: "/tmp/successor.jsonl" }));
  assert.deepEqual(pi.getActiveTools(), [...ordinaryTools, "pass_the_buck_ask", "pass_the_buck_take_over"]);
});

for (const state of ["wrong-session", "missing-protocol", "completed", "takeover-recorded"]) {
  test(`handoff tools stay hidden for ${state}`, async (t) => {
    setHandoffEnv(t, "handoff-test");
    const { pi, mod, relayRoot } = await setup(t);
    if (state !== "missing-protocol") seedHandoff(mod, relayRoot, state === "completed" ? { status: "taken-over" } : {});
    if (state === "takeover-recorded") mod.__test__.appendEvent(relayRoot, "handoff-test", { kind: "takeover", summary: "Accepted" });
    await pi.handlers.get("session_start")({}, makeContext({ sessionId: state === "wrong-session" ? "ordinary-child" : "successor", sessionFile: "/tmp/child.jsonl" }));
    assert.deepEqual(pi.getActiveTools(), ordinaryTools);
  });
}

test("launch enables only predecessor reply and takeover polling removes it", async (t) => {
  setHandoffEnv(t, undefined);
  const { pi, mod, relayRoot } = await setup(t, { launchSuccessor() {} });
  const ctx = makeContext();
  await pi.handlers.get("session_start")({}, ctx);
  assert.deepEqual(pi.getActiveTools(), ordinaryTools);
  await pi.commands.get("pass-the-buck").handler("continue", ctx);
  assert.deepEqual(pi.getActiveTools(), [...ordinaryTools, "pass_the_buck_reply"]);
  mod.__test__.appendEvent(relayRoot, "handoff-test", { kind: "takeover", summary: "Accepted" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(pi.getActiveTools(), ordinaryTools);
});

test("pending predecessor regains reply on reload", async (t) => {
  setHandoffEnv(t, undefined);
  const { pi, mod, relayRoot } = await setup(t);
  seedHandoff(mod, relayRoot);
  await pi.handlers.get("session_start")({ reason: "reload" }, makeContext());
  assert.deepEqual(pi.getActiveTools(), [...ordinaryTools, "pass_the_buck_reply"]);
});

test("takeover immediately hides successor tools without consuming predecessor retirement", async (t) => {
  setHandoffEnv(t, "handoff-test");
  const { pi, mod, relayRoot } = await setup(t);
  seedHandoff(mod, relayRoot);
  const ctx = makeContext({ sessionId: "successor", sessionFile: "/tmp/successor.jsonl" });
  await pi.handlers.get("session_start")({}, ctx);
  await pi.tools.get("pass_the_buck_take_over").execute("accept", { summary: "Ready" }, undefined, undefined, ctx);
  assert.deepEqual(pi.getActiveTools(), ordinaryTools);
  assert.equal(JSON.parse(fs.readFileSync(path.join(relayRoot, "handoff-test", "protocol.json"))).status, "pending");
  await assert.rejects(pi.tools.get("pass_the_buck_ask").execute("late", { question: "Too late", timeout_ms: 1 }, undefined, undefined, ctx), /active pass-the-buck successor/);
});

test("visibility respects tools disabled by the caller", async (t) => {
  setHandoffEnv(t, undefined);
  const { pi } = await setup(t, { launchSuccessor() {} });
  pi.setActiveTools(["read"]);
  const ctx = makeContext();
  await pi.handlers.get("session_start")({}, ctx);
  await pi.commands.get("pass-the-buck").handler("continue", ctx);
  assert.deepEqual(pi.getActiveTools(), ["read"]);
});

test("turn refresh removes a handoff that completed externally", async (t) => {
  setHandoffEnv(t, "handoff-test");
  const { pi, mod, relayRoot } = await setup(t);
  seedHandoff(mod, relayRoot);
  const ctx = makeContext({ sessionId: "successor", sessionFile: "/tmp/successor.jsonl" });
  await pi.handlers.get("session_start")({}, ctx);
  seedHandoff(mod, relayRoot, { status: "taken-over" });
  assert.equal(typeof pi.handlers.get("turn_start"), "function");
  await pi.handlers.get("turn_start")({}, ctx);
  assert.deepEqual(pi.getActiveTools(), ordinaryTools);
});

test("turn refresh preserves unrelated tool changes and manual handoff disabling", async (t) => {
  setHandoffEnv(t, "handoff-test");
  const { pi, mod, relayRoot } = await setup(t);
  seedHandoff(mod, relayRoot);
  const ctx = makeContext({ sessionId: "successor", sessionFile: "/tmp/successor.jsonl" });
  await pi.handlers.get("session_start")({}, ctx);
  pi.setActiveTools(["read", "new_tool", "pass_the_buck_take_over"]);
  await pi.handlers.get("turn_start")({}, ctx);
  assert.deepEqual(pi.getActiveTools(), ["read", "new_tool", "pass_the_buck_take_over"]);
});

test("stale ordinary-child calls explain the prerequisite without writing relay events", async (t) => {
  setHandoffEnv(t, undefined);
  const { pi, relayRoot } = await setup(t);
  await assert.rejects(pi.tools.get("pass_the_buck_ask").execute("ask", { question: "Parent?" }, undefined, undefined, makeContext()), /not a parent permission setting/);
  assert.deepEqual(fs.readdirSync(relayRoot), []);
});

test("ordinary subagents get accurate parent communication guidance", async (t) => {
  setHandoffEnv(t, undefined);
  const previous = process.env.PI_SUBAGENT_NAME;
  process.env.PI_SUBAGENT_NAME = "worker";
  t.after(() => {
    if (previous === undefined) delete process.env.PI_SUBAGENT_NAME;
    else process.env.PI_SUBAGENT_NAME = previous;
  });
  const { pi } = await setup(t);
  assert.equal(typeof pi.handlers.get("before_agent_start"), "function");
  const result = await pi.handlers.get("before_agent_start")({ systemPrompt: "Existing instructions" }, makeContext());
  assert.match(result.systemPrompt, /^Existing instructions/);
  assert.match(result.systemPrompt, /subagent_done/);
  assert.match(result.systemPrompt, /blocker/);
  assert.match(result.systemPrompt, /pass_the_buck_.*not|not.*pass_the_buck_/);
  assert.match(result.systemPrompt, /subagent_steer.*parent-to-child/);

  pi.setActiveTools(["read"]);
  assert.equal(await pi.handlers.get("before_agent_start")({ systemPrompt: "Base" }, makeContext()), undefined);
  delete process.env.PI_SUBAGENT_NAME;
  pi.setActiveTools(ordinaryTools);
  assert.equal(await pi.handlers.get("before_agent_start")({ systemPrompt: "Base" }, makeContext()), undefined);
});

test("/pass-the-buck launches a fresh successor with a generated handoff checkpoint", async (t) => {
  const launches = [];
  const summaries = [];
  const { pi, relayRoot } = await setup(t, {
    summarizeHandoff: async (input) => {
      summaries.push(input);
      return "## Goal\nFinish the current feature\n\n## Progress\nRelay is implemented.";
    },
    launchSuccessor: (launch) => launches.push(launch),
  });
  const ctx = makeContext();

  await pi.commands.get("pass-the-buck").handler("finish the current feature", ctx);

  const protocol = JSON.parse(fs.readFileSync(path.join(relayRoot, "handoff-test", "protocol.json"), "utf8"));
  assert.equal(protocol.predecessor.sessionId, "previous");
  assert.equal(protocol.request, "finish the current feature");
  assert.match(protocol.summary, /Relay is implemented/);
  assert.equal(fs.statSync(path.join(relayRoot, "handoff-test", "protocol.json")).mode & 0o777, 0o600);
  assert.equal(protocol.successor.sessionId, "handoff-test");
  assert.deepEqual(summaries, [{
    cwd: "/work/project",
    entries: [{ type: "message", message: { role: "user", content: "Current task details" } }],
    request: "finish the current feature",
  }]);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].successorSessionId, "handoff-test");
  assert.match(launches[0].prompt, /Relay is implemented/);
  assert.doesNotMatch(launches[0].prompt, /full conversation was forked/i);
  assert.match(launches[0].prompt, /pass_the_buck_ask/i);
  assert.deepEqual(ctx.notifications, [{ message: "Successor session launched. Waiting for handoff questions or takeover.", type: "info" }]);
});

test("an ambiguous launch timeout retains its relay and blocks another successor", async (t) => {
  let launches = 0;
  const { pi, relayRoot } = await setup(t, {
    launchSuccessor: () => {
      launches += 1;
      throw Object.assign(new Error("tmux timed out after accepting split"), { code: "ETIMEDOUT" });
    },
  });
  const ctx = makeContext();
  await pi.commands.get("pass-the-buck").handler("continue", ctx);
  assert.equal(fs.existsSync(path.join(relayRoot, "handoff-test", "protocol.json")), true);
  await pi.commands.get("pass-the-buck").handler("retry", ctx);
  assert.equal(launches, 1);
  assert.match(ctx.notifications[0].message, /unknown|unconfirmed/i);
  assert.match(ctx.notifications.at(-1).message, /pending/i);
});

test("a definite rejected launch can be retried without leaving a pending relay", async (t) => {
  let launches = 0;
  const { pi, relayRoot } = await setup(t, {
    launchSuccessor: () => { launches += 1; throw new Error("no supported mux"); },
  });
  const ctx = makeContext();
  await pi.commands.get("pass-the-buck").handler("continue", ctx);
  assert.equal(fs.existsSync(path.join(relayRoot, "handoff-test")), false);
  await pi.commands.get("pass-the-buck").handler("retry", ctx);
  assert.equal(launches, 2);
});

test("concurrent checkpoints do not launch two successors", async (t) => {
  let launches = 0;
  let release;
  const checkpoint = new Promise((resolve) => { release = resolve; });
  const { pi } = await setup(t, {
    summarizeHandoff: () => checkpoint,
    launchSuccessor: () => { launches += 1; },
  });
  const ctx = makeContext();
  const first = pi.commands.get("pass-the-buck").handler("first", ctx);
  const second = pi.commands.get("pass-the-buck").handler("second", ctx);
  release("checkpoint");
  await Promise.all([first, second]);
  assert.equal(launches, 1);
});

test("successor launch preserves extension-critical PTC environment variables", async (t) => {
  const { mod } = await setup(t);
  const previousDocker = process.env.PTC_USE_DOCKER;
  process.env.PTC_USE_DOCKER = "1";
  t.after(() => {
    if (previousDocker === undefined) delete process.env.PTC_USE_DOCKER;
    else process.env.PTC_USE_DOCKER = previousDocker;
  });

  const command = mod.__test__.successorCommand({
    handoffId: "handoff-test",
    cwd: "/work/project",
    predecessorSessionFile: "/tmp/previous.jsonl",
    successorSessionId: "successor",
    prompt: "take over",
  });

  assert.match(command, /PTC_USE_DOCKER='1'/);
  assert.match(command, /--session-id 'successor'/);
  assert.doesNotMatch(command, /--fork/);

  const summaryArgs = mod.__test__.summarizerArgs("/tmp/context.json");
  assert.deepEqual(summaryArgs.slice(0, 7), [
    "--print",
    "--no-session",
    "--no-tools",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
  ]);
  assert.ok(summaryArgs.includes("--offline"));
  assert.ok(summaryArgs.includes("@/tmp/context.json"));
  assert.equal(mod.__test__.SUMMARIZER_TIMEOUT_MS, 120_000);
});

test("tmux successor launches directly beside the exact parent pane with the requested cwd", async (t) => {
  const { mod } = await setup(t);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-pass-the-buck-tmux-"));
  const socketPath = path.join(root, "tmux.sock");
  const parentCwd = path.join(root, "parent cwd");
  const childCwd = path.join(root, "child cwd");
  const binDir = path.join(root, "bin");
  const observedPath = path.join(root, "observed.json");
  fs.mkdirSync(parentCwd);
  fs.mkdirSync(childCwd);
  fs.mkdirSync(binDir);
  fs.writeFileSync(path.join(binDir, "pi"), `#!/bin/sh\nprintf '{"cwd":"%s","session":"%s","prompt":"%s","handoff":"%s"}\\n' "$PWD" "$2" "$3" "$PI_PASS_THE_BUCK_HANDOFF_ID" > ${JSON.stringify(observedPath)}\nsleep 30\n`, { mode: 0o755 });

  const tmux = path.join(execFileSync("mise", ["where", "tmux@3.6a"], { encoding: "utf8", timeout: 5_000 }).trim(), "bin", "tmux");
  const runTmux = (args) => execFileSync(tmux, ["-S", socketPath, ...args], { encoding: "utf8", timeout: 5_000 }).trim();
  runTmux(["-f", "/dev/null", "new-session", "-d", "-s", "handoff-test", "-n", "parent", "-c", parentCwd, "sleep", "30"]);
  t.after(() => {
    try { runTmux(["kill-server"]); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  });
  const parentPane = runTmux(["display-message", "-p", "-t", "handoff-test:parent", "#{pane_id}"]);
  const parentWindow = runTmux(["display-message", "-p", "-t", parentPane, "#{window_id}"]);
  runTmux(["new-window", "-d", "-t", "handoff-test:", "-n", "other", "sleep", "30"]);

  const childPane = mod.__test__.launchInTmux({
    handoffId: "handoff-test",
    cwd: childCwd,
    successorSessionId: "successor",
    prompt: "take over; don't expand $HOME",
  }, {
    env: {
      ...process.env,
      TMUX: `${socketPath},123,0`,
      TMUX_PANE: parentPane,
      PATH: `${binDir}:${process.env.PATH}`,
      OBSERVED_PATH: observedPath,
    },
    tmuxExecutable: tmux,
  });

  const childWindow = runTmux(["display-message", "-p", "-t", childPane, "#{window_id}"]);
  assert.equal(childWindow, parentWindow);
  assert.equal(runTmux(["display-message", "-p", "-t", childPane, "#{pane_current_path}"]), fs.realpathSync(childCwd));
  for (let attempt = 0; attempt < 50 && !fs.existsSync(observedPath); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(observedPath, "utf8")), {
    cwd: childCwd,
    session: "successor",
    prompt: "take over; don't expand $HOME",
    handoff: "handoff-test",
  });
});

test("tmux successor IPC has a bounded timeout", async (t) => {
  const { mod } = await setup(t);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-pass-the-buck-timeout-"));
  const fakeTmux = path.join(root, "tmux");
  fs.writeFileSync(fakeTmux, "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const started = Date.now();

  assert.throws(() => mod.__test__.launchInTmux({
    handoffId: "handoff-test",
    cwd: root,
    successorSessionId: "successor",
    prompt: "take over",
  }, {
    env: { ...process.env, TMUX: `${root}/socket,123,0`, TMUX_PANE: "%1" },
    tmuxExecutable: fakeTmux,
    timeoutMs: 100,
  }), (error) => {
    assert.match(error.message, /timed out/i);
    assert.equal(error.code, "ETIMEDOUT");
    return true;
  });
  assert.ok(Date.now() - started < 2_000);
});

test("successor can ask the predecessor a question and receive its reply", async (t) => {
  const { mod, pi, relayRoot } = await setup(t);
  mod.__test__.writeProtocol(relayRoot, {
    handoffId: "handoff-test",
    predecessor: { sessionId: "previous", sessionFile: "/tmp/previous.jsonl" },
    successor: { sessionId: "successor" },
    cwd: "/work/project",
    request: "continue",
    summary: "Default handoff checkpoint.",
  });
  const original = process.env.PI_PASS_THE_BUCK_HANDOFF_ID;
  process.env.PI_PASS_THE_BUCK_HANDOFF_ID = "handoff-test";
  t.after(() => {
    if (original === undefined) delete process.env.PI_PASS_THE_BUCK_HANDOFF_ID;
    else process.env.PI_PASS_THE_BUCK_HANDOFF_ID = original;
  });

  setTimeout(() => {
    mod.__test__.appendEvent(relayRoot, "handoff-test", {
      kind: "answer",
      replyTo: "question-1",
      text: "Use the existing relay protocol.",
    });
  }, 10);

  const result = await pi.tools.get("pass_the_buck_ask").execute(
    "question-1",
    { question: "What should I use?", timeout_ms: 100 },
    new AbortController().signal,
    undefined,
    makeContext({ sessionId: "successor", sessionFile: "/tmp/successor.jsonl" }),
  );

  assert.match(result.content[0].text, /Use the existing relay protocol/);
});

test("predecessor starts polling immediately after it launches the successor", async (t) => {
  const { mod, pi, relayRoot } = await setup(t, { launchSuccessor() {} });
  const ctx = makeContext({ contextTokens: 20_000, contextWindow: 200_000 });
  await pi.commands.get("pass-the-buck").handler("continue", ctx);

  mod.__test__.appendEvent(relayRoot, "handoff-test", {
    id: "question-event",
    kind: "question",
    requestId: "question-1",
    text: "Which tests matter?",
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(pi.sentMessages[0].message, /Which tests matter/);
  assert.match(pi.sentMessages[0].message, /pass_the_buck_reply/);

  const reply = await pi.tools.get("pass_the_buck_reply").execute(
    "reply-1",
    { request_id: "question-1", answer: "Run the extension test." },
    new AbortController().signal,
    undefined,
    ctx,
  );
  assert.match(reply.content[0].text, /sent/i);
  await assert.rejects(
    pi.tools.get("pass_the_buck_reply").execute(
      "reply-2",
      { request_id: "not-a-question", answer: "This must not be sent." },
      new AbortController().signal,
      undefined,
      ctx,
    ),
    /unanswered question/,
  );

  mod.__test__.appendEvent(relayRoot, "handoff-test", {
    id: "takeover-event",
    kind: "takeover",
    summary: "I have it from here.",
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(pi.sentMessages.at(-1), {
    message: "/retro",
    options: { deliverAs: "followUp", expandPromptTemplates: true },
  });

  await pi.handlers.get("session_shutdown")({}, ctx);
});

test("predecessor shuts down instead of running retro when context headroom is low", async (t) => {
  const { mod, pi, relayRoot } = await setup(t);
  mod.__test__.writeProtocol(relayRoot, {
    handoffId: "handoff-test",
    predecessor: { sessionId: "previous", sessionFile: "/tmp/previous.jsonl" },
    successor: { sessionId: "successor" },
    cwd: "/work/project",
    request: "continue",
    summary: "Default handoff checkpoint.",
  });
  const ctx = makeContext({ contextTokens: 190_000, contextWindow: 200_000 });
  await pi.handlers.get("session_start")({ reason: "startup" }, ctx);
  mod.__test__.appendEvent(relayRoot, "handoff-test", { kind: "takeover", summary: "Done." });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(ctx.shutdowns, 1);
  assert.equal(pi.sentMessages.length, 0);
  await pi.handlers.get("session_shutdown")({}, ctx);
});
