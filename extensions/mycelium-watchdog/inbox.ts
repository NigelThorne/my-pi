export interface InboxSnapshot<T> {
  seq?: number;
  events?: T[];
}

export interface InboxSteerEvent {
  type: string;
  peer?: string;
  detail?: string;
  threadId?: string;
  files?: string[];
  pageTitle?: string;
}

export function formatInboxEvent(e: InboxSteerEvent): string {
  switch (e.type) {
    case 'peer_joined':
      return `→ ${e.peer} joined`;
    case 'peer_left':
      return `← ${e.peer} left`;
    case 'peer_changed':
      return `△ ${e.peer}: ${e.detail}`;
    case 'conflict':
      return `⚠ ${e.peer} also editing ${(e.files ?? []).join(', ')}`;
    case 'page_updated':
      return `📄 ${e.detail} updated by ${e.peer}`;
    case 'attachment':
      return `📎 ${e.peer} attached ${e.detail} to your activity`;
    case 'mention':
      return `💬 ${e.peer} mentioned you: ${e.detail}${e.threadId ? ` [reply in thread ${e.threadId}]` : ''}`;
    case 'thread_reply':
      return `↩ ${e.peer} replied: ${e.detail}${e.threadId ? ` [thread ${e.threadId}]` : ''}`;
    case 'rollcall':
      return `📣 ${e.peer} requested a rollcall`;
    default:
      return `${e.type}: ${e.peer}`;
  }
}

export function formatInboxSteer(events: InboxSteerEvent[]): string {
  const hasThread = events.some((event) => Boolean(event.threadId));
  const hasTruncatedPreview = events.some((event) => String(event.detail ?? '').trimEnd().endsWith('...'));
  const hasRollcall = events.some((event) => event.type === 'rollcall');
  const extraInstruction = hasThread || hasTruncatedPreview
    ? '\n\nIf a preview is truncated or includes a thread id, read the full thread with get_messages/find_messages before acting.'
    : '';
  const responseInstruction = hasRollcall
    ? 'Respond once in the main place chat with your current activity, or say that you are idle or blocked. If blocked, state the blocker and ask for something else to do.'
    : 'If the message asks for an acknowledgement, send the ACK, then immediately continue the requested work in this same turn; do not stop after the acknowledgement.';

  return [
    'Mycelium — incoming actionable message(s). Treat this as work to handle, not just a notification.',
    events.map(formatInboxEvent).join('\n'),
    responseInstruction,
  ].join('\n\n') + extraInstruction;
}

/**
 * Buffers actionable inbox events until Pi is idle, so an inbound message can
 * immediately start a fresh turn without interrupting a turn already running.
 */
export class IdleInboxDelivery<T> {
  private pending: T[] = [];

  enqueue(events: T[]): void {
    this.pending.push(...events);
  }

  peekIfIdle(isIdle: boolean): T[] {
    return isIdle ? [...this.pending] : [];
  }

  acknowledge(count: number): void {
    this.pending.splice(0, count);
  }

  snapshot(): T[] {
    return [...this.pending];
  }
}

export class InboxEventDispatcher<T> {
  private lastSeq: number;
  private lastEventCount: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(baseline?: InboxSnapshot<T> | null) {
    this.lastSeq = baseline?.seq ?? 0;
    this.lastEventCount = baseline?.events?.length ?? 0;
  }

  reset(baseline?: InboxSnapshot<T> | null): void {
    this.lastSeq = baseline?.seq ?? 0;
    this.lastEventCount = baseline?.events?.length ?? 0;
  }

  dispatch(
    read: () => Promise<InboxSnapshot<T> | null>,
    onEvents: (events: T[]) => Promise<void> | void,
  ): Promise<void> {
    const work = this.queue.then(async () => {
      const inbox = await read();
      if (!inbox || (inbox.seq ?? 0) === this.lastSeq) return;
      const events = inbox.events ?? [];
      const fresh = events.slice(this.lastEventCount);
      this.lastSeq = inbox.seq ?? 0;
      this.lastEventCount = events.length;
      if (fresh.length > 0) await onEvents(fresh);
    });
    this.queue = work.catch(() => {});
    return work;
  }
}
