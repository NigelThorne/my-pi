import assert from "node:assert/strict";
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

  return {
    commands,
    tools,
    handlers,
    sentMessages,
    entries,
    registerCommand(name, definition) { commands.set(name, definition); },
    registerTool(definition) { tools.set(definition.name, definition); },
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
    pollIntervalMs: 5,
    ...options,
  });
  return { mod, pi, relayRoot };
}

test("/pass-the-buck creates a relay and launches an independent forked Pi session", async (t) => {
  const launches = [];
  const { pi, relayRoot } = await setup(t, {
    launchSuccessor: (launch) => launches.push(launch),
  });
  const ctx = makeContext();

  await pi.commands.get("pass-the-buck").handler("finish the current feature", ctx);

  const protocol = JSON.parse(fs.readFileSync(path.join(relayRoot, "handoff-test", "protocol.json"), "utf8"));
  assert.equal(protocol.predecessor.sessionId, "previous");
  assert.equal(protocol.request, "finish the current feature");
  assert.equal(protocol.successor.sessionId, "handoff-test");
  assert.equal(launches.length, 1);
  assert.equal(launches[0].predecessorSessionFile, "/tmp/previous.jsonl");
  assert.equal(launches[0].successorSessionId, "handoff-test");
  assert.match(launches[0].prompt, /full conversation was forked/i);
  assert.match(launches[0].prompt, /pass_the_buck_ask/i);
  assert.deepEqual(ctx.notifications, [{ message: "Successor session launched. Waiting for handoff questions or takeover.", type: "info" }]);
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
  assert.match(command, /--session-id 'successor' --fork '\/tmp\/previous\.jsonl'/);
});

test("successor can ask the predecessor a question and receive its reply", async (t) => {
  const { mod, pi, relayRoot } = await setup(t);
  mod.__test__.writeProtocol(relayRoot, {
    handoffId: "handoff-test",
    predecessor: { sessionId: "previous", sessionFile: "/tmp/previous.jsonl" },
    successor: { sessionId: "successor" },
    cwd: "/work/project",
    request: "continue",
  });
  const original = process.env.PI_PASS_THE_BUCK_HANDOFF_ID;
  process.env.PI_PASS_THE_BUCK_HANDOFF_ID = "handoff-test";
  t.after(() => { process.env.PI_PASS_THE_BUCK_HANDOFF_ID = original; });

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
  });
  const ctx = makeContext({ contextTokens: 190_000, contextWindow: 200_000 });
  await pi.handlers.get("session_start")({ reason: "startup" }, ctx);
  mod.__test__.appendEvent(relayRoot, "handoff-test", { kind: "takeover", summary: "Done." });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(ctx.shutdowns, 1);
  assert.equal(pi.sentMessages.length, 0);
  await pi.handlers.get("session_shutdown")({}, ctx);
});
