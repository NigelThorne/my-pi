export type WatchdogActionType =
  | 'thread-help'
  | 'thread-update'
  | 'main-escalation'
  | 'fallback'
  | 'immediate-retry'
  | 'stalled-note'
  | 'stalled-escalation';

export interface WatchdogAction {
  type: WatchdogActionType;
  activityId: string;
  reason?: string;
}

export interface WatchdogObservation {
  now: number;
  activityId?: string;
  agentBusy: boolean;
  connected: boolean;
}

export interface WatchdogStatus {
  phase: WatchdogActionType | 'inactive' | 'escalated' | 'waiting-for-progress';
  nextActionAt?: number;
  failedAttemptCount?: number;
  pendingExpectation?: boolean;
}

export interface TurnToolCall {
  name: string;
  input?: Record<string, unknown>;
}

export type TurnOutcome = 'progress' | 'blocked' | 'done' | 'assent-only' | 'no-action';

export interface TurnResult {
  activityId?: string;
  assistantText: string;
  toolCalls: TurnToolCall[];
  now: number;
}

const HELP_AFTER_MS = 2 * 60_000;
const UPDATE_EVERY_MS = 2 * 60_000;
const ESCALATE_AFTER_MS = 10 * 60_000;
const FALLBACK_AFTER_MS = 2 * 60_000;

const ASSENT_ONLY_RE = /^(?:\s*(?:ack(?:\s+#[\w-]+)?\.?|sure(?: thing)?[,.!\s]*(?:i['’]?ll|i will|i can|let me)?[^.?!]*(?:do|check|review|look|start|take|handle|get|proceed)[^.?!]*[.?!]?|sounds good[,.!\s]*(?:i['’]?ll|i will|let me)?[^.?!]*[.?!]?|(?:i['’]?ll|i will|let me)\s+(?:do|check|review|look|start|take|handle|get|proceed)[^.?!]*[.?!]?|okay[,.!\s]*(?:i['’]?ll|i will|let me)?[^.?!]*[.?!]?)+\s*)$/i;

const COMPLETION_RE = /\b(done|completed|resolved|fixed|implemented|verified|tests? pass|handed off|handoff|marked (?:done|blocked)|blocked because|blocked on|cannot proceed because)\b/i;
const BLOCKING_QUESTION_RE = /\?\s*$|\b(blocked|need (?:a )?(?:decision|permission|access|clarification)|please confirm|can you grant|should i)\b/i;

export function blockingQuestionInstruction(activityId: string): string {
  return `If blocked, post the question where collaborators will see it: use send_message with activityId \"${activityId}\" (or log if you are already in that activity). ` +
    'Address the orchestrator by @mention if you know who is coordinating this work; otherwise @Nigel Thorne. ' +
    'State the specific decision/access/info needed, what you already tried, and what you will do after the answer. ' +
    'Also call set_my_status with status "blocked" and a short statusText.';
}

export function recoveryPrompt(activityId: string): string {
  return `Mycelium watchdog: you still own active work (${activityId}) and have been idle. ` +
    'Are you done, blocked, or actually working? Continue now with the next concrete tool action. ' +
    'Inspect git status, pending Mycelium replies, work item/thread state, PR/CI, or failed logs as appropriate. ' +
    `${blockingQuestionInstruction(activityId)} ` +
    'Do not merely acknowledge this prompt or say you will do it.';
}

export function retryPrompt(activityId: string, reason: string): string {
  return `Mycelium watchdog: your previous response did not make progress on active work (${activityId}) — ${reason}. ` +
    'Do not acknowledge this prompt. Take the next concrete tool action now. ' +
    `${blockingQuestionInstruction(activityId)}`;
}

export function isInboundEvent(event: { type: string }): boolean {
  return event.type === 'mention' || event.type === 'thread_reply';
}

export function watchdogDestination(type: WatchdogActionType): 'activity-log' | 'place-chat' | 'fallback' | 'steer' {
  if (type === 'main-escalation' || type === 'stalled-escalation') return 'place-chat';
  if (type === 'fallback') return 'fallback';
  if (type === 'immediate-retry') return 'steer';
  return 'activity-log';
}

export interface FallbackPayload {
  sessionId: string;
  activityId: string;
  idleMinutes: number;
  stage: WatchdogActionType;
}

export function fallbackPayload(payload: FallbackPayload): FallbackPayload {
  return payload;
}

export function classifyTurn(result: TurnResult): TurnOutcome {
  const text = result.assistantText.trim();
  const meaningfulTool = result.toolCalls.some(isMeaningfulToolCall);
  if (meaningfulTool) return 'progress';
  if (COMPLETION_RE.test(text)) {
    if (/\b(blocked|blocked on|blocked because|cannot proceed because|need (?:a )?(?:decision|permission|access|clarification))\b/i.test(text)) return 'blocked';
    return 'done';
  }
  if (text && BLOCKING_QUESTION_RE.test(text) && !ASSENT_ONLY_RE.test(text)) return 'blocked';
  if (!text) return 'no-action';
  if (ASSENT_ONLY_RE.test(text) || isShortIntentOnly(text)) return 'assent-only';
  return 'no-action';
}

function isShortIntentOnly(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length > 24) return false;
  return /\b(i['’]?ll|i will|let me|going to|start(?:ing)?|proceed(?:ing)?|take care|handle|look into|check|review)\b/i.test(text) &&
    !/[`\n]/.test(text) &&
    !/\b(because|blocked|error|failed|found|changed|edited|ran|read|created|updated|committed|pushed|opened)\b/i.test(text);
}

function isMeaningfulToolCall(call: TurnToolCall): boolean {
  const name = call.name;
  if (/^(read|bash|grep|find|ls|edit|write|ast_|run_tests|webfetch|websearch|pickup_work|pickup_handover|read_work|get_messages|find_messages|get_activities|get_awareness|list_work|view_file|get_page|list_pages|todo_)/.test(name)) return true;
  if (/^(send_message|log|escalate|set_my_status|resolve_work|complete_activity|create_handover|raise|decide)$/.test(name)) {
    const text = String(call.input?.['content'] ?? call.input?.['summary'] ?? call.input?.['note'] ?? call.input?.['statusText'] ?? call.input?.['title'] ?? '').trim();
    return Boolean(text) && !/^ack(?:\s+#[\w-]+)?\.?$/i.test(text) && !ASSENT_ONLY_RE.test(text);
  }
  return false;
}

export class WorkWatchdog {
  private activityId?: string;
  private idleSince?: number;
  private disconnectedSince?: number;
  private helpSent = false;
  private nextUpdateAt?: number;
  private escalated = false;
  private fallbackSent = false;
  private pendingExpectation = false;
  private pendingSince?: number;
  private lastPromptAt?: number;
  private failedAttemptCount = 0;

  observe(input: WatchdogObservation): void {
    if (!input.activityId) {
      this.reset();
      return;
    }

    if (this.activityId !== input.activityId) {
      this.reset();
      this.activityId = input.activityId;
      this.idleSince = input.agentBusy ? undefined : input.now;
    } else if (!input.agentBusy && this.idleSince === undefined) {
      this.idleSince = input.now;
    }

    if (input.connected) {
      this.disconnectedSince = undefined;
      this.fallbackSent = false;
    } else if (this.disconnectedSince === undefined) {
      this.disconnectedSince = input.now;
    }
  }

  expectProgress(activityId: string, now: number): void {
    if (this.activityId !== activityId) {
      this.reset();
      this.activityId = activityId;
    }
    if (this.idleSince === undefined) this.idleSince = now;
    this.pendingExpectation = true;
    this.pendingSince = now;
    this.lastPromptAt = now;
  }

  observeTurnResult(result: TurnResult): WatchdogAction[] {
    if (!this.pendingExpectation || !this.activityId || result.activityId !== this.activityId) return [];
    const outcome = classifyTurn(result);
    if (outcome === 'progress' || outcome === 'blocked' || outcome === 'done') {
      this.markProgress(result.now, outcome === 'done');
      return [];
    }

    this.failedAttemptCount += 1;
    const reason = outcome === 'assent-only' ? 'it was only an acknowledgement or statement of intent' : 'it had no concrete tool action';
    const actions: WatchdogAction[] = [{ type: 'immediate-retry', activityId: this.activityId, reason }];
    if (this.failedAttemptCount === 2) actions.push({ type: 'stalled-note', activityId: this.activityId, reason });
    if (this.failedAttemptCount >= 3 && !this.escalated) {
      this.escalated = true;
      this.nextUpdateAt = undefined;
      actions.push({ type: 'stalled-escalation', activityId: this.activityId, reason });
    }
    this.pendingExpectation = true;
    if (this.pendingSince === undefined) this.pendingSince = result.now;
    this.lastPromptAt = result.now;
    return actions;
  }

  observeRelevantReply(): void {
    this.pendingExpectation = false;
    this.pendingSince = undefined;
    this.lastPromptAt = undefined;
    this.failedAttemptCount = 0;
    this.idleSince = undefined;
  }

  observeAgentBusy(): void {
    // Busy is not progress. Do not reset deadlines here; observe() sees agentBusy
    // and suppresses time-based actions while the turn is running.
  }

  status(_now: number): WatchdogStatus {
    if (!this.activityId || this.idleSince === undefined) return { phase: 'inactive', failedAttemptCount: this.failedAttemptCount, pendingExpectation: this.pendingExpectation };
    if (this.pendingExpectation) {
      const nextActionAt = this.escalated
        ? undefined
        : Math.min(
            (this.lastPromptAt ?? this.idleSince) + UPDATE_EVERY_MS,
            this.idleSince + ESCALATE_AFTER_MS,
          );
      return {
        phase: this.escalated ? 'escalated' : 'waiting-for-progress',
        nextActionAt,
        failedAttemptCount: this.failedAttemptCount,
        pendingExpectation: true,
      };
    }
    if (this.disconnectedSince !== undefined && !this.fallbackSent) {
      return { phase: 'fallback', nextActionAt: this.disconnectedSince + FALLBACK_AFTER_MS, failedAttemptCount: this.failedAttemptCount };
    }
    if (!this.helpSent) return { phase: 'thread-help', nextActionAt: this.idleSince + HELP_AFTER_MS, failedAttemptCount: this.failedAttemptCount };
    if (this.escalated) return { phase: 'escalated', failedAttemptCount: this.failedAttemptCount };
    const updateAt = this.nextUpdateAt ?? Number.POSITIVE_INFINITY;
    return {
      phase: updateAt <= this.idleSince + ESCALATE_AFTER_MS ? 'thread-update' : 'main-escalation',
      nextActionAt: Math.min(updateAt, this.idleSince + ESCALATE_AFTER_MS),
      failedAttemptCount: this.failedAttemptCount,
    };
  }

  poll(input: WatchdogObservation): WatchdogAction[] {
    this.observe(input);
    if (!this.activityId || this.idleSince === undefined || input.agentBusy) return [];

    const actions: WatchdogAction[] = [];
    if (this.pendingExpectation) {
      if (!this.escalated && input.now - this.idleSince >= ESCALATE_AFTER_MS) {
        this.escalated = true;
        this.nextUpdateAt = undefined;
        this.lastPromptAt = input.now;
        actions.push({ type: 'main-escalation', activityId: this.activityId, reason: 'no progress after repeated watchdog prompts' });
        return actions;
      }
      if (!this.lastPromptAt || input.now - this.lastPromptAt >= UPDATE_EVERY_MS) {
        this.lastPromptAt = input.now;
        this.failedAttemptCount += 1;
        actions.push({ type: 'thread-update', activityId: this.activityId, reason: 'still waiting for concrete progress' });
      }
      return actions;
    }

    if (!input.connected) {
      if (
        this.disconnectedSince !== undefined &&
        !this.fallbackSent &&
        input.now - this.disconnectedSince >= FALLBACK_AFTER_MS
      ) {
        this.fallbackSent = true;
        actions.push({ type: 'fallback', activityId: this.activityId });
      }
      return actions;
    }

    if (!this.helpSent && input.now - this.idleSince >= HELP_AFTER_MS) {
      this.helpSent = true;
      this.pendingExpectation = true;
      this.pendingSince = input.now;
      this.lastPromptAt = input.now;
      this.nextUpdateAt = this.idleSince + HELP_AFTER_MS + UPDATE_EVERY_MS;
      actions.push({ type: 'thread-help', activityId: this.activityId });
      return actions;
    }

    while (this.nextUpdateAt !== undefined && input.now >= this.nextUpdateAt) {
      this.pendingExpectation = true;
      this.pendingSince = input.now;
      this.lastPromptAt = input.now;
      this.nextUpdateAt += UPDATE_EVERY_MS;
      actions.push({ type: 'thread-update', activityId: this.activityId });
      return actions;
    }

    if (!this.escalated && input.now - this.idleSince >= ESCALATE_AFTER_MS) {
      this.escalated = true;
      this.pendingExpectation = true;
      this.pendingSince = input.now;
      this.lastPromptAt = input.now;
      this.nextUpdateAt = undefined;
      actions.push({ type: 'main-escalation', activityId: this.activityId });
    }

    return actions;
  }

  private markProgress(now: number, done: boolean): void {
    if (done) {
      this.reset();
      return;
    }
    this.idleSince = now;
    this.helpSent = false;
    this.nextUpdateAt = undefined;
    this.escalated = false;
    this.pendingExpectation = false;
    this.pendingSince = undefined;
    this.lastPromptAt = undefined;
    this.failedAttemptCount = 0;
  }

  private reset(): void {
    this.activityId = undefined;
    this.idleSince = undefined;
    this.disconnectedSince = undefined;
    this.helpSent = false;
    this.nextUpdateAt = undefined;
    this.escalated = false;
    this.fallbackSent = false;
    this.pendingExpectation = false;
    this.pendingSince = undefined;
    this.lastPromptAt = undefined;
    this.failedAttemptCount = 0;
  }
}
