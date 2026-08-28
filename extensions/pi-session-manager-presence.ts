import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const sessionManagerDirectory = join(process.env.HOME ?? "/tmp", ".pi", "agent", "session-manager");
const registryDirectory = join(sessionManagerDirectory, "live");
const launchDirectory = join(sessionManagerDirectory, "launches");
const heartbeatIntervalMs = 15_000;
const ghosttyOsaScriptTimeoutMs = 2_000;

type PresenceState = "idle" | "processing" | "stopped";
type PresenceContext = Pick<ExtensionContext, "cwd" | "isIdle" | "sessionManager">;

type GhosttySurfaceIdentity = {
  windowID: string;
  terminalID: string;
};

type GhosttySurface = GhosttySurfaceIdentity & {
  name: string;
};

type LiveSessionPresenceBridgeOptions = {
  directory?: string;
  launchDirectory?: string;
  pid?: number;
  now?: () => number;
  terminalPath?: () => string | undefined;
  workspace?: () => string | undefined;
  zellijPaneID?: () => string | undefined;
  isInteractive?: () => boolean;
  writeTerminalTitleSequence?: (value: string) => boolean | void;
  resolveGhosttySurface?: (title: string) => GhosttySurfaceIdentity | undefined;
  heartbeatIntervalMs?: number;
};

type ResolveGhosttySurfaceOptions = {
  isGhosttyRunning?: () => boolean;
  listGhosttySurfaces?: () => GhosttySurface[];
};

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

function stripControlCharacters(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

function terminalTitle(sessionID: string): string {
  return `Pi Session ${stripControlCharacters(sessionID)}`;
}

function terminalTitleSequence(value: string): string {
  return `\u001b]0;${value}\u0007`;
}

function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY);
}

function writeTerminalTitleSequence(value: string): boolean {
  if (!process.stdout.isTTY) return false;
  process.stdout.write(value);
  return true;
}

export function matchUniqueGhosttySurface(surfaces: GhosttySurface[], title: string): GhosttySurfaceIdentity | undefined {
  const matches = surfaces.filter((surface) => surface.name === title || surface.name.startsWith(`${title} |`));
  if (matches.length !== 1) return undefined;
  return { windowID: matches[0].windowID, terminalID: matches[0].terminalID };
}

function ghosttyIsRunning(): boolean {
  try {
    execFileSync("/usr/bin/pgrep", ["-x", "Ghostty"], {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
      timeout: ghosttyOsaScriptTimeoutMs,
    });
    return true;
  } catch {
    return false;
  }
}

export function resolveGhosttySurface(title: string, options: ResolveGhosttySurfaceOptions = {}): GhosttySurfaceIdentity | undefined {
  const isRunning = options.isGhosttyRunning ?? ghosttyIsRunning;
  if (!isRunning()) return undefined;
  const listSurfaces = options.listGhosttySurfaces ?? listGhosttySurfaces;
  return matchUniqueGhosttySurface(listSurfaces(), title);
}

function listGhosttySurfaces(): GhosttySurface[] {
  try {
    const output = execFileSync(
      "/usr/bin/osascript",
      [
        "-e",
        `tell application "Ghostty"
  set output to ""
  repeat with windowItem in every window
    repeat with terminalItem in every terminal of windowItem
      set output to output & (id of windowItem as text) & (ASCII character 9) & (id of terminalItem as text) & (ASCII character 9) & (name of terminalItem as text) & (ASCII character 10)
    end repeat
  end repeat
  return output
end tell`,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: ghosttyOsaScriptTimeoutMs,
      }
    );
    return parseGhosttySurfaces(output);
  } catch {
    return [];
  }
}

export function parseGhosttySurfaces(output: string): GhosttySurface[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      const firstTab = line.indexOf("\t");
      const secondTab = firstTab === -1 ? -1 : line.indexOf("\t", firstTab + 1);
      if (firstTab === -1 || secondTab === -1) return [];
      const windowID = line.slice(0, firstTab);
      const terminalID = line.slice(firstTab + 1, secondTab);
      const name = line.slice(secondTab + 1);
      if (!windowID || !terminalID || !name) return [];
      return [{ windowID, terminalID, name }];
    });
}

export class LiveSessionPresenceBridge {
  private readonly directory: string;
  private readonly launchDirectory: string;
  private readonly pid: number;
  private readonly now: () => number;
  private readonly getTerminalPath: () => string | undefined;
  private readonly getWorkspace: () => string | undefined;
  private readonly getZellijPaneID: () => string | undefined;
  private readonly isInteractive: () => boolean;
  private readonly writeTerminalTitleSequence: (value: string) => boolean | void;
  private readonly resolveGhosttySurface: (title: string) => GhosttySurfaceIdentity | undefined;
  private readonly intervalMs: number;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private sessionID: string | undefined;
  private tty: string | undefined;
  private currentWorkspace: string | undefined;
  private currentZellijPaneID: string | undefined;
  private currentTerminalTitle: string | undefined;
  private currentGhosttyWindowID: string | undefined;
  private currentGhosttyTerminalID: string | undefined;

  constructor(options: LiveSessionPresenceBridgeOptions = {}) {
    this.directory = options.directory ?? registryDirectory;
    this.launchDirectory = options.launchDirectory ?? launchDirectory;
    this.pid = options.pid ?? process.pid;
    this.now = options.now ?? Date.now;
    this.getTerminalPath = options.terminalPath ?? terminalPath;
    this.getWorkspace = options.workspace ?? workspace;
    this.getZellijPaneID = options.zellijPaneID ?? zellijPaneID;
    this.isInteractive = options.isInteractive ?? isInteractive;
    this.writeTerminalTitleSequence = options.writeTerminalTitleSequence ?? writeTerminalTitleSequence;
    this.resolveGhosttySurface = options.resolveGhosttySurface ?? resolveGhosttySurface;
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
    this.syncTerminalTitle(sessionID);
    const shouldResolveGhosttySurface = this.prepareGhosttySurfaceLookup();
    this.writePresenceRecord(sessionID, sessionFile, ctx.cwd, state);
    if (shouldResolveGhosttySurface && this.syncGhosttySurface()) {
      this.writePresenceRecord(sessionID, sessionFile, ctx.cwd, state);
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
    this.currentTerminalTitle = undefined;
    this.currentGhosttyWindowID = undefined;
    this.currentGhosttyTerminalID = undefined;
  }

  private syncTerminalTitle(sessionID: string): void {
    if (this.currentWorkspace || this.currentZellijPaneID) {
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

  private prepareGhosttySurfaceLookup(): boolean {
    if (this.currentWorkspace || this.currentZellijPaneID || !this.currentTerminalTitle || !this.isInteractive()) {
      this.currentGhosttyWindowID = undefined;
      this.currentGhosttyTerminalID = undefined;
      return false;
    }

    return !this.currentGhosttyWindowID || !this.currentGhosttyTerminalID;
  }

  private syncGhosttySurface(): boolean {
    try {
      const surface = this.resolveGhosttySurface(this.currentTerminalTitle!);
      if (!surface?.windowID || !surface.terminalID) return false;
      if (surface.windowID === this.currentGhosttyWindowID && surface.terminalID === this.currentGhosttyTerminalID) return false;
      this.currentGhosttyWindowID = surface.windowID;
      this.currentGhosttyTerminalID = surface.terminalID;
      return true;
    } catch (error) {
      console.error("pi-session-manager-presence: could not resolve Ghostty surface", error);
      return false;
    }
  }

  private writePresenceRecord(sessionID: string, sessionFile: string, cwd: string, state: PresenceState): void {
    const destination = this.recordPath(sessionID);
    const temporary = `${destination}.${this.pid}.${randomUUID()}.tmp`;
    const entry = {
      sessionID,
      sessionFile,
      cwd,
      pid: this.pid,
      tty: this.tty ?? null,
      workspace: this.currentWorkspace ?? null,
      zellijPaneID: this.currentZellijPaneID ?? null,
      terminalTitle: this.currentTerminalTitle ?? null,
      ghosttyWindowID: this.currentGhosttyWindowID ?? null,
      ghosttyTerminalID: this.currentGhosttyTerminalID ?? null,
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
