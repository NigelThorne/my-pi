import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, appendFileSync, constants, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { isAbsolute, join } from "node:path";

const sessionManagerDirectory = join(process.env.HOME ?? "/tmp", ".pi", "agent", "session-manager");
const registryDirectory = join(sessionManagerDirectory, "live");
const launchDirectory = join(sessionManagerDirectory, "launches");
const heartbeatIntervalMs = 15_000;
const sessionMetadataRetryMs = 100;
const ghosttyOsaScriptTimeoutMs = 2_000;
const tmuxQueryTimeoutMs = 500;
// Printable separators survive tmux's control-character sanitization without a UTF-8 locale.
const tmuxRouteFormat = "#{pid}|#{session_id}|#{window_id}|#{pane_id}";
const tmuxClientFormat = "#{client_pid}|#{client_tty}|#{session_id}|#{window_id}|#{pane_id}";
let lastTmuxRouteDiagnostic: string | undefined;
const indexerServiceProtocolVersion = 1;
const indexerServiceSocketPathEnvironmentKey = "PI_SESSION_MANAGER_SERVICE_SOCKET_PATH";
const firstMessageSource = "pi-session-manager-presence";
const firstMessageMaximumBytes = 4_096;
const firstMessageReplyMaximumBytes = 16_384;
const firstMessageSocketDeadlineMs = 250;
const firstMessageRetryDelaysMs = [0, 100, 500] as const;
const presenceEntryType = "pi-session-manager-presence";
const presencePublishedEvent = "presence_published";
const presenceSource = "pi-session-manager-presence";
const windowBindingEntryType = "pi-session-manager-window-binding";
const windowBindingEvent = "ghostty_binding";
const windowBindingEndedEvent = "ghostty_binding_ended";
const windowBindingSource = "pi-session-manager-presence";

function defaultIndexerServiceSocketPath(): string {
  const configured = process.env[indexerServiceSocketPathEnvironmentKey]?.trim();
  if (configured) return configured;
  return join(process.env.HOME ?? "/tmp", "Library", "Application Support", "PiSessionManager", "service", "indexer.sock");
}

type PresenceState = "idle" | "processing" | "stopped";
type PresenceContext = Pick<ExtensionContext, "cwd" | "isIdle" | "sessionManager">;
type RegisterWindowContext = PresenceContext & Pick<ExtensionContext, "hasUI">;
type FirstMessageContext = Pick<ExtensionContext, "cwd" | "sessionManager">;

type FirstMessageRequest = {
  type: "firstMessage";
  protocol: 1;
  requestID: string;
  source: typeof firstMessageSource;
  sessionID: string;
  sessionFile: string;
  cwd: string;
  firstLine: string;
  observedAt: number;
};

type FirstMessageAck = {
  type: "firstMessageAck";
  protocol: 1;
  requestID: string;
  status: "accepted" | "duplicate" | "conflict" | "rejected";
};

type PendingFirstMessage = {
  firstLine: string;
  observedAt: number;
  requestID: string;
  sessionID: string;
  sessionFile?: string;
  resolveSessionFile: () => string | undefined;
  cwd: string;
  attempts: number;
  timer?: ReturnType<typeof setTimeout>;
  abortController?: AbortController;
  finished: boolean;
};
type PendingPresencePublish = {
  ctx: PresenceContext;
  state: PresenceState;
};

type CurrentGhosttySurfaceIdentity = {
  appPID?: number;
  windowID?: string;
  terminalID?: string;
  parentTTY?: string;
};

type CompleteGhosttySurfaceIdentity = {
  appPID: number;
  windowID: string;
  terminalID: string;
  parentTTY?: string;
};

type ManagedGhosttyBinding = CompleteGhosttySurfaceIdentity & {
  sessionID: string;
  sessionFile: string;
  cwd: string;
};

type ManagedGhosttyBindingEvent = ManagedGhosttyBinding & {
  event: typeof windowBindingEvent | typeof windowBindingEndedEvent;
};

export type TmuxPresenceRoute = {
  socketPath: string;
  serverPID: number;
  serverStartTime: string;
  sessionID: string;
  windowID: string;
  paneID: string;
};

type PresencePublication = {
  sessionID: string;
  sessionFile: string;
  cwd: string;
  state: PresenceState;
  tty?: string;
  workspace?: string;
  zellijPaneID?: string;
  tmux?: TmuxPresenceRoute;
  ghosttyAppPID?: number;
  ghosttyWindowID?: string;
  ghosttyTerminalID?: string;
  ghosttyParentTTY?: string;
};

type ResolveTmuxRouteOptions = {
  tmuxEnvironment?: string;
  tmuxPaneID?: string;
  tmuxExecutable?: string;
  environment?: NodeJS.ProcessEnv;
  isExecutable?: (path: string) => boolean;
  onDiagnostic?: (message: string) => void;
  execFile?: (command: string, args: string[], options: Record<string, unknown>) => string;
};

type RegisterWindowResult = {
  ok: boolean;
  message: string;
};

type ActiveGhosttySurfaceResult =
  | { ok: true; identity: CompleteGhosttySurfaceIdentity }
  | { ok: false; reason: "not-frontmost" | "invalid" | "changed" | "ambiguous" | "unavailable" };

type ResolveActiveGhosttySurfaceOptions = {
  execFile?: (command: string, args: string[], options: Record<string, unknown>) => string;
};

type ResolveTmuxGhosttyClientOptions = {
  tmuxExecutable?: string;
  environment?: NodeJS.ProcessEnv;
  execFile?: (command: string, args: string[], options: Record<string, unknown>) => string;
};

type AdvisoryPokeStream = "presence" | "launch";

type LiveSessionPresenceBridgeOptions = {
  directory?: string;
  launchDirectory?: string;
  serviceSocketPath?: string;
  pid?: number;
  now?: () => number;
  terminalPath?: () => string | undefined;
  workspace?: () => string | undefined;
  zellijPaneID?: () => string | undefined;
  tmuxRuntime?: () => boolean;
  tmuxRoute?: () => TmuxPresenceRoute | undefined;
  managedGhosttyIdentity?: () => CurrentGhosttySurfaceIdentity;
  resolveActiveGhosttySurface?: () => ActiveGhosttySurfaceResult;
  resolveTmuxGhosttyClient?: (route: TmuxPresenceRoute, appPID: number) => string | undefined;
  directGhosttyAncestryMatches?: (appPID: number) => boolean;
  onManagedGhosttyBinding?: (binding: ManagedGhosttyBindingEvent) => void;
  onPresencePublished?: (publication: PresencePublication) => void;
  appendPresenceHistory?: (path: string, line: string) => void;
  writeTerminalTitleSequence?: (value: string) => boolean | void;
  sendAdvisoryPoke?: (stream: AdvisoryPokeStream) => void;
  heartbeatIntervalMs?: number;
  sessionMetadataRetryMs?: number;
  sendFirstMessage?: (request: FirstMessageRequest, signal?: AbortSignal) => Promise<FirstMessageAck | undefined>;
  firstMessageRetryDelaysMs?: readonly number[];
  firstMessageRearmDelayMs?: number;
};

function truncateUtf8(value: string, maximumBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maximumBytes) return value;
  let end = maximumBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

export function firstNonblankLine(value: string): string | undefined {
  for (const line of value.split(/\r?\n|\r/)) {
    const trimmed = line.trim();
    if (trimmed) return truncateUtf8(trimmed, firstMessageMaximumBytes);
  }
  return undefined;
}

function userMessageText(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const candidate = entry as { type?: unknown; message?: { role?: unknown; content?: unknown } };
  if (candidate.type !== "message" || candidate.message?.role !== "user") return undefined;
  const content = candidate.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  return content
    .filter((part): part is { type: "text"; text: string } => !!part && typeof part === "object"
      && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string")
    .map((part) => part.text)
    .join("\n");
}

function historicalFirstLine(ctx: FirstMessageContext): { found: boolean; firstLine?: string } {
  for (const entry of ctx.sessionManager.getEntries()) {
    const text = userMessageText(entry);
    if (text !== undefined) return { found: true, firstLine: firstNonblankLine(text) };
  }
  return { found: false };
}

function validFirstMessageAck(value: unknown, request: FirstMessageRequest): value is FirstMessageAck {
  if (!value || typeof value !== "object") return false;
  const ack = value as Partial<FirstMessageAck>;
  return ack.type === "firstMessageAck" && ack.protocol === 1 && ack.requestID === request.requestID
    && ["accepted", "duplicate", "conflict", "rejected"].includes(ack.status ?? "");
}

export function sendFirstMessageToIndexer(
  socketPath: string,
  request: FirstMessageRequest,
  signal?: AbortSignal,
): Promise<FirstMessageAck | undefined> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    let settled = false;
    let reply = Buffer.alloc(0);
    const finish = (ack?: FirstMessageAck) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      resolve(ack);
    };
    const onAbort = () => finish();
    const deadline = setTimeout(() => finish(), firstMessageSocketDeadlineMs);
    deadline.unref?.();
    if (signal?.aborted) return finish();
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.on("error", () => finish());
    socket.on("connect", () => socket.write(JSON.stringify(request) + "\n"));
    socket.on("data", (chunk: Buffer) => {
      reply = Buffer.concat([reply, chunk]);
      if (reply.length > firstMessageReplyMaximumBytes) return finish();
      const newline = reply.indexOf(0x0a);
      if (newline < 0) return;
      try {
        const parsed = JSON.parse(reply.subarray(0, newline).toString("utf8"));
        finish(validFirstMessageAck(parsed, request) ? parsed : undefined);
      } catch {
        finish();
      }
    });
    socket.on("end", () => finish());
    socket.unref?.();
  });
}

export class FirstMessagePublisher {
  private readonly send: (request: FirstMessageRequest, signal?: AbortSignal) => Promise<FirstMessageAck | undefined>;
  private readonly retryDelays: readonly number[];
  private readonly rearmDelayMs: number;
  private readonly pendingBySessionID = new Map<string, PendingFirstMessage>();
  private readonly completedSessionIDs = new Set<string>();
  private stopped = false;

  constructor(options: LiveSessionPresenceBridgeOptions = {}) {
    const socketPath = options.serviceSocketPath ?? defaultIndexerServiceSocketPath();
    this.send = options.sendFirstMessage ?? ((request, signal) => sendFirstMessageToIndexer(socketPath, request, signal));
    this.retryDelays = options.firstMessageRetryDelaysMs ?? firstMessageRetryDelaysMs;
    this.rearmDelayMs = options.firstMessageRearmDelayMs ?? heartbeatIntervalMs;
  }

  start(ctx: FirstMessageContext): void {
    this.stopped = false;
    const sessionID = ctx.sessionManager.getSessionId();
    if (!sessionID || this.known(sessionID)) return;
    const historical = historicalFirstLine(ctx);
    if (historical.found && !historical.firstLine) {
      this.completedSessionIDs.add(sessionID);
      return;
    }
    this.capture(historical.firstLine, ctx, sessionID);
  }

  capturePrompt(event: BeforeAgentStartEvent, ctx: FirstMessageContext): void {
    if (event.messageType !== "user") return;
    const sessionID = ctx.sessionManager.getSessionId();
    if (!sessionID || this.known(sessionID)) return;
    const historical = historicalFirstLine(ctx);
    if (historical.found && !historical.firstLine) {
      this.completedSessionIDs.add(sessionID);
      return;
    }
    const firstLine = historical.found ? historical.firstLine : firstNonblankLine(event.prompt);
    if (!firstLine) {
      this.completedSessionIDs.add(sessionID);
      return;
    }
    this.capture(firstLine, ctx, sessionID);
  }

  rearm(ctx: FirstMessageContext): void {
    const sessionID = ctx.sessionManager.getSessionId();
    if (!sessionID) return;
    const pending = this.pendingBySessionID.get(sessionID);
    if (!pending || pending.finished || pending.abortController) return;
    if (!pending.sessionFile) {
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (sessionFile) pending.sessionFile = sessionFile;
    }
    if (pending.attempts >= this.retryDelays.length) pending.attempts = 0;
    this.schedule(pending);
  }

  stop(): void {
    this.stopped = true;
    for (const pending of this.pendingBySessionID.values()) {
      pending.finished = true;
      if (pending.timer) clearTimeout(pending.timer);
      pending.abortController?.abort();
    }
    this.pendingBySessionID.clear();
  }

  private known(sessionID: string): boolean {
    return this.completedSessionIDs.has(sessionID) || this.pendingBySessionID.has(sessionID);
  }

  private capture(firstLine: string | undefined, ctx: FirstMessageContext, sessionID: string): void {
    if (!firstLine || this.stopped || this.known(sessionID)) return;
    const pending: PendingFirstMessage = {
      firstLine,
      observedAt: Date.now() / 1_000,
      requestID: randomUUID(),
      sessionID,
      sessionFile: ctx.sessionManager.getSessionFile(),
      resolveSessionFile: () => ctx.sessionManager.getSessionId() === sessionID
        ? ctx.sessionManager.getSessionFile()
        : undefined,
      cwd: ctx.cwd,
      attempts: 0,
      finished: false,
    };
    this.pendingBySessionID.set(sessionID, pending);
    this.schedule(pending);
  }

  private schedule(pending: PendingFirstMessage): void {
    if (this.stopped || pending.finished || pending.timer || pending.abortController) return;
    let delay = this.retryDelays[pending.attempts];
    if (delay === undefined) {
      pending.attempts = 0;
      delay = this.rearmDelayMs;
    }
    pending.timer = setTimeout(() => {
      pending.timer = undefined;
      if (this.stopped || pending.finished) return;
      if (!pending.sessionFile) {
        pending.sessionFile = pending.resolveSessionFile();
        if (!pending.sessionFile) {
          pending.attempts += 1;
          this.schedule(pending);
          return;
        }
      }
      const request: FirstMessageRequest = {
        type: "firstMessage", protocol: 1, requestID: pending.requestID, source: firstMessageSource,
        sessionID: pending.sessionID, sessionFile: pending.sessionFile, cwd: pending.cwd,
        firstLine: pending.firstLine, observedAt: pending.observedAt,
      };
      pending.attempts += 1;
      const abortController = new AbortController();
      pending.abortController = abortController;
      void this.send(request, abortController.signal).then((ack) => {
        pending.abortController = undefined;
        if (this.stopped || pending.finished) return;
        if (ack && validFirstMessageAck(ack, request)) {
          pending.finished = true;
          this.completedSessionIDs.add(request.sessionID);
          this.pendingBySessionID.delete(request.sessionID);
          return;
        }
        this.schedule(pending);
      }).catch(() => {
        pending.abortController = undefined;
        if (!this.stopped && !pending.finished) this.schedule(pending);
      });
    }, delay);
    pending.timer.unref?.();
  }
}

function terminalPath(): string | undefined {
  try {
    const tty = execFileSync("/usr/bin/tty", {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "ignore"],
    }).trim();
    return tty.startsWith("/dev/") ? tty : undefined;
  } catch {
    return undefined;
  }
}

function workspace(): string | undefined {
  return process.env.ZELLIJ_SESSION_NAME;
}

function zellijPaneID(): string | undefined {
  return process.env.ZELLIJ_PANE_ID;
}

function tmuxRuntime(): boolean {
  return Boolean(process.env.TMUX?.trim() && process.env.TMUX_PANE?.match(/^%[0-9]+$/));
}

export function resolveTmuxRoute(options: ResolveTmuxRouteOptions = {}): TmuxPresenceRoute | undefined {
  const environment = options.environment ?? process.env;
  const tmuxEnvironment = options.tmuxEnvironment ?? environment.TMUX;
  const paneID = options.tmuxPaneID ?? environment.TMUX_PANE;
  if (!tmuxEnvironment || !paneID?.match(/^%[0-9]+$/)) return undefined;

  const environmentMatch = tmuxEnvironment.match(/^(.*),([1-9][0-9]*),[0-9]+$/);
  if (!environmentMatch) return undefined;
  const socketPath = environmentMatch[1];
  const inheritedServerPID = Number(environmentMatch[2]);
  if (!isAbsolute(socketPath) || !Number.isSafeInteger(inheritedServerPID)) return undefined;

  const isExecutable = options.isExecutable ?? ((path: string) => {
    try { accessSync(path, constants.X_OK); return true; } catch { return false; }
  });
  const candidates = [
    join(environment.HOME ?? "/tmp", ".local/share/mise/shims/tmux"),
    "/opt/homebrew/bin/tmux", "/usr/local/bin/tmux",
  ];
  const executable = options.tmuxExecutable ?? environment.PI_SESSION_MANAGER_TMUX_EXECUTABLE
    ?? environment.PI_GHOSTTY_TMUX_EXECUTABLE ?? candidates.find(isExecutable) ?? "tmux";
  const diagnostic = options.onDiagnostic ?? ((message: string) => {
    if (message !== lastTmuxRouteDiagnostic) console.error(message);
    lastTmuxRouteDiagnostic = message;
  });
  const execFile = options.execFile ?? ((command, args, execOptions) => execFileSync(command, args, execOptions as Parameters<typeof execFileSync>[2]) as string);
  try {
    const output = execFile(executable, ["-S", socketPath, "display-message", "-p", "-t", paneID, tmuxRouteFormat], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: tmuxQueryTimeoutMs,
    }).trim();
    const fields = output.split("|");
    if (fields.length !== 4) {
      diagnostic("Cannot identify detached tmux route: malformed pane response.");
      return undefined;
    }

    const serverPID = Number(fields[0]);
    const [sessionID, windowID, resolvedPaneID] = fields.slice(1);
    if (serverPID !== inheritedServerPID
        || !sessionID.match(/^\$[0-9]+$/)
        || !windowID.match(/^@[0-9]+$/)
        || resolvedPaneID !== paneID) {
      diagnostic("Cannot identify detached tmux route: server or pane identity changed.");
      return undefined;
    }

    const serverStartTime = execFile("/bin/ps", ["-p", String(serverPID), "-o", "lstart="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: tmuxQueryTimeoutMs,
      env: { ...environment, LC_ALL: "C" },
    }).trim();
    if (!serverStartTime || /[\r\n]/.test(serverStartTime)) {
      diagnostic("Cannot identify detached tmux route: server start identity unavailable.");
      return undefined;
    }
    lastTmuxRouteDiagnostic = undefined;
    return { socketPath, serverPID, serverStartTime, sessionID, windowID, paneID };
  } catch (error) {
    diagnostic(`Cannot query detached tmux route using ${executable}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export function resolveTmuxGhosttyClient(
  route: TmuxPresenceRoute,
  appPID: number,
  options: ResolveTmuxGhosttyClientOptions = {},
): string | undefined {
  const environment = options.environment ?? process.env;
  const executable = options.tmuxExecutable ?? environment.PI_SESSION_MANAGER_TMUX_EXECUTABLE
    ?? environment.PI_GHOSTTY_TMUX_EXECUTABLE ?? "tmux";
  const execFile = options.execFile ?? ((command, args, execOptions) => execFileSync(command, args, execOptions as Parameters<typeof execFileSync>[2]) as string);
  const query = () => execFile(executable, ["-S", route.socketPath, "list-clients", "-F", tmuxClientFormat], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: tmuxQueryTimeoutMs,
  }).trim().split(/\r?\n/).filter(Boolean);
  const eligible = (rows: string[]): string[] => rows.filter((row) => {
    const fields = row.split("|");
    if (fields.length !== 5) return false;
    const [rawPID, tty, sessionID, windowID, paneID] = fields;
    const clientPID = Number(rawPID);
    if (!Number.isSafeInteger(clientPID) || clientPID <= 1 || !tty.match(/^\/dev\/tty[A-Za-z0-9_.-]+$/)
        || sessionID !== route.sessionID || windowID !== route.windowID || paneID !== route.paneID) return false;
    try {
      const observedTTY = execFile("/bin/ps", ["-p", rawPID, "-o", "tty="], {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: tmuxQueryTimeoutMs,
      }).trim();
      const command = execFile("/bin/ps", ["-p", rawPID, "-o", "command="], {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: tmuxQueryTimeoutMs,
      }).trim();
      if (`/dev/${observedTTY}` !== tty || !command.split(/\s+/).some((token) => token.split("/").at(-1) === "tmux")) return false;
      let pid = clientPID;
      const seen = new Set<number>();
      while (pid > 1 && !seen.has(pid)) {
        if (pid === appPID) return true;
        seen.add(pid);
        pid = Number(execFile("/bin/ps", ["-p", String(pid), "-o", "ppid="], {
          encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: tmuxQueryTimeoutMs,
        }).trim());
        if (!Number.isSafeInteger(pid)) return false;
      }
    } catch {}
    return false;
  });
  try {
    const first = eligible(query());
    if (first.length !== 1) return undefined;
    const second = eligible(query());
    return second.length === 1 && second[0] === first[0] ? first[0].split("|")[1] : undefined;
  } catch {
    return undefined;
  }
}

function managedGhosttyIdentity(): CurrentGhosttySurfaceIdentity {
  const appPID = Number(process.env.PI_GHOSTTY_APP_PID);
  const windowID = process.env.PI_GHOSTTY_WINDOW_ID?.trim();
  const terminalID = process.env.PI_GHOSTTY_TERMINAL_ID?.trim();
  const parentTTY = process.env.PI_GHOSTTY_PARENT_TTY?.trim();
  return {
    ...(Number.isInteger(appPID) && appPID > 0 ? { appPID } : {}),
    ...(windowID ? { windowID } : {}),
    ...(terminalID ? { terminalID } : {}),
    ...(parentTTY?.match(/^\/dev\/tty[A-Za-z0-9_.-]+$/) ? { parentTTY } : {}),
  };
}

function completeGhosttyIdentity(identity: CurrentGhosttySurfaceIdentity): identity is CompleteGhosttySurfaceIdentity {
  return !!identity.appPID && !!identity.windowID && !!identity.terminalID;
}

function validGhosttyIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

export function resolveActiveGhosttySurface(
  options: ResolveActiveGhosttySurfaceOptions = {},
): ActiveGhosttySurfaceResult {
  const execFile = options.execFile ?? ((command, args, execOptions) => execFileSync(command, args, execOptions));
  try {
    const output = execFile(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", `ObjC.import("AppKit")
ObjC.import("ScriptingBridge")
function unwrap(value) { return ObjC.unwrap(value) }
function identifier(value) { return String(unwrap(value.valueForKey("id"))) }
function run() {
  const workspace = $.NSWorkspace.sharedWorkspace
  const running = workspace.frontmostApplication
  if (!running || String(unwrap(running.bundleIdentifier)) !== "com.mitchellh.ghostty") return "NOT_FRONTMOST"
  const pid = Number(unwrap(running.processIdentifier))
  const launched = String(unwrap(running.launchDate.description))
  if (!(pid > 0) || !launched) return "INVALID"
  const app = $.SBApplication.alloc.initWithProcessIdentifier(pid)
  const front = app.valueForKey("frontWindow")
  const tab = front && front.valueForKey("selectedTab")
  const focused = tab && tab.valueForKey("focusedTerminal")
  if (!front || !tab || !focused) return "INVALID"
  const windowID = identifier(front)
  const tabID = identifier(tab)
  const terminalID = identifier(focused)
  if (!windowID || !tabID || !terminalID) return "INVALID"
  let matches = 0
  const windows = app.elementArrayWithCode(0x47776e64)
  for (let wi = 0; wi < Number(windows.count); wi++) {
    const candidateWindow = windows.objectAtIndex(wi)
    const terminals = candidateWindow.elementArrayWithCode(0x4774726d)
    for (let ti = 0; ti < Number(terminals.count); ti++) {
      if (identifier(candidateWindow) === windowID && identifier(terminals.objectAtIndex(ti)) === terminalID) matches++
    }
  }
  if (matches !== 1) return "AMBIGUOUS"
  const finalRunning = workspace.frontmostApplication
  if (!finalRunning || String(unwrap(finalRunning.bundleIdentifier)) !== "com.mitchellh.ghostty"
      || Number(unwrap(finalRunning.processIdentifier)) !== pid
      || String(unwrap(finalRunning.launchDate.description)) !== launched) return "CHANGED"
  const finalApp = $.SBApplication.alloc.initWithProcessIdentifier(pid)
  const finalFront = finalApp.valueForKey("frontWindow")
  const finalTab = finalFront && finalFront.valueForKey("selectedTab")
  const finalFocused = finalTab && finalTab.valueForKey("focusedTerminal")
  if (!finalFront || !finalTab || !finalFocused || identifier(finalFront) !== windowID
      || identifier(finalTab) !== tabID || identifier(finalFocused) !== terminalID) return "CHANGED"
  return ["OK", pid, windowID, terminalID].join("\\t")
}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: ghosttyOsaScriptTimeoutMs },
    ).trim();
    if (output === "NOT_FRONTMOST") return { ok: false, reason: "not-frontmost" };
    if (output === "CHANGED") return { ok: false, reason: "changed" };
    if (output === "AMBIGUOUS") return { ok: false, reason: "ambiguous" };
    const [status, rawPID, windowID, terminalID, ...extra] = output.split("\t");
    const appPID = Number(rawPID);
    if (status !== "OK" || extra.length || !Number.isInteger(appPID) || appPID <= 0
        || !validGhosttyIdentifier(windowID ?? "") || !validGhosttyIdentifier(terminalID ?? "")) {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true, identity: { appPID, windowID, terminalID } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

function directGhosttyAncestryMatches(appPID: number): boolean {
  let pid = process.pid;
  const seen = new Set<number>();
  try {
    while (pid > 1 && !seen.has(pid)) {
      if (pid === appPID) return true;
      seen.add(pid);
      const parent = Number(execFileSync("/bin/ps", ["-p", String(pid), "-o", "ppid="], {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: tmuxQueryTimeoutMs,
      }).trim());
      if (!Number.isInteger(parent) || parent <= 0) return false;
      pid = parent;
    }
  } catch {}
  return false;
}

function stripControlCharacters(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

function terminalTitle(sessionID: string): string {
  return `Pi Session ${stripControlCharacters(sessionID)}`;
}

function terminalTitleSequence(value: string): string {
  return `\u001b]0;${value}\u0007`;
}

function writeTerminalTitleSequence(value: string): boolean {
  if (!process.stdout.isTTY) return false;
  process.stdout.write(value);
  return true;
}

export class LiveSessionPresenceBridge {
  private readonly directory: string;
  private readonly launchDirectory: string;
  private readonly sendAdvisoryPoke: (stream: AdvisoryPokeStream) => void;
  private readonly pid: number;
  private readonly now: () => number;
  private readonly getTerminalPath: () => string | undefined;
  private readonly getWorkspace: () => string | undefined;
  private readonly getZellijPaneID: () => string | undefined;
  private readonly hasTmuxRuntime: () => boolean;
  private readonly getTmuxRoute: () => TmuxPresenceRoute | undefined;
  private readonly getManagedGhosttyIdentity: () => CurrentGhosttySurfaceIdentity;
  private readonly resolveActiveGhosttySurface: () => ActiveGhosttySurfaceResult;
  private readonly resolveTmuxGhosttyClient: (route: TmuxPresenceRoute, appPID: number) => string | undefined;
  private readonly directGhosttyAncestryMatches: (appPID: number) => boolean;
  private readonly onManagedGhosttyBinding: (binding: ManagedGhosttyBindingEvent) => void;
  private readonly onPresencePublished: (publication: PresencePublication) => void;
  private readonly appendPresenceHistory: (path: string, line: string) => void;
  private readonly writeTerminalTitleSequence: (value: string) => boolean | void;
  private readonly intervalMs: number;
  private readonly metadataRetryMs: number;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private publishRetry: ReturnType<typeof setTimeout> | undefined;
  private pendingPublish: PendingPresencePublish | undefined;
  private sessionID: string | undefined;
  private tty: string | undefined;
  private currentWorkspace: string | undefined;
  private currentZellijPaneID: string | undefined;
  private currentTmuxRoute: TmuxPresenceRoute | undefined;
  private inheritedGhosttyIdentity: CurrentGhosttySurfaceIdentity = {};
  private explicitGhosttyIdentity: CompleteGhosttySurfaceIdentity | undefined;
  private currentTerminalTitle: string | undefined;
  private currentGhosttyAppPID: number | undefined;
  private currentGhosttyWindowID: string | undefined;
  private currentGhosttyTerminalID: string | undefined;
  private currentGhosttyParentTTY: string | undefined;
  private activeManagedGhosttyBinding: ManagedGhosttyBinding | undefined;
  private pendingManagedGhosttyBindings: ManagedGhosttyBindingEvent[] = [];

  constructor(options: LiveSessionPresenceBridgeOptions = {}) {
    this.directory = options.directory ?? registryDirectory;
    this.launchDirectory = options.launchDirectory ?? launchDirectory;
    const serviceSocketPath = options.serviceSocketPath ?? defaultIndexerServiceSocketPath();
    this.sendAdvisoryPoke = options.sendAdvisoryPoke ?? ((stream) => sendIndexerServicePoke(serviceSocketPath, stream));
    this.pid = options.pid ?? process.pid;
    this.now = options.now ?? Date.now;
    this.getTerminalPath = options.terminalPath ?? terminalPath;
    this.getWorkspace = options.workspace ?? workspace;
    this.getZellijPaneID = options.zellijPaneID ?? zellijPaneID;
    this.hasTmuxRuntime = options.tmuxRuntime ?? tmuxRuntime;
    this.getTmuxRoute = options.tmuxRoute ?? resolveTmuxRoute;
    this.getManagedGhosttyIdentity = options.managedGhosttyIdentity ?? managedGhosttyIdentity;
    this.resolveActiveGhosttySurface = options.resolveActiveGhosttySurface ?? (() => resolveActiveGhosttySurface());
    this.resolveTmuxGhosttyClient = options.resolveTmuxGhosttyClient ?? ((route, appPID) => resolveTmuxGhosttyClient(route, appPID));
    this.directGhosttyAncestryMatches = options.directGhosttyAncestryMatches ?? directGhosttyAncestryMatches;
    this.onManagedGhosttyBinding = options.onManagedGhosttyBinding ?? (() => {});
    this.onPresencePublished = options.onPresencePublished ?? (() => {});
    this.appendPresenceHistory = options.appendPresenceHistory ?? ((path, line) => appendFileSync(path, line, { encoding: "utf8", mode: 0o600 }));
    this.writeTerminalTitleSequence = options.writeTerminalTitleSequence ?? writeTerminalTitleSequence;
    this.intervalMs = options.heartbeatIntervalMs ?? heartbeatIntervalMs;
    this.metadataRetryMs = options.sessionMetadataRetryMs ?? sessionMetadataRetryMs;
  }

  start(ctx: PresenceContext): void {
    this.clearHeartbeat();
    this.clearPublishRetry();
    this.removeCurrentRecord();
    this.tty = this.getTerminalPath();
    this.publish(ctx);
    this.heartbeat = setInterval(() => this.publish(ctx), this.intervalMs);
    this.heartbeat.unref?.();
  }

  publish(ctx: PresenceContext, state: PresenceState = ctx.isIdle() ? "idle" : "processing"): void {
    const sessionFile = ctx.sessionManager.getSessionFile();
    const sessionID = ctx.sessionManager.getSessionId();
    if (!sessionFile || !sessionID) {
      if (state !== "stopped") this.schedulePublishRetry(ctx, state);
      return;
    }

    this.clearPublishRetry();
    this.refreshMuxRoute();
    if (this.sessionID && this.sessionID !== sessionID) {
      this.removeCurrentRecord();
      this.explicitGhosttyIdentity = undefined;
    }
    this.sessionID = sessionID;
    this.refreshManagedGhosttyIdentity(sessionID, sessionFile, ctx.cwd, state === "stopped");
    this.syncTerminalTitle(sessionID);
    this.writePresenceRecord(sessionID, sessionFile, ctx.cwd, state);
  }

  publishSubagentLaunch(ctx: PresenceContext, result: unknown): void {
    const parentSessionFile = ctx.sessionManager.getSessionFile();
    const parentSessionID = ctx.sessionManager.getSessionId();
    const childSessionFile = sessionFileFrom(result);
    if (!parentSessionFile || !parentSessionID || !childSessionFile) return;

    const destination = join(this.launchDirectory, `${encodeURIComponent(parentSessionID)}-${encodeURIComponent(childSessionFile.split("/").at(-1) ?? childSessionFile)}.json`);
    const temporary = `${destination}.${this.pid}.${randomUUID()}.tmp`;
    const entry = { parentSessionID, parentSessionFile, childSessionFile, updatedAt: this.now() };
    try {
      mkdirSync(this.launchDirectory, { recursive: true, mode: 0o700 });
      writeFileSync(temporary, JSON.stringify(entry) + "\n", { encoding: "utf8", mode: 0o600 });
      renameSync(temporary, destination);
      this.sendAdvisoryPokeSafely("launch");
    } catch (error) {
      try {
        rmSync(temporary, { force: true });
      } catch {}
      console.error("pi-session-manager-presence: could not publish subagent launch", error);
    }
  }

  stop(ctx: PresenceContext): void {
    this.clearHeartbeat();
    this.clearPublishRetry();
    this.publish(ctx, "stopped");
  }

  registerWindow(ctx: PresenceContext): RegisterWindowResult {
    const sessionFile = ctx.sessionManager.getSessionFile();
    const sessionID = ctx.sessionManager.getSessionId();
    if (!sessionFile || !sessionID) {
      return {
        ok: false,
        message: "Could not register this window yet because the session metadata is not available. No registration payload was sent.",
      };
    }

    this.clearPublishRetry();
    if (this.sessionID && this.sessionID !== sessionID) {
      this.removeCurrentRecord();
    }
    this.sessionID = sessionID;
    this.tty = this.getTerminalPath();
    this.refreshMuxRoute();
    this.refreshManagedGhosttyIdentity(sessionID, sessionFile, ctx.cwd);
    this.syncTerminalTitle(sessionID);

    const state = ctx.isIdle() ? "idle" : "processing";
    const publication = this.writePresenceRecord(sessionID, sessionFile, ctx.cwd, state);
    const effectiveIdentity = this.explicitGhosttyIdentity ?? this.inheritedGhosttyIdentity;
    const complete = completeGhosttyIdentity(effectiveIdentity);
    const summary = !publication.written
      ? "Could not publish the window registration."
      : this.explicitGhosttyIdentity
        ? "Republished the explicitly re-registered Ghostty window. The override lasts until session switch, /reload, or Pi restart."
        : complete
          ? "Republished the Ghostty window established by the bootstrap."
          : "The Ghostty bootstrap did not provide a complete window identity.";
    return {
      ok: publication.written && complete,
      message: [
        summary,
        `Registry write: ${publication.written ? "succeeded" : "FAILED"}`,
        `Registry file: ${JSON.stringify(publication.destination)}`,
        // Format the bytes used for this write, not a second identity query.
        publication.serialized === undefined
          ? "Payload unavailable."
          : `Payload (null = unavailable; omitted fields are not sent):\n${JSON.stringify(JSON.parse(publication.serialized), null, 2)}`,
      ].join("\n"),
    };
  }

  reRegisterWindow(ctx: RegisterWindowContext): RegisterWindowResult {
    const sessionFile = ctx.sessionManager.getSessionFile();
    const sessionID = ctx.sessionManager.getSessionId();
    if (!sessionFile || !sessionID) {
      return { ok: false, message: "Could not re-register this window because session metadata is unavailable. The existing registration is unchanged." };
    }
    if (!ctx.hasUI) {
      return { ok: false, message: "Window re-registration requires an interactive Pi client. The existing registration is unchanged." };
    }
    const tty = this.getTerminalPath();
    if (!tty?.match(/^\/dev\/tty[A-Za-z0-9_.-]+$/)) {
      return { ok: false, message: "Could not validate this Pi terminal. The existing registration is unchanged." };
    }

    this.refreshMuxRoute();
    const resolved = this.resolveActiveGhosttySurface();
    if (!resolved.ok) {
      return { ok: false, message: "Could not validate the active Ghostty pane. Bring the intended Ghostty pane to the front and retry. The existing registration is unchanged." };
    }
    let candidate: CompleteGhosttySurfaceIdentity = resolved.identity;
    if (this.currentTmuxRoute) {
      const clientTTY = this.resolveTmuxGhosttyClient(this.currentTmuxRoute, resolved.identity.appPID);
      const stableRoute = this.getTmuxRoute();
      const stableSurface = this.resolveActiveGhosttySurface();
      if (!clientTTY || !stableRoute || JSON.stringify(stableRoute) !== JSON.stringify(this.currentTmuxRoute)
          || !stableSurface.ok || stableSurface.identity.appPID !== resolved.identity.appPID
          || stableSurface.identity.windowID !== resolved.identity.windowID
          || stableSurface.identity.terminalID !== resolved.identity.terminalID) {
        return { ok: false, message: "Could not identify one stable current tmux client for the active Ghostty pane. The existing registration is unchanged." };
      }
      candidate = { ...resolved.identity, parentTTY: clientTTY };
    } else if (this.hasTmuxRuntime()) {
      return { ok: false, message: "Could not validate the current tmux route. The existing registration is unchanged." };
    } else if (!this.currentWorkspace && !this.currentZellijPaneID
        && !this.directGhosttyAncestryMatches(resolved.identity.appPID)) {
      return { ok: false, message: "The active Ghostty process does not own this direct Pi terminal. The existing registration is unchanged." };
    } else if (!this.currentWorkspace && !this.currentZellijPaneID) {
      candidate = { ...resolved.identity, parentTTY: tty };
    }

    this.clearPublishRetry();
    if (this.sessionID && this.sessionID !== sessionID) {
      this.removeCurrentRecord();
      this.explicitGhosttyIdentity = undefined;
    }
    this.sessionID = sessionID;
    this.tty = tty;
    this.inheritedGhosttyIdentity = this.getManagedGhosttyIdentity();
    this.prepareManagedGhosttyBindings(candidate, sessionID, sessionFile, ctx.cwd);
    this.syncTerminalTitle(sessionID);
    const publication = this.writePresenceRecord(
      sessionID, sessionFile, ctx.cwd, ctx.isIdle() ? "idle" : "processing", candidate, true,
    );
    if (publication.written) {
      this.explicitGhosttyIdentity = candidate;
      this.applyGhosttyIdentity(candidate);
    } else {
      this.pendingManagedGhosttyBindings = [];
      this.applyGhosttyIdentity(this.explicitGhosttyIdentity ?? this.inheritedGhosttyIdentity);
    }
    const summary = publication.written
      ? `Re-registered this Pi session to the validated active Ghostty pane. The override lasts until session switch, /reload, or Pi restart.${publication.postCommitWarning ? " The live snapshot committed, but a best-effort history or binding callback failed; a later heartbeat will retry binding convergence." : ""}`
      : "Could not publish the validated Ghostty window. The existing registration is unchanged.";
    return {
      ok: publication.written,
      message: [
        summary,
        `Registry write: ${publication.written ? "succeeded" : "FAILED"}`,
        `Registry file: ${JSON.stringify(publication.destination)}`,
        publication.serialized === undefined
          ? "Payload unavailable."
          : `Payload (null = unavailable; omitted fields are not sent):\n${JSON.stringify(JSON.parse(publication.serialized), null, 2)}`,
      ].join("\n"),
    };
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
  }

  private clearPublishRetry(): void {
    if (this.publishRetry) {
      clearTimeout(this.publishRetry);
      this.publishRetry = undefined;
    }
    this.pendingPublish = undefined;
  }

  private schedulePublishRetry(ctx: PresenceContext, state: PresenceState): void {
    this.pendingPublish = { ctx, state };
    if (this.publishRetry) return;
    this.publishRetry = setTimeout(() => {
      this.publishRetry = undefined;
      const pendingPublish = this.pendingPublish;
      if (!pendingPublish) return;
      this.publish(pendingPublish.ctx, pendingPublish.state);
    }, this.metadataRetryMs);
    this.publishRetry.unref?.();
  }

  private removeCurrentRecord(): void {
    if (this.sessionID) {
      try {
        rmSync(this.recordPath(this.sessionID), { force: true });
      } catch (error) {
        console.error("pi-session-manager-presence: could not remove presence", error);
      }
      this.sessionID = undefined;
    }
    this.currentTerminalTitle = undefined;
    this.currentTmuxRoute = undefined;
    this.currentGhosttyAppPID = undefined;
    this.currentGhosttyWindowID = undefined;
    this.currentGhosttyTerminalID = undefined;
    this.currentGhosttyParentTTY = undefined;
    this.explicitGhosttyIdentity = undefined;
    this.activeManagedGhosttyBinding = undefined;
    this.pendingManagedGhosttyBindings = [];
  }

  private refreshMuxRoute(): void {
    this.currentTmuxRoute = this.getTmuxRoute();
    if (this.currentTmuxRoute || this.hasTmuxRuntime()) {
      this.currentWorkspace = undefined;
      this.currentZellijPaneID = undefined;
      return;
    }
    this.currentWorkspace = this.getWorkspace();
    this.currentZellijPaneID = this.getZellijPaneID();
  }

  private syncTerminalTitle(sessionID: string): void {
    if (this.currentTmuxRoute || this.currentWorkspace || this.currentZellijPaneID) {
      this.currentTerminalTitle = undefined;
      return;
    }

    const nextTitle = terminalTitle(sessionID);
    if (this.currentTerminalTitle === nextTitle) return;

    try {
      const didWrite = this.writeTerminalTitleSequence(terminalTitleSequence(nextTitle));
      this.currentTerminalTitle = didWrite === false ? undefined : nextTitle;
    } catch (error) {
      this.currentTerminalTitle = undefined;
      console.error("pi-session-manager-presence: could not write terminal title", error);
    }
  }

  private refreshManagedGhosttyIdentity(sessionID: string, sessionFile: string, cwd: string, ending = false): void {
    this.inheritedGhosttyIdentity = this.getManagedGhosttyIdentity();
    const effectiveIdentity = this.explicitGhosttyIdentity ?? this.inheritedGhosttyIdentity;
    this.applyGhosttyIdentity(effectiveIdentity);
    this.prepareManagedGhosttyBindings(effectiveIdentity, sessionID, sessionFile, cwd, ending);
  }

  private prepareManagedGhosttyBindings(
    identity: CurrentGhosttySurfaceIdentity,
    sessionID: string,
    sessionFile: string,
    cwd: string,
    ending = false,
  ): void {
    this.pendingManagedGhosttyBindings = [];
    if (ending || !completeGhosttyIdentity(identity)) {
      if (this.activeManagedGhosttyBinding) {
        this.pendingManagedGhosttyBindings.push({ event: windowBindingEndedEvent, ...this.activeManagedGhosttyBinding });
      }
      return;
    }

    const binding: ManagedGhosttyBinding = { sessionID, sessionFile, cwd, ...identity };
    if (this.activeManagedGhosttyBinding
        && this.managedGhosttyBindingKey(binding) === this.managedGhosttyBindingKey(this.activeManagedGhosttyBinding)) return;
    if (this.activeManagedGhosttyBinding) {
      this.pendingManagedGhosttyBindings.push({ event: windowBindingEndedEvent, ...this.activeManagedGhosttyBinding });
    }
    this.pendingManagedGhosttyBindings.push({ event: windowBindingEvent, ...binding });
  }

  private managedGhosttyBindingKey(binding: ManagedGhosttyBinding): string {
    return JSON.stringify([
      binding.sessionID,
      binding.sessionFile,
      binding.appPID,
      binding.windowID,
      binding.terminalID,
      binding.parentTTY ?? null,
    ]);
  }

  private flushManagedGhosttyBindings(): boolean {
    const pendingBindings = this.pendingManagedGhosttyBindings;
    this.pendingManagedGhosttyBindings = [];
    for (const binding of pendingBindings) {
      try {
        this.onManagedGhosttyBinding(binding);
      } catch (error) {
        console.error("pi-session-manager-presence: could not append managed Ghostty binding transition", error);
        return false;
      }
      if (binding.event === windowBindingEndedEvent) {
        this.activeManagedGhosttyBinding = undefined;
      } else {
        const { event: _event, ...activeBinding } = binding;
        this.activeManagedGhosttyBinding = activeBinding;
      }
    }
    return true;
  }

  private applyGhosttyIdentity(identity: CurrentGhosttySurfaceIdentity): void {
    if (completeGhosttyIdentity(identity)) {
      this.currentGhosttyAppPID = identity.appPID;
      this.currentGhosttyWindowID = identity.windowID;
      this.currentGhosttyTerminalID = identity.terminalID;
      this.currentGhosttyParentTTY = identity.parentTTY;
      return;
    }
    this.currentGhosttyAppPID = undefined;
    this.currentGhosttyWindowID = undefined;
    this.currentGhosttyTerminalID = undefined;
    this.currentGhosttyParentTTY = undefined;
  }

  private writePresenceRecord(
    sessionID: string,
    sessionFile: string,
    cwd: string,
    state: PresenceState,
    identity?: CurrentGhosttySurfaceIdentity,
    requireSnapshotCommitBeforeHistory = false,
  ): { written: boolean; destination: string; serialized?: string; postCommitWarning?: boolean } {
    const destination = this.recordPath(sessionID);
    const temporary = `${destination}.${this.pid}.${randomUUID()}.tmp`;
    const publishedAppPID = identity?.appPID ?? this.currentGhosttyAppPID;
    const publishedWindowID = identity?.windowID ?? this.currentGhosttyWindowID;
    const publishedTerminalID = identity?.terminalID ?? this.currentGhosttyTerminalID;
    const publishedParentTTY = identity ? identity.parentTTY : this.currentGhosttyParentTTY;
    const entry = {
      sessionID,
      sessionFile,
      cwd,
      pid: this.pid,
      tty: this.tty ?? null,
      workspace: this.currentWorkspace ?? null,
      zellijPaneID: this.currentZellijPaneID ?? null,
      terminalTitle: this.currentTerminalTitle ?? null,
      ...(this.currentTmuxRoute ? { tmux: this.currentTmuxRoute } : {}),
      ...(publishedAppPID ? { ghosttyAppPID: publishedAppPID } : {}),
      ...(publishedParentTTY ? { ghosttyParentTTY: publishedParentTTY } : {}),
      ghosttyWindowID: publishedWindowID ?? null,
      ghosttyTerminalID: publishedTerminalID ?? null,
      state,
      updatedAt: this.now(),
    };
    let written = false;
    let serialized: string | undefined;
    let postCommitWarning = false;
    try {
      serialized = JSON.stringify(entry);
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const line = serialized + "\n";
      const appendHistory = (): boolean => {
        try {
          this.appendPresenceHistory(join(this.directory, `${encodeURIComponent(sessionID)}.jsonl`), line);
          return true;
        } catch (error) {
          console.error("pi-session-manager-presence: could not append presence history", error);
          return false;
        }
      };
      // Ordinary heartbeat history remains independent of the compatibility snapshot. Explicit
      // re-registration is stricter so a failed snapshot cannot expose an uncommitted candidate.
      if (!requireSnapshotCommitBeforeHistory) appendHistory();
      writeFileSync(temporary, line, { encoding: "utf8", mode: 0o600 });
      renameSync(temporary, destination);
      written = true;
      if (requireSnapshotCommitBeforeHistory && !appendHistory()) postCommitWarning = true;
      if (!this.flushManagedGhosttyBindings()) postCommitWarning = true;
      if (!this.recordPresencePublicationSafely({
        sessionID,
        sessionFile,
        cwd,
        state,
        ...(this.tty ? { tty: this.tty } : {}),
        ...(this.currentWorkspace ? { workspace: this.currentWorkspace } : {}),
        ...(this.currentZellijPaneID ? { zellijPaneID: this.currentZellijPaneID } : {}),
        ...(this.currentTmuxRoute ? { tmux: this.currentTmuxRoute } : {}),
        ...(publishedAppPID ? { ghosttyAppPID: publishedAppPID } : {}),
        ...(publishedWindowID ? { ghosttyWindowID: publishedWindowID } : {}),
        ...(publishedTerminalID ? { ghosttyTerminalID: publishedTerminalID } : {}),
        ...(publishedParentTTY ? { ghosttyParentTTY: publishedParentTTY } : {}),
      })) postCommitWarning = true;
      this.sendAdvisoryPokeSafely("presence");
    } catch (error) {
      this.pendingManagedGhosttyBindings = [];
      try {
        rmSync(temporary, { force: true });
      } catch {}
      console.error("pi-session-manager-presence: could not publish presence", error);
    }
    return { written, destination, serialized, ...(postCommitWarning ? { postCommitWarning: true } : {}) };
  }

  private recordPresencePublicationSafely(publication: PresencePublication): boolean {
    try {
      this.onPresencePublished(publication);
      return true;
    } catch (error) {
      console.error("pi-session-manager-presence: could not append presence publication", error);
      return false;
    }
  }

  private sendAdvisoryPokeSafely(stream: AdvisoryPokeStream): void {
    try {
      this.sendAdvisoryPoke(stream);
    } catch {}
  }

  private recordPath(sessionID: string): string {
    return join(this.directory, `${encodeURIComponent(sessionID)}.json`);
  }
}

function sendIndexerServicePoke(socketPath: string, stream: AdvisoryPokeStream): void {
  if (!socketPath) return;

  const socket = createConnection(socketPath);
  socket.on("error", () => {
    socket.destroy();
  });
  socket.on("connect", () => {
    socket.end(JSON.stringify({ type: "poke", protocol: indexerServiceProtocolVersion, stream }) + "\n");
  });
  socket.unref?.();
}

function sessionFileFrom(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return undefined;
  const sessionFile = (details as { sessionFile?: unknown }).sessionFile;
  return typeof sessionFile === "string" ? sessionFile : undefined;
}

export default function (pi: ExtensionAPI, options: LiveSessionPresenceBridgeOptions = {}) {
  const firstMessagePublisher = new FirstMessagePublisher(options);
  const bridge = new LiveSessionPresenceBridge({
    ...options,
    onPresencePublished: (publication) => {
      pi.appendEntry(presenceEntryType, {
        event: presencePublishedEvent,
        source: presenceSource,
        ...publication,
      });
      options.onPresencePublished?.(publication);
    },
    onManagedGhosttyBinding: (binding) => {
      pi.appendEntry(windowBindingEntryType, {
        event: binding.event,
        source: windowBindingSource,
        sessionID: binding.sessionID,
        sessionFile: binding.sessionFile,
        cwd: binding.cwd,
        ghosttyAppPID: binding.appPID,
        ghosttyWindowID: binding.windowID,
        ghosttyTerminalID: binding.terminalID,
        ...(binding.parentTTY ? { ghosttyParentTTY: binding.parentTTY } : {}),
      });
    },
  });

  pi.registerCommand("register-window", {
    description: "Republish window identity and show the exact registry path, window, pane, TTY, and payload",
    handler: async (_args, ctx) => {
      const result = bridge.registerWindow(ctx);
      ctx.ui?.notify?.(result.message, result.ok ? "info" : "warning");
      return result.message;
    },
  });

  pi.registerCommand("re-register-window", {
    description: "Explicitly bind this session to the active Ghostty pane until session switch, /reload, or Pi restart",
    handler: async (_args, ctx) => {
      const result = bridge.reRegisterWindow(ctx);
      ctx.ui?.notify?.(result.message, result.ok ? "info" : "warning");
      return result.message;
    },
  });

  pi.on("session_start", (_event, ctx) => {
    bridge.start(ctx);
    firstMessagePublisher.start(ctx);
  });
  pi.on("before_agent_start", (event, ctx) => {
    bridge.publish(ctx, "processing");
    firstMessagePublisher.rearm(ctx);
    firstMessagePublisher.capturePrompt(event, ctx);
  });
  pi.on("agent_settled", (_event, ctx) => {
    bridge.publish(ctx, "idle");
    firstMessagePublisher.rearm(ctx);
  });
  pi.on("tool_execution_end", (event, ctx) => {
    if (event.toolName === "subagent") bridge.publishSubagentLaunch(ctx, event.result);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    firstMessagePublisher.stop();
    bridge.stop(ctx);
  });
}
