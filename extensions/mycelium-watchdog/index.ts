import { existsSync, watch, type FSWatcher } from 'node:fs';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import { Type } from 'typebox';
import { IdleInboxDelivery, InboxEventDispatcher, formatInboxSteer, type InboxSteerEvent } from './inbox.ts';
import { WorkWatchdog, recoveryPrompt, retryPrompt, isInboundEvent, resolveCurrentActivityId, selectFreshestSessionCandidate, shouldCheckWaitingFor, type WatchdogAction, type TurnToolCall } from './watchdog.ts';

interface InboxState {
  sourceSessionId?: string;
  seq?: number;
  self?: {
    displayName?: string;
    activityId?: string;
    activityLabel?: string;
  };
  events?: InboxSteerEvent[];
}

interface WaitingForState {
  waitingFor?: string;
  since?: string;
}

interface RollcallState {
  handledMessageIds?: string[];
}

interface CursorState {
  currentActivity?: string | null;
}

// Inbox delivery needs a short fallback in case a filesystem event is missed.
// Progress watchdog checks stay deliberately slower: an active agent may be
// waiting on CI, a human, or another agent and should not be nagged rapidly.
const INBOX_POLL_MS = 10_000;
const WATCHDOG_POLL_MS = 60_000;

function isMeaningfulProgressTool(toolName: string): boolean {
  return /^(read|bash|grep|find|ls|edit|write|ast_|run_tests|webfetch|websearch|pickup_work|pickup_handover|read_work|get_messages|find_messages|get_activities|get_awareness|list_work|view_file|get_page|list_pages|todo_|log|set_my_status|resolve_work|complete_activity|raise|decide|request_access|set_waiting_for|clear_waiting_for)$/.test(toolName);
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
  let inboxTimer: ReturnType<typeof setInterval> | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;
  let ownsInbox = false;
  let currentToolCalls: TurnToolCall[] = [];
  let lastAssistantPreview = '';
  let lastTurnAt = 0;
  let lastUserInputAt = 0;
  let lastToolAt = 0;
  let lastSteerAt = 0;
  let lastSteerReason = '';
  let fallbackOutcome = '';
  let agentBusy = false;
  let lastPaneRenameName = '';
  let paneRenameOutcome = '';
  let lastWaitingPromptAt = 0;
  const handledRollcalls = new Set<string>();

  const watchdog = new WorkWatchdog();
  const inboxDispatcher = new InboxEventDispatcher<InboxSteerEvent>();
  const idleInboxDelivery = new IdleInboxDelivery<InboxSteerEvent>();

  const inboxSessionIds = () => [...new Set([sessionId, sessionId.replace(/^pi_/, '')])];
  const inboxPathFor = (candidateSessionId: string) => join(mycDir, `inbox-${candidateSessionId}.json`);
  const cursorPathFor = (candidateSessionId: string) => join(mycDir, `cursor-${candidateSessionId}.json`);
  const inboxLockPath = () => join(mycDir, `nigel-watchdog-inbox-owner-${sessionId}.lock`);
  const pendingInboxPath = () => join(mycDir, `nigel-watchdog-pending-inbox-${sessionId}.json`);
  const waitingForPath = () => join(mycDir, `waiting-for-${sessionId}.json`);
  const rollcallStatePath = () => join(mycDir, `nigel-watchdog-rollcalls-${sessionId}.json`);
  const auditPath = () => join(mycDir, `nigel-watchdog-${sessionId}.json`);

  async function readInbox(): Promise<InboxState | null> {
    const candidates = await Promise.all(inboxSessionIds().map(async (candidateSessionId) => ({
      sessionId: candidateSessionId,
      modifiedAt: await stat(inboxPathFor(candidateSessionId)).then((value) => value.mtimeMs).catch(() => Number.NEGATIVE_INFINITY),
    })));
    const freshestSessionId = selectFreshestSessionCandidate(candidates);
    if (!freshestSessionId || !Number.isFinite(candidates.find((candidate) => candidate.sessionId === freshestSessionId)?.modifiedAt)) return null;
    const inbox = await readJson<InboxState>(inboxPathFor(freshestSessionId));
    return inbox && { ...inbox, sourceSessionId: freshestSessionId };
  }

  async function readCurrentActivityId(inbox?: InboxState | null): Promise<string | undefined> {
    const sourceSessionId = inbox?.sourceSessionId;
    const cursor = sourceSessionId ? await readJson<CursorState>(cursorPathFor(sourceSessionId)) : null;
    return resolveCurrentActivityId(inbox?.self?.activityId ?? undefined, cursor);
  }

  async function readWaitingFor(): Promise<WaitingForState | null> {
    return readJson<WaitingForState>(waitingForPath());
  }

  async function setWaitingFor(waitingFor: string | null): Promise<void> {
    if (waitingFor) {
      await writeJsonAtomic(waitingForPath(), { waitingFor, since: new Date().toISOString() });
      ui?.setStatus('mycelium-waiting-for', `⏳ Waiting for: ${waitingFor}`);
    } else {
      await unlink(waitingForPath()).catch(() => {});
      ui?.setStatus('mycelium-waiting-for', undefined);
    }
  }

  async function persistHandledRollcalls(): Promise<void> {
    await writeJsonAtomic(rollcallStatePath(), { handledMessageIds: [...handledRollcalls].slice(-100) }).catch(() => {});
  }

  function rollcallKey(event: InboxSteerEvent): string {
    return event.messageId ?? `legacy:${event.peer ?? ''}:${event.detail ?? ''}`;
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

  async function handleInboxFileChanged(): Promise<void> {
    const inbox = await readInbox();
    maybeRunMyceliumJoinCommand(inbox);
    await dispatchInboxEvents();
  }

  async function persistPendingInbox(): Promise<boolean> {
    try {
      await writeJsonAtomic(pendingInboxPath(), idleInboxDelivery.snapshot());
      return true;
    } catch {
      return false;
    }
  }

  async function dispatchInboxEvents(): Promise<void> {
    if (!ownsInbox) return;
    await inboxDispatcher.dispatch(readInbox, async (fresh) => {
      const incoming = fresh.filter(isInboundEvent).filter((event) => {
        if (event.type !== 'rollcall') return true;
        const key = rollcallKey(event);
        if (handledRollcalls.has(key)) return false;
        // Record before steering: a replay after an extension/server restart must
        // not make a headless worker announce the same rollcall indefinitely.
        handledRollcalls.add(key);
        return true;
      });
      if (incoming.length === 0) return;
      await persistHandledRollcalls();
      idleInboxDelivery.enqueue(incoming);
      await persistPendingInbox();
    });
    await deliverInboxIfIdle();
  }

  async function deliverInboxIfIdle(isIdle = Boolean(ctxRef?.isIdle()) && !agentBusy): Promise<void> {
    // A steer sent while Pi is already responding can be lost. Keep inbound
    // events durable until the fresh turn has been requested after Pi settles.
    const incoming = idleInboxDelivery.peekIfIdle(isIdle);
    if (incoming.length === 0 || !await persistPendingInbox()) return;

    const inbox = await readInbox();
    maybeRunMyceliumJoinCommand(inbox);
    const activityId = await readCurrentActivityId(inbox);
    if (activityId) watchdog.expectProgress(activityId, Date.now());
    try {
      steer(formatInboxSteer(incoming), 'inbox-actionable-message');
    } catch {
      return;
    }
    idleInboxDelivery.acknowledge(incoming.length);
    // A failure here can replay after a restart, but cannot lose the message.
    await persistPendingInbox();
  }

  async function runWatchdog(): Promise<void> {
    const inbox = await readInbox();
    maybeRunMyceliumJoinCommand(inbox);
    const activityId = await readCurrentActivityId(inbox);
    const connected = Boolean(inbox || existsSync(join(mycDir, 'connection.json')));
    const now = Date.now();
    const waitingFor = (await readWaitingFor())?.waitingFor?.trim();
    if (waitingFor && shouldCheckWaitingFor(activityId)) {
      if (now - lastWaitingPromptAt >= WATCHDOG_POLL_MS) {
        lastWaitingPromptAt = now;
        steer(
          `Mycelium watchdog: Are you still waiting for “${waitingFor}”? If it resolved or no longer applies, call clear_waiting_for and continue with the next concrete action.`,
          'waiting-for-check',
        );
      }
      await writeAudit(inbox, 'waiting');
      return;
    }
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
      activityId: await readCurrentActivityId(currentInbox),
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
      lastUserInputAt: lastUserInputAt ? new Date(lastUserInputAt).toISOString() : undefined,
      lastToolAt: lastToolAt ? new Date(lastToolAt).toISOString() : undefined,
      lastTurnToolCalls: currentToolCalls.map((call) => call.name),
      lastAssistantPreview,
      failedAttemptCount: watchdog.status(Date.now()).failedAttemptCount ?? 0,
      pendingInboxEventCount: idleInboxDelivery.snapshot().length,
      waitingFor: (await readWaitingFor())?.waitingFor,
      fallbackOutcome,
      paneRenameName: lastPaneRenameName || undefined,
      paneRenameOutcome: paneRenameOutcome || undefined,
    }).catch(() => {});
  }

  function watchInboxFile(): void {
    try {
      inboxWatcher = watch(mycDir, { persistent: false }, (_event, filename) => {
        if (inboxSessionIds().some((candidateSessionId) => filename === `inbox-${candidateSessionId}.json`)) void handleInboxFileChanged();
      });
    } catch {
      // Timer also polls the inbox.
    }
  }

  pi.registerTool({
    name: 'set_waiting_for',
    label: 'Set Waiting For',
    description: 'Register what you are waiting for. It appears on a dedicated Pi status line and the Mycelium watchdog checks it once a minute.',
    parameters: Type.Object({
      waitingFor: Type.String({ minLength: 1, maxLength: 500, description: 'The dependency, person, or event you are waiting for.' }),
    }),
    async execute(_toolCallId, params) {
      const waitingFor = (params as { waitingFor: string }).waitingFor.trim();
      await setWaitingFor(waitingFor);
      return { content: [{ type: 'text', text: `Waiting for registered: ${waitingFor}` }], details: {} };
    },
  });

  pi.registerTool({
    name: 'clear_waiting_for',
    label: 'Clear Waiting For',
    description: 'Clear the current waiting condition once it is resolved or no longer applies.',
    parameters: Type.Object({}),
    async execute() {
      await setWaitingFor(null);
      return { content: [{ type: 'text', text: 'Waiting condition cleared.' }], details: {} };
    },
  });

  pi.on('session_start', async (_event, ctx) => {
    ctxRef = ctx;
    ui = ctx.hasUI ? ctx.ui : null;
    sessionId = `pi_${ctx.sessionManager.getSessionId()}`;
    mycDir = myceliumDir(ctx.cwd);
    await mkdir(mycDir, { recursive: true }).catch(() => {});
    const pending = await readJson<InboxSteerEvent[]>(pendingInboxPath());
    idleInboxDelivery.enqueue(pending ?? []);
    const rollcallState = await readJson<RollcallState>(rollcallStatePath());
    for (const id of rollcallState?.handledMessageIds ?? []) handledRollcalls.add(id);
    const waitingFor = (await readWaitingFor())?.waitingFor?.trim();
    if (waitingFor) ui?.setStatus('mycelium-waiting-for', `⏳ Waiting for: ${waitingFor}`);
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
    // The watcher is normally immediate; this is its short recovery path.
    inboxTimer = setInterval(() => {
      void handleInboxFileChanged();
    }, INBOX_POLL_MS);
    inboxTimer.unref?.();

    // Keep “you have active work but are not progressing” checks conservative.
    watchdogTimer = setInterval(() => {
      void runWatchdog();
    }, WATCHDOG_POLL_MS);
    watchdogTimer.unref?.();
    void writeAudit(inbox);
  });

  pi.on('input', async (event) => {
    if (event.source === 'extension') return undefined;
    lastUserInputAt = Date.now();
    const inbox = await readInbox();
    const activityId = await readCurrentActivityId(inbox);
    if (activityId) watchdog.observeUserInteraction(activityId, lastUserInputAt);
    void writeAudit(inbox);
    return undefined;
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
      const activityId = await readCurrentActivityId(inbox);
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
      activityId: await readCurrentActivityId(inbox),
      assistantText: lastAssistantPreview,
      toolCalls: currentToolCalls,
      now: Date.now(),
    });
    for (const action of actions) handleAction(action);
    await handleInboxFileChanged().catch(() => {});
    await writeAudit(inbox);
  });

  pi.on('agent_settled', async () => {
    agentBusy = false;
    await dispatchInboxEvents();
    // `agent_settled` is the lifecycle guarantee that a new steer may start a
    // turn, even if the context's idle flag has not updated yet.
    await deliverInboxIfIdle(true);
    await runWatchdog();
  });

  pi.on('session_shutdown', async () => {
    inboxWatcher?.close();
    if (inboxTimer) clearInterval(inboxTimer);
    if (watchdogTimer) clearInterval(watchdogTimer);
    ui?.setStatus('nigel-mycelium-watchdog', undefined);
    ui?.setStatus('mycelium-waiting-for', undefined);
    if (ownsInbox) await unlink(inboxLockPath()).catch(() => {});
  });
}
