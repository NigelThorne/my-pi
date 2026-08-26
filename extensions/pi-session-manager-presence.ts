import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const sessionManagerDirectory = join(process.env.HOME ?? "/tmp", ".pi", "agent", "session-manager");
const registryDirectory = join(sessionManagerDirectory, "live");
const launchDirectory = join(sessionManagerDirectory, "launches");
const heartbeatIntervalMs = 15_000;

type PresenceState = "idle" | "processing" | "stopped";
type PresenceContext = Pick<ExtensionContext, "cwd" | "isIdle" | "sessionManager">;

type LiveSessionPresenceBridgeOptions = {
  directory?: string;
  launchDirectory?: string;
  pid?: number;
  now?: () => number;
  terminalPath?: () => string | undefined;
  workspace?: () => string | undefined;
  zellijPaneID?: () => string | undefined;
  heartbeatIntervalMs?: number;
};

function terminalPath(): string | undefined {
  try {
    const tty = execFileSync("/usr/bin/tty", { encoding: "utf8" }).trim();
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

export class LiveSessionPresenceBridge {
  private readonly directory: string;
  private readonly launchDirectory: string;
  private readonly pid: number;
  private readonly now: () => number;
  private readonly getTerminalPath: () => string | undefined;
  private readonly getWorkspace: () => string | undefined;
  private readonly getZellijPaneID: () => string | undefined;
  private readonly intervalMs: number;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private sessionID: string | undefined;
  private tty: string | undefined;
  private currentWorkspace: string | undefined;
  private currentZellijPaneID: string | undefined;

  constructor(options: LiveSessionPresenceBridgeOptions = {}) {
    this.directory = options.directory ?? registryDirectory;
    this.launchDirectory = options.launchDirectory ?? launchDirectory;
    this.pid = options.pid ?? process.pid;
    this.now = options.now ?? Date.now;
    this.getTerminalPath = options.terminalPath ?? terminalPath;
    this.getWorkspace = options.workspace ?? workspace;
    this.getZellijPaneID = options.zellijPaneID ?? zellijPaneID;
    this.intervalMs = options.heartbeatIntervalMs ?? heartbeatIntervalMs;
  }

  start(ctx: PresenceContext): void {
    this.clearHeartbeat();
    this.removeCurrentRecord();
    this.tty = this.getTerminalPath();
    this.currentWorkspace = this.getWorkspace();
    this.currentZellijPaneID = this.getZellijPaneID();
    this.publish(ctx);
    this.heartbeat = setInterval(() => this.publish(ctx), this.intervalMs);
    this.heartbeat.unref?.();
  }

  publish(ctx: PresenceContext, state: PresenceState = ctx.isIdle() ? "idle" : "processing"): void {
    const sessionFile = ctx.sessionManager.getSessionFile();
    const sessionID = ctx.sessionManager.getSessionId();
    if (!sessionFile || !sessionID) return;

    if (this.sessionID && this.sessionID !== sessionID) {
      this.removeCurrentRecord();
    }
    this.sessionID = sessionID;

    const destination = this.recordPath(sessionID);
    const temporary = `${destination}.${this.pid}.${randomUUID()}.tmp`;
    const entry = {
      sessionID,
      sessionFile,
      cwd: ctx.cwd,
      pid: this.pid,
      tty: this.tty ?? null,
      workspace: this.currentWorkspace ?? null,
      zellijPaneID: this.currentZellijPaneID ?? null,
      state,
      updatedAt: this.now(),
    };
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      writeFileSync(temporary, JSON.stringify(entry) + "\n", { encoding: "utf8", mode: 0o600 });
      renameSync(temporary, destination);
    } catch (error) {
      try {
        rmSync(temporary, { force: true });
      } catch {}
      console.error("pi-session-manager-presence: could not publish presence", error);
    }
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
    } catch (error) {
      try {
        rmSync(temporary, { force: true });
      } catch {}
      console.error("pi-session-manager-presence: could not publish subagent launch", error);
    }
  }

  stop(ctx: PresenceContext): void {
    this.clearHeartbeat();
    this.publish(ctx, "stopped");
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
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
  }

  private recordPath(sessionID: string): string {
    return join(this.directory, `${encodeURIComponent(sessionID)}.json`);
  }
}

function sessionFileFrom(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return undefined;
  const sessionFile = (details as { sessionFile?: unknown }).sessionFile;
  return typeof sessionFile === "string" ? sessionFile : undefined;
}

export default function (pi: ExtensionAPI) {
  const bridge = new LiveSessionPresenceBridge();

  pi.on("session_start", (_event, ctx) => bridge.start(ctx));
  pi.on("before_agent_start", (_event, ctx) => bridge.publish(ctx, "processing"));
  pi.on("agent_settled", (_event, ctx) => bridge.publish(ctx, "idle"));
  pi.on("tool_execution_end", (event, ctx) => {
    if (event.toolName === "subagent") bridge.publishSubagentLaunch(ctx, event.result);
  });
  pi.on("session_shutdown", (_event, ctx) => bridge.stop(ctx));
}
