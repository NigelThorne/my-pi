import { existsSync, watch, type FSWatcher } from 'node:fs';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import { InboxEventDispatcher, formatInboxSteer, type InboxSteerEvent } from './inbox.ts';
import { WorkWatchdog, recoveryPrompt, retryPrompt, isInboundEvent, type WatchdogAction, type TurnToolCall } from './watchdog.ts';

interface InboxState {
  seq?: number;
  self?: {
    displayName?: string;
    activityId?: string;
    activityLabel?: string;
  };
  events?: InboxSteerEvent[];
}

const STATUS_REFRESH_MS = 60_000;

function isMeaningfulProgressTool(toolName: string): boolean {
  return /^(read|bash|grep|find|ls|edit|write|ast_|run_tests|webfetch|websearch|pickup_work|pickup_handover|read_work|get_messages|find_messages|get_activities|get_awareness|list_work|view_file|get_page|list_pages|todo_|log|set_my_status|resolve_work|complete_activity|raise|decide|request_access)$/.test(toolName);
}

function myceliumDir(cwd: string): string {
  return process.env['MYCELIUM_SCRATCH_DIR'] || join(cwd, '.mycelium');
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, path);
}

function assistantText(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text') {
        return String((part as { text?: unknown }).text ?? '');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function preview(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 200 ? `${compact.slice(0, 200)}…` : compact;
}

export default function nigelMyceliumWatchdog(pi: ExtensionAPI) {
  let sessionId = '';
  let mycDir = '';
  let ui: ExtensionContext['ui'] | null = null;
  let ctxRef: ExtensionContext | null = null;
  let inboxWatcher: FSWatcher | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let ownsInbox = false;
  let currentToolCalls: TurnToolCall[] = [];
  let lastAssistantPreview = '';
  let lastTurnAt = 0;
  let lastToolAt = 0;
  let lastSteerAt = 0;
  let lastSteerReason = '';
  let fallbackOutcome = '';
  let agentBusy = false;
  let lastPaneRenameName = '';
  let paneRenameOutcome = '';

  const watchdog = new WorkWatchdog();
  const inboxDispatcher = new InboxEventDispatcher<InboxSteerEvent>();
  const deliveredInboxEvents = new Set<string>();

  const inboxPath = () => join(mycDir, `inbox-${sessionId}.json`);
  const inboxLockPath = () => join(mycDir, `nigel-watchdog-inbox-owner-${sessionId}.lock`);
  const deliveredInboxPath = () => join(mycDir, `nigel-watchdog-delivered-inbox-${sessionId}.json`);
  const auditPath = () => join(mycDir, `nigel-watchdog-${sessionId}.json`);

  async function readInbox(): Promise<InboxState | null> {
    return readJson<InboxState>(inboxPath());
  }

  function steer(content: string, reason: string): void {
    lastSteerAt = Date.now();
    lastSteerReason = reason;
    pi.sendMessage({ customType: 'nigel-mycelium-watchdog', content, display: true }, { deliverAs: 'steer', triggerTurn: true });
    void writeAudit();
  }

  function handleAction(action: WatchdogAction): void {
    if (action.type === 'fallback') {
      runFallback(action);
      return;
    }
    if (action.type === 'immediate-retry') {
      steer(retryPrompt(action.activityId, action.reason ?? 'no concrete progress'), 'immediate-retry');
      return;
    }
    if (action.type === 'stalled-note') {
      steer(
        `Mycelium watchdog: log to activity ${action.activityId} that you acknowledged/poked but did not make progress, then immediately take a concrete next tool action.`,
        'stalled-note',
      );
      return;
    }
    if (action.type === 'stalled-escalation') {
      steer(
        `Mycelium watchdog: you have repeatedly failed to progress on ${action.activityId}. Escalate to @Nigel Thorne or the orchestrator now with the assignment, blocker, and last response: ${lastAssistantPreview || '(no assistant text)'}`,
        'stalled-escalation',
      );
      return;
    }
    if (action.type === 'main-escalation') {
      steer(`${recoveryPrompt(action.activityId)} If help remains unanswered, escalate that request to place chat now.`, action.type);
      return;
    }
    steer(recoveryPrompt(action.activityId), action.type);
  }

  function maybeRunMyceliumJoinCommand(inbox?: InboxState | null): void {
    const displayName = inbox?.self?.displayName?.trim();
    if (!displayName || displayName === lastPaneRenameName) return;

    lastPaneRenameName = displayName;
    const paneId = process.env['ZELLIJ_PANE_ID']?.trim();
    if (!paneId) {
      paneRenameOutcome = 'skipped: not in zellij';
      void writeAudit(inbox);
      return;
    }

    paneRenameOutcome = `renaming pane to ${displayName}`;
    const child = spawn('zellij', ['action', 'rename-pane', '--pane-id', paneId, displayName], {
      stdio: 'ignore',
      detached: true,
      env: process.env,
    });
    child.on('error', (error) => {
      paneRenameOutcome = `rename failed: ${error.message}`;
      void writeAudit(inbox);
    });
    child.on('exit', (code) => {
      paneRenameOutcome = code === 0 ? `renamed pane to ${displayName}` : `rename exited ${code}`;
      void writeAudit(inbox);
    });
    child.unref?.();
  }

  async function dispatchInboxEvents(): Promise<void> {
    if (!ownsInbox) return;
    await inboxDispatcher.dispatch(readInbox, async (fresh) => {
      const incoming = fresh.filter(isInboundEvent).filter((event) => {
        const key = `${event.type}\u0000${event.threadId ?? ''}\u0000${event.peer ?? ''}\u0000${event.detail ?? ''}`;
        if (deliveredInboxEvents.has(key)) return false;
        deliveredInboxEvents.add(key);
        return true;
      });
      if (incoming.length === 0) return;

      const keys = [...deliveredInboxEvents].slice(-500);
      deliveredInboxEvents.clear();
      keys.forEach((key) => deliveredInboxEvents.add(key));
      await writeJsonAtomic(deliveredInboxPath(), keys).catch(() => {});

      const inbox = await readInbox();
      maybeRunMyceliumJoinCommand(inbox);
      const activityId = inbox?.self?.activityId;
      if (activityId) watchdog.expectProgress(activityId, Date.now());
      steer(formatInboxSteer(incoming), 'inbox-actionable-message');
    });
  }

  async function runWatchdog(): Promise<void> {
    const inbox = await readInbox();
    maybeRunMyceliumJoinCommand(inbox);
    const activityId = inbox?.self?.activityId;
    const connected = Boolean(inbox || existsSync(join(mycDir, 'connection.json')));
    const now = Date.now();
    const piBusy = ctxRef ? !ctxRef.isIdle() : false;
    const recentlyUsedTool = lastToolAt > 0 && now - lastToolAt < 90_000;
    const effectiveAgentBusy = agentBusy || piBusy || recentlyUsedTool;
    const actions = watchdog.poll({ now, activityId, agentBusy: effectiveAgentBusy, connected });
    for (const action of actions) handleAction(action);
    const status = watchdog.status(Date.now());
    if (!activityId) ui?.setStatus('nigel-mycelium-watchdog', undefined);
    else {
      const countdown = status.nextActionAt ? ` in ${Math.max(0, Math.ceil((status.nextActionAt - Date.now()) / 60_000))}m` : '';
      ui?.setStatus('nigel-mycelium-watchdog', `🍄 Nigel watchdog: ${status.phase}${countdown}${status.pendingExpectation ? ' · awaiting progress' : ''}${status.failedAttemptCount ? ` · failed ${status.failedAttemptCount}` : ''}${fallbackOutcome ? ` · ${fallbackOutcome}` : ''}`);
    }
    await writeAudit(inbox, status.phase, status.nextActionAt);
  }

  function runFallback(action: WatchdogAction): void {
    const command = process.env['MYCELIUM_HELP_FALLBACK_COMMAND'];
    if (!command) return;
    fallbackOutcome = 'running fallback';
    const payload = {
      sessionId,
      activityId: action.activityId,
      idleMinutes: 2,
      stage: action.type,
    };
    const child = spawn(command, [], {
      shell: true,
      stdio: 'ignore',
      env: { ...process.env, MYCELIUM_HELP_CONTEXT: JSON.stringify(payload) },
      detached: true,
    });
    child.on('error', (error) => {
      fallbackOutcome = `fallback failed: ${error.message}`;
      void writeAudit();
    });
    child.unref?.();
  }

  async function writeAudit(inbox?: InboxState | null, phase?: string, nextActionAt?: number): Promise<void> {
    if (!mycDir || !sessionId) return;
    const currentInbox = inbox ?? await readInbox();
    await mkdir(mycDir, { recursive: true }).catch(() => {});
    await writeJsonAtomic(auditPath(), {
      sessionId,
      activityId: currentInbox?.self?.activityId,
      activityLabel: currentInbox?.self?.activityLabel,
      lastPollAt: new Date().toISOString(),
      agentBusy: agentBusy || Boolean(ctxRef && !ctxRef.isIdle()),
      connected: Boolean(currentInbox || existsSync(join(mycDir, 'connection.json'))),
      phase: phase ?? watchdog.status(Date.now()).phase,
      nextActionAt: nextActionAt ? new Date(nextActionAt).toISOString() : undefined,
      pendingExpectation: watchdog.status(Date.now()).pendingExpectation,
      lastSteerAt: lastSteerAt ? new Date(lastSteerAt).toISOString() : undefined,
      lastSteerReason,
      lastTurnAt: lastTurnAt ? new Date(lastTurnAt).toISOString() : undefined,
      lastToolAt: lastToolAt ? new Date(lastToolAt).toISOString() : undefined,
      lastTurnToolCalls: currentToolCalls.map((call) => call.name),
      lastAssistantPreview,
      failedAttemptCount: watchdog.status(Date.now()).failedAttemptCount ?? 0,
      fallbackOutcome,
      paneRenameName: lastPaneRenameName || undefined,
      paneRenameOutcome: paneRenameOutcome || undefined,
    }).catch(() => {});
  }

  function watchInboxFile(): void {
    try {
      inboxWatcher = watch(mycDir, { persistent: false }, (_event, filename) => {
        if (filename === `inbox-${sessionId}.json`) void dispatchInboxEvents();
      });
    } catch {
      // Timer also polls the inbox.
    }
  }

  pi.on('session_start', async (_event, ctx) => {
    ctxRef = ctx;
    ui = ctx.hasUI ? ctx.ui : null;
    sessionId = `pi_${ctx.sessionManager.getSessionId()}`;
    mycDir = myceliumDir(ctx.cwd);
    await mkdir(mycDir, { recursive: true }).catch(() => {});
    const delivered = await readJson<string[]>(deliveredInboxPath());
    for (const key of delivered ?? []) deliveredInboxEvents.add(key);
    try {
      const lock = await open(inboxLockPath(), 'wx');
      await lock.writeFile(String(process.pid));
      await lock.close();
      ownsInbox = true;
    } catch {
      ui?.notify('Nigel Mycelium watchdog: another extension instance owns actionable inbox steering', 'warning');
    }
    const inbox = await readInbox();
    maybeRunMyceliumJoinCommand(inbox);
    inboxDispatcher.reset(inbox);
    watchInboxFile();
    timer = setInterval(() => {
      void dispatchInboxEvents();
      void runWatchdog();
    }, STATUS_REFRESH_MS);
    timer.unref?.();
    void writeAudit(inbox);
  });

  pi.on('before_agent_start', async () => {
    agentBusy = true;
    currentToolCalls = [];
    watchdog.observeAgentBusy();
    void writeAudit();
    return undefined;
  });

  pi.on('tool_call', async (event) => {
    const input = (event.input ?? {}) as Record<string, unknown>;
    currentToolCalls.push({ name: event.toolName, input });
    lastToolAt = Date.now();
    if (isMeaningfulProgressTool(event.toolName)) {
      const inbox = await readInbox();
      maybeRunMyceliumJoinCommand(inbox);
      const activityId = inbox?.self?.activityId;
      if (activityId) watchdog.observeProgress(activityId, lastToolAt);
      void writeAudit(inbox);
    }
    return undefined;
  });

  pi.on('turn_end', async (event) => {
    lastTurnAt = Date.now();
    lastAssistantPreview = preview(assistantText((event as { message?: unknown }).message));
    const inbox = await readInbox();
    maybeRunMyceliumJoinCommand(inbox);
    const actions = watchdog.observeTurnResult({
      activityId: inbox?.self?.activityId,
      assistantText: lastAssistantPreview,
      toolCalls: currentToolCalls,
      now: Date.now(),
    });
    for (const action of actions) handleAction(action);
    await dispatchInboxEvents().catch(() => {});
    await writeAudit(inbox);
  });

  pi.on('agent_settled', async () => {
    agentBusy = false;
    await runWatchdog();
  });

  pi.on('session_shutdown', async () => {
    inboxWatcher?.close();
    if (timer) clearInterval(timer);
    ui?.setStatus('nigel-mycelium-watchdog', undefined);
    if (ownsInbox) await unlink(inboxLockPath()).catch(() => {});
  });
}
