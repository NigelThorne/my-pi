import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const RELAY_ENV = "PI_PASS_THE_BUCK_HANDOFF_ID";
const MIN_RETRO_TOKENS = 16_384;
const DEFAULT_POLL_INTERVAL_MS = 750;
const SUMMARIZER_TIMEOUT_MS = 120_000;

type HandoffProtocol = {
  handoffId: string;
  createdAt: string;
  cwd: string;
  request: string;
  summary: string;
  predecessor: { sessionId: string; sessionFile: string };
  status?: "pending" | "taken-over";
  successor: { sessionId: string };
};

type RelayEvent = {
  id: string;
  timestamp: string;
  kind: "question" | "answer" | "takeover";
  requestId?: string;
  replyTo?: string;
  text?: string;
  summary?: string;
};

type LaunchOptions = {
  handoffId: string;
  cwd: string;
  successorSessionId: string;
  prompt: string;
};

type HandoffSummaryInput = {
  cwd: string;
  entries: unknown[];
  request: string;
};

type ExtensionOptions = {
  relayRoot?: string;
  createHandoffId?: () => string;
  launchSuccessor?: (options: LaunchOptions) => void;
  summarizeHandoff?: (input: HandoffSummaryInput) => Promise<string> | string;
  pollIntervalMs?: number;
};

const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

function defaultRelayRoot(): string {
  return join(homedir(), ".pi", "agent", "pass-the-buck");
}

function protocolPath(relayRoot: string, handoffId: string): string {
  return join(relayRoot, handoffId, "protocol.json");
}

function eventsPath(relayRoot: string, handoffId: string): string {
  return join(relayRoot, handoffId, "events.jsonl");
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, filePath);
}

function writeProtocol(relayRoot: string, protocol: Omit<HandoffProtocol, "createdAt"> & { createdAt?: string }): HandoffProtocol {
  const complete: HandoffProtocol = { ...protocol, createdAt: protocol.createdAt ?? new Date().toISOString() };
  writeJsonAtomically(protocolPath(relayRoot, complete.handoffId), complete);
  return complete;
}

function readProtocol(relayRoot: string, handoffId: string): HandoffProtocol | undefined {
  const filePath = protocolPath(relayRoot, handoffId);
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as HandoffProtocol;
  } catch {
    return undefined;
  }
}

function listProtocols(relayRoot: string): HandoffProtocol[] {
  if (!existsSync(relayRoot)) return [];
  try {
    return readdirSync(relayRoot, { withFileTypes: true })
      .filter((entry: { isDirectory(): boolean }) => entry.isDirectory())
      .map((entry: { name: string }) => readProtocol(relayRoot, entry.name))
      .filter((protocol: HandoffProtocol | undefined): protocol is HandoffProtocol => protocol !== undefined);
  } catch {
    return [];
  }
}

function appendEvent(
  relayRoot: string,
  handoffId: string,
  event: Omit<RelayEvent, "id" | "timestamp"> & Partial<Pick<RelayEvent, "id" | "timestamp">>,
): RelayEvent {
  const complete: RelayEvent = {
    ...event,
    id: event.id ?? randomUUID(),
    timestamp: event.timestamp ?? new Date().toISOString(),
  };
  mkdirSync(dirname(eventsPath(relayRoot, handoffId)), { recursive: true });
  appendFileSync(eventsPath(relayRoot, handoffId), `${JSON.stringify(complete)}\n`, { encoding: "utf8", mode: 0o600 });
  return complete;
}

function readEvents(relayRoot: string, handoffId: string): RelayEvent[] {
  const filePath = eventsPath(relayRoot, handoffId);
  if (!existsSync(filePath)) return [];
  try {
    return readFileSync(filePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as RelayEvent];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const HANDOFF_SUMMARY_PROMPT = `Create a concise, self-contained checkpoint for a fresh Pi session taking over this coding task. The attached JSON contains the current effective Pi context, including any earlier compaction summaries and recent work. The successor will not receive the original conversation.

Capture the goal, completed work, current working-tree state, key decisions, exact paths and commands, verification results, unresolved failures/blockers, and the next concrete steps. Preserve facts; do not invent work or claim verification that did not happen. Keep it focused and sufficiently detailed for autonomous continuation. Return only the checkpoint in Markdown.`;

function summarizerArgs(contextFile: string): string[] {
  return [
    "--print",
    "--no-session",
    "--no-tools",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--offline",
    `@${contextFile}`,
    HANDOFF_SUMMARY_PROMPT,
  ];
}

function summarizeHandoff(input: HandoffSummaryInput): string {
  const directory = mkdtempSync(join(tmpdir(), "pi-pass-the-buck-context-"));
  const contextFile = join(directory, "context.json");
  try {
    writeFileSync(contextFile, JSON.stringify({ request: input.request, entries: input.entries }), { encoding: "utf8", mode: 0o600 });
    const summary = execFileSync("pi", summarizerArgs(contextFile), {
      cwd: input.cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: SUMMARIZER_TIMEOUT_MS,
    }).trim();
    if (!summary) throw new Error("The handoff summarizer returned an empty checkpoint.");
    return summary;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function successorPrompt(protocol: HandoffProtocol): string {
  return `You are taking over an active coding task from another independent Pi session. This is a fresh session: you did not inherit the predecessor's conversation. The shared working directory contains the same files and changes.

## Handoff objective
${protocol.request || "Continue the work already underway."}

## Context checkpoint from the predecessor
${protocol.summary}

Before starting new work, assess the checkpoint and any unresolved decisions. You may call pass_the_buck_ask to ask the predecessor a focused question; wait for its response if you do. Once you have enough context and accept ownership, call pass_the_buck_take_over with a concise summary. Then continue the work autonomously. Do not call pass_the_buck_take_over until you are genuinely ready to own the task.`;
}

function successorCommand(options: LaunchOptions): string {
  const propagated = ["PTC_ALLOW_UNSANDBOXED_SUBPROCESS", "PTC_USE_DOCKER"]
    .filter((name) => process.env[name])
    .map((name) => `${name}=${shellEscape(process.env[name]!)}`);
  const environment = [`${RELAY_ENV}=${shellEscape(options.handoffId)}`, ...propagated].join(" ");
  return [
    `cd ${shellEscape(options.cwd)}`,
    `${environment} pi --session-id ${shellEscape(options.successorSessionId)} ${shellEscape(options.prompt)}`,
  ].join(" && ");
}

function currentTabId(): string {
  const paneId = process.env.ZELLIJ_PANE_ID;
  if (!paneId) throw new Error("/pass-the-buck needs Zellij so the successor can stay open beside this session.");
  const raw = execFileSync("zellij", ["action", "list-panes", "--json", "--all", "--tab"], { encoding: "utf8" });
  const panes = JSON.parse(raw) as Array<{ id: number | string; tab_id: number }>;
  const pane = panes.find((candidate) => String(candidate.id) === paneId);
  if (!pane) throw new Error(`Could not find current Zellij pane ${paneId}.`);
  return String(pane.tab_id);
}

function launchInZellij(options: LaunchOptions): void {
  const command = successorCommand(options);
  execFileSync(
    "zellij",
    [
      "action",
      "new-pane",
      "--tab-id",
      currentTabId(),
      "--direction",
      "right",
      "--name",
      "π handoff",
      "--cwd",
      options.cwd,
      "--close-on-exit",
      "--",
      "sh",
      "-lc",
      command,
    ],
    { encoding: "utf8" },
  );
}

function isPredecessor(protocol: HandoffProtocol, ctx: any): boolean {
  return protocol.predecessor.sessionId === ctx.sessionManager.getSessionId()
    || protocol.predecessor.sessionFile === ctx.sessionManager.getSessionFile();
}

function successorProtocol(relayRoot: string, ctx: any): HandoffProtocol | undefined {
  const handoffId = process.env[RELAY_ENV];
  if (!handoffId) return undefined;
  const protocol = readProtocol(relayRoot, handoffId);
  if (!protocol || protocol.status === "taken-over") return undefined;
  return protocol.successor.sessionId === ctx.sessionManager.getSessionId() ? protocol : undefined;
}

function predecessorProtocol(relayRoot: string, ctx: any): HandoffProtocol | undefined {
  return listProtocols(relayRoot)
    .filter((protocol) => isPredecessor(protocol, ctx) && protocol.status !== "taken-over")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function enoughContextForRetro(ctx: any): boolean {
  const contextWindow = ctx.model?.contextWindow;
  const usedTokens = ctx.getContextUsage?.()?.tokens;
  if (typeof contextWindow !== "number" || typeof usedTokens !== "number") return true;
  return contextWindow - usedTokens >= Math.max(MIN_RETRO_TOKENS, Math.floor(contextWindow * 0.2));
}

function waitForAnswer(
  relayRoot: string,
  handoffId: string,
  requestId: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RelayEvent | undefined> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (signal?.aborted) return finish(undefined);
      const answer = readEvents(relayRoot, handoffId).find(
        (event) => event.kind === "answer" && event.replyTo === requestId,
      );
      if (answer) return finish(answer);
      if (Date.now() >= deadline) return finish(undefined);
      timer = setTimeout(check, 100);
    };
    let timer: NodeJS.Timeout | undefined;
    const finish = (answer: RelayEvent | undefined) => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(answer);
    };
    const abort = () => finish(undefined);
    signal?.addEventListener("abort", abort, { once: true });
    check();
  });
}

export function createPassTheBuckExtension(pi: ExtensionAPI | any, options: ExtensionOptions = {}): void {
  const relayRoot = options.relayRoot ?? defaultRelayRoot();
  const createHandoffId = options.createHandoffId ?? (() => randomUUID());
  const launchSuccessor = options.launchSuccessor ?? launchInZellij;
  const createHandoffSummary = options.summarizeHandoff ?? summarizeHandoff;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const consumedEventIds = new Set<string>();
  let poller: NodeJS.Timeout | undefined;

  const remember = (eventId: string) => {
    consumedEventIds.add(eventId);
    pi.appendEntry("pass-the-buck-event", { eventId });
  };

  const stopPolling = () => {
    if (poller) clearInterval(poller);
    poller = undefined;
  };

  const startPredecessorPolling = (ctx: any) => {
    if (!predecessorProtocol(relayRoot, ctx)) return;
    stopPolling();
    poller = setInterval(() => {
      const active = predecessorProtocol(relayRoot, ctx);
      if (!active) return stopPolling();
      for (const event of readEvents(relayRoot, active.handoffId)) {
        if (consumedEventIds.has(event.id)) continue;
        remember(event.id);
        if (event.kind === "question") {
          pi.sendUserMessage(
            `The successor session asks: ${event.text}\n\nReply using the pass_the_buck_reply tool with request_id ${event.requestId}. Give it all concrete context it needs, then wait for further handoff questions.`,
            { deliverAs: "followUp" },
          );
        }
        if (event.kind === "takeover") {
          stopPolling();
          writeProtocol(relayRoot, { ...active, status: "taken-over" });
          ctx.ui.notify(`Successor accepted the handoff: ${event.summary ?? "(no summary)"}`, "info");
          if (enoughContextForRetro(ctx)) {
            pi.sendUserMessage("/retro", { deliverAs: "followUp", expandPromptTemplates: true });
          } else {
            ctx.shutdown();
          }
        }
      }
    }, pollIntervalMs);
  };

  pi.registerCommand("pass-the-buck", {
    description: "Launch an independent Pi successor and hand it the current work",
    handler: async (args: string, ctx: any) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/pass-the-buck requires interactive mode.", "error");
        return;
      }
      const predecessorSessionFile = ctx.sessionManager.getSessionFile();
      const predecessorSessionId = ctx.sessionManager.getSessionId();
      if (!predecessorSessionFile || !predecessorSessionId) {
        ctx.ui.notify("/pass-the-buck requires a saved session.", "error");
        return;
      }

      const request = args.trim() || "Continue the work already underway.";
      let summary: string;
      try {
        summary = await createHandoffSummary({
          cwd: ctx.cwd,
          entries: ctx.sessionManager.buildContextEntries?.() ?? ctx.sessionManager.getEntries?.() ?? [],
          request,
        });
        if (!summary.trim()) throw new Error("The handoff summarizer returned an empty checkpoint.");
      } catch (error) {
        ctx.ui.notify(`Could not generate a handoff checkpoint: ${error instanceof Error ? error.message : String(error)}`, "error");
        return;
      }

      const handoffId = createHandoffId();
      const protocol = writeProtocol(relayRoot, {
        handoffId,
        cwd: ctx.cwd,
        status: "pending",
        request,
        summary,
        predecessor: { sessionId: predecessorSessionId, sessionFile: predecessorSessionFile },
        successor: { sessionId: handoffId },
      });

      try {
        launchSuccessor({
          handoffId,
          cwd: ctx.cwd,
          successorSessionId: handoffId,
          prompt: successorPrompt(protocol),
        });
      } catch (error) {
        try { rmSync(join(relayRoot, handoffId), { recursive: true, force: true }); } catch {}
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        return;
      }

      ctx.ui.notify("Successor session launched. Waiting for handoff questions or takeover.", "info");
      startPredecessorPolling(ctx);
    },
  });

  pi.registerTool({
    name: "pass_the_buck_ask",
    label: "Ask Predecessor",
    description: "Ask the predecessor Pi session a focused handoff question and wait for its answer.",
    parameters: objectSchema({
      question: { type: "string", minLength: 1 },
      timeout_ms: { type: "integer", minimum: 1, maximum: 300_000 },
    }, ["question"]),
    async execute(toolCallId: string, params: { question: string; timeout_ms?: number }, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) {
      const protocol = successorProtocol(relayRoot, ctx);
      if (!protocol) throw new Error("This tool is only available to the active pass-the-buck successor session.");
      appendEvent(relayRoot, protocol.handoffId, { kind: "question", requestId: toolCallId, text: params.question });
      const answer = await waitForAnswer(relayRoot, protocol.handoffId, toolCallId, params.timeout_ms ?? 120_000, signal);
      return {
        content: [{ type: "text", text: answer?.text ?? "The predecessor did not answer before the handoff timeout." }],
        details: { handoffId: protocol.handoffId, answered: !!answer },
      };
    },
  });

  pi.registerTool({
    name: "pass_the_buck_reply",
    label: "Reply to Successor",
    description: "Reply to a specific handoff question from the successor Pi session.",
    parameters: objectSchema({
      request_id: { type: "string", minLength: 1 },
      answer: { type: "string", minLength: 1 },
    }, ["request_id", "answer"]),
    async execute(_toolCallId: string, params: { request_id: string; answer: string }, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) {
      const protocol = predecessorProtocol(relayRoot, ctx);
      if (!protocol) throw new Error("This tool is only available to the active pass-the-buck predecessor session.");
      const events = readEvents(relayRoot, protocol.handoffId);
      const hasQuestion = events.some((event) => event.kind === "question" && event.requestId === params.request_id);
      const alreadyAnswered = events.some((event) => event.kind === "answer" && event.replyTo === params.request_id);
      if (!hasQuestion || alreadyAnswered) throw new Error("request_id must reference an unanswered question from the successor.");
      appendEvent(relayRoot, protocol.handoffId, { kind: "answer", replyTo: params.request_id, text: params.answer });
      return { content: [{ type: "text", text: "Reply sent to the successor session." }], details: { handoffId: protocol.handoffId } };
    },
  });

  pi.registerTool({
    name: "pass_the_buck_take_over",
    label: "Accept Handoff",
    description: "Confirm that you have enough context and now own the handed-off task.",
    parameters: objectSchema({ summary: { type: "string", minLength: 1 } }, ["summary"]),
    async execute(_toolCallId: string, params: { summary: string }, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) {
      const protocol = successorProtocol(relayRoot, ctx);
      if (!protocol) throw new Error("This tool is only available to the active pass-the-buck successor session.");
      appendEvent(relayRoot, protocol.handoffId, { kind: "takeover", summary: params.summary });
      return { content: [{ type: "text", text: "Takeover acknowledged; the predecessor will now retire." }], details: { handoffId: protocol.handoffId } };
    },
  });

  pi.on("session_start", async (_event: unknown, ctx: any) => {
    for (const entry of ctx.sessionManager.getBranch?.() ?? []) {
      if (entry.type === "custom" && entry.customType === "pass-the-buck-event" && entry.data?.eventId) {
        consumedEventIds.add(entry.data.eventId);
      }
    }
    startPredecessorPolling(ctx);
  });

  pi.on("session_shutdown", async () => stopPolling());
}

export const __test__ = { writeProtocol, appendEvent, readEvents, successorCommand, summarizerArgs, SUMMARIZER_TIMEOUT_MS };

export default function passTheBuckExtension(pi: ExtensionAPI): void {
  createPassTheBuckExtension(pi);
}
