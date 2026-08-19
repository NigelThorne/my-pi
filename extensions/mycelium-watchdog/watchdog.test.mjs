import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WorkWatchdog,
  classifyTurn,
  recoveryPrompt,
  retryPrompt,
  blockingQuestionInstruction,
  isInboundEvent,
  watchdogDestination,
  selectFreshestSessionCandidate,
  resolveCurrentActivityId,
  shouldCheckWaitingFor,
} from './watchdog.ts';
import { IdleInboxDelivery, InboxEventDispatcher, formatInboxSteer } from './inbox.ts';

const MINUTE = 60_000;

function triggerIdleWatchdog() {
  const watchdog = new WorkWatchdog();
  watchdog.observe({ now: 0, activityId: 'activity:auth', agentBusy: false, connected: true });
  assert.deepEqual(
    watchdog.poll({ now: 2 * MINUTE, activityId: 'activity:auth', agentBusy: false, connected: true }),
    [{ type: 'thread-help', activityId: 'activity:auth' }],
  );
  return watchdog;
}

test('watchdog prompts an idle agent to resume work or register a waiting condition', () => {
  assert.match(recoveryPrompt('activity:auth'), /If you are not waiting, continue now/i);
  assert.match(recoveryPrompt('activity:auth'), /set_waiting_for/);
  assert.match(retryPrompt('activity:auth', 'ack only'), /previous response did not make progress/i);
});

test('blocked instructions say where to post, who to mention, and which tools to use', () => {
  const instruction = blockingQuestionInstruction('activity:auth');
  assert.match(instruction, /send_message/);
  assert.match(instruction, /activityId "activity:auth"/);
  assert.match(instruction, /log/);
  assert.match(instruction, /orchestrator/);
  assert.match(instruction, /@Nigel Thorne/);
  assert.match(instruction, /set_my_status/);
  assert.match(instruction, /set_waiting_for/);
});

test('classifies ACK-only and assent-only turns as not progress', () => {
  assert.equal(classifyTurn({ activityId: 'activity:auth', assistantText: 'ACK #2597.', toolCalls: [], now: 0 }), 'assent-only');
  assert.equal(classifyTurn({ activityId: 'activity:auth', assistantText: "Sure, I'll do that.", toolCalls: [], now: 0 }), 'assent-only');
});

test('classifies meaningful tool calls as progress', () => {
  assert.equal(classifyTurn({ activityId: 'activity:auth', assistantText: '', toolCalls: [{ name: 'read', input: { path: 'README.md' } }], now: 0 }), 'progress');
  assert.equal(classifyTurn({ activityId: 'activity:auth', assistantText: '', toolCalls: [{ name: 'get_messages', input: { limit: 10 } }], now: 0 }), 'progress');
});

test('classifies focused blocking questions or blocked status as blocked', () => {
  assert.equal(classifyTurn({ activityId: 'activity:auth', assistantText: 'I am blocked because production access is required.', toolCalls: [], now: 0 }), 'blocked');
  assert.equal(classifyTurn({ activityId: 'activity:auth', assistantText: 'Should I make the production change now?', toolCalls: [], now: 0 }), 'blocked');
});

test('selects the freshest Mycelium session record across legacy prefixed identities', () => {
  assert.equal(
    selectFreshestSessionCandidate([
      { sessionId: 'pi_session-1', modifiedAt: 100 },
      { sessionId: 'session-1', modifiedAt: 200 },
    ]),
    'session-1',
  );
  assert.equal(selectFreshestSessionCandidate([{ sessionId: 'pi_session-1', modifiedAt: 100 }]), 'pi_session-1');
});

test('cursor ownership overrides stale inbox activity metadata', () => {
  assert.equal(resolveCurrentActivityId('activity:stale', { currentActivity: null }), undefined);
  assert.equal(resolveCurrentActivityId('activity:stale', { currentActivity: 'activity:current' }), 'activity:current');
  assert.equal(resolveCurrentActivityId('activity:legacy', null), 'activity:legacy');
});

test('waiting checks require current activity ownership', () => {
  assert.equal(shouldCheckWaitingFor(undefined), false);
  assert.equal(shouldCheckWaitingFor('activity:auth'), true);
});

test('user conversation restarts the idle timer', () => {
  const watchdog = new WorkWatchdog();
  watchdog.observe({ now: 0, activityId: 'activity:auth', agentBusy: false, connected: true });
  watchdog.observeUserInteraction('activity:auth', 90_000);

  assert.deepEqual(
    watchdog.poll({ now: 2 * MINUTE, activityId: 'activity:auth', agentBusy: false, connected: true }),
    [],
  );
  assert.deepEqual(
    watchdog.poll({ now: 210_000, activityId: 'activity:auth', agentBusy: false, connected: true }),
    [{ type: 'thread-help', activityId: 'activity:auth' }],
  );
});

test('user conversation clears a pending idle prompt', () => {
  const watchdog = triggerIdleWatchdog();
  watchdog.observeUserInteraction('activity:auth', 3 * MINUTE);

  assert.deepEqual(watchdog.status(3 * MINUTE), { phase: 'thread-help', nextActionAt: 5 * MINUTE, failedAttemptCount: 0 });
});

test('does not reset merely because the agent becomes busy', () => {
  const watchdog = new WorkWatchdog();
  watchdog.observe({ now: 0, activityId: 'activity:auth', agentBusy: false, connected: true });
  watchdog.observe({ now: MINUTE, activityId: 'activity:auth', agentBusy: true, connected: true });

  assert.deepEqual(
    watchdog.poll({ now: 2 * MINUTE, activityId: 'activity:auth', agentBusy: false, connected: true }),
    [{ type: 'thread-help', activityId: 'activity:auth' }],
  );
});

test('immediately re-steers after a watchdog poke if the next turn is assent-only', () => {
  const watchdog = triggerIdleWatchdog();

  assert.deepEqual(
    watchdog.observeTurnResult({ activityId: 'activity:auth', assistantText: "Sure, I'll do that.", toolCalls: [], now: 2 * MINUTE + 1 }),
    [{ type: 'immediate-retry', activityId: 'activity:auth', reason: 'it was only an acknowledgement or statement of intent' }],
  );
});

test('heartbeat keeps prompting while progress is pending instead of resetting the two minute timer', () => {
  const watchdog = triggerIdleWatchdog();

  assert.deepEqual(
    watchdog.poll({ now: 3 * MINUTE, activityId: 'activity:auth', agentBusy: false, connected: true }),
    [],
  );
  assert.deepEqual(
    watchdog.poll({ now: 4 * MINUTE, activityId: 'activity:auth', agentBusy: false, connected: true }),
    [{ type: 'thread-update', activityId: 'activity:auth', reason: 'still waiting for concrete progress' }],
  );
  assert.deepEqual(
    watchdog.poll({ now: 10 * MINUTE, activityId: 'activity:auth', agentBusy: false, connected: true }),
    [{ type: 'main-escalation', activityId: 'activity:auth', reason: 'no progress after repeated watchdog prompts' }],
  );
});

test('repeated unsatisfied watchdog turns note then escalate', () => {
  const watchdog = triggerIdleWatchdog();

  watchdog.observeTurnResult({ activityId: 'activity:auth', assistantText: 'ACK.', toolCalls: [], now: 2 * MINUTE + 1 });
  assert.deepEqual(
    watchdog.observeTurnResult({ activityId: 'activity:auth', assistantText: "I'll check now.", toolCalls: [], now: 2 * MINUTE + 2 }),
    [
      { type: 'immediate-retry', activityId: 'activity:auth', reason: 'it was only an acknowledgement or statement of intent' },
      { type: 'stalled-note', activityId: 'activity:auth', reason: 'it was only an acknowledgement or statement of intent' },
    ],
  );
  assert.deepEqual(
    watchdog.observeTurnResult({ activityId: 'activity:auth', assistantText: 'Okay, I will proceed.', toolCalls: [], now: 2 * MINUTE + 3 }),
    [
      { type: 'immediate-retry', activityId: 'activity:auth', reason: 'it was only an acknowledgement or statement of intent' },
      { type: 'stalled-escalation', activityId: 'activity:auth', reason: 'it was only an acknowledgement or statement of intent' },
    ],
  );
});

test('progress after a watchdog poke clears pending expectation and restarts idle timer', () => {
  const watchdog = triggerIdleWatchdog();

  assert.deepEqual(
    watchdog.observeTurnResult({ activityId: 'activity:auth', assistantText: '', toolCalls: [{ name: 'bash', input: { command: 'git status' } }], now: 3 * MINUTE }),
    [],
  );
  assert.deepEqual(watchdog.status(3 * MINUTE), { phase: 'thread-help', nextActionAt: 5 * MINUTE, failedAttemptCount: 0 });
});

test('explicit progress during tool work resets idle timer before a false idle poke', () => {
  const watchdog = new WorkWatchdog();
  watchdog.observe({ now: 0, activityId: 'activity:auth', agentBusy: false, connected: true });
  watchdog.observeProgress('activity:auth', 90_000);

  assert.deepEqual(
    watchdog.poll({ now: 2 * MINUTE, activityId: 'activity:auth', agentBusy: false, connected: true }),
    [],
  );
  assert.deepEqual(
    watchdog.poll({ now: 210_000, activityId: 'activity:auth', agentBusy: false, connected: true }),
    [{ type: 'thread-help', activityId: 'activity:auth' }],
  );
});

test('routes watchdog actions to the right mechanism', () => {
  assert.equal(watchdogDestination('thread-help'), 'activity-log');
  assert.equal(watchdogDestination('immediate-retry'), 'steer');
  assert.equal(watchdogDestination('stalled-escalation'), 'place-chat');
  assert.equal(watchdogDestination('fallback'), 'fallback');
});

test('classifies mentions, subscribed-thread replies, and rollcalls as inbound events', () => {
  assert.equal(isInboundEvent({ type: 'mention' }), true);
  assert.equal(isInboundEvent({ type: 'thread_reply' }), true);
  assert.equal(isInboundEvent({ type: 'rollcall' }), true);
  assert.equal(isInboundEvent({ type: 'peer_changed' }), false);
});

test('rollcall steer asks a worker to report or request replacement work when blocked', () => {
  const prompt = formatInboxSteer([{ type: 'rollcall', peer: 'Nigel', detail: 'Rollcall' }]);
  assert.match(prompt, /respond once in the main place chat/i);
  assert.match(prompt, /idle or blocked/i);
  assert.match(prompt, /ask for something else to do/i);
});

test('mixed rollcall and assignment steering preserves both required actions', () => {
  const prompt = formatInboxSteer([
    { type: 'rollcall', peer: 'Nigel', detail: 'Status check' },
    { type: 'mention', peer: 'Nigel', detail: 'Please continue the assigned work.' },
  ]);

  assert.match(prompt, /respond once in the main place chat/i);
  assert.match(prompt, /send the ACK, then immediately continue/i);
  assert.match(prompt, /Status check/);
});

test('holds incoming messages while Pi is busy, then acknowledges them only after delivery', () => {
  const delivery = new IdleInboxDelivery();
  const message = { type: 'mention', peer: 'Nigel', detail: 'Please review this.' };

  delivery.enqueue([message]);
  assert.deepEqual(delivery.peekIfIdle(false), []);
  assert.deepEqual(delivery.peekIfIdle(true), [message]);
  assert.deepEqual(delivery.peekIfIdle(true), [message]);
  delivery.acknowledge(1);
  assert.deepEqual(delivery.peekIfIdle(true), []);
});

test('preserves identical actionable messages as distinct deliveries', () => {
  const delivery = new IdleInboxDelivery();
  const message = { type: 'mention', peer: 'Nigel', detail: 'Please review this.' };

  delivery.enqueue([message, { ...message }]);
  assert.deepEqual(delivery.peekIfIdle(true), [message, message]);
});

test('delivers new inbox events after the server trims a full event buffer', async () => {
  const initial = Array.from({ length: 50 }, (_, index) => ({ type: 'mention', detail: `old-${index}`, ts: `2026-07-29T00:00:${index}` }));
  const next = [...initial.slice(1), { type: 'mention', detail: 'new-assignment', ts: '2026-07-29T00:01:00' }];
  const dispatcher = new InboxEventDispatcher({ seq: 1, events: initial });
  const delivered = [];

  await dispatcher.dispatch(async () => ({ seq: 2, events: next }), (events) => delivered.push(...events));

  assert.deepEqual(delivered, [next.at(-1)]);
});

test('delivers a duplicate event appended after a capped buffer rolls over', async () => {
  const duplicate = { type: 'rollcall', peer: 'Nigel', detail: 'Status check' };
  const initial = Array.from({ length: 50 }, () => ({ ...duplicate }));
  const next = [...initial.slice(1), { ...duplicate }];
  const dispatcher = new InboxEventDispatcher({ seq: 1, events: initial });
  const delivered = [];

  await dispatcher.dispatch(async () => ({ seq: 2, events: next }), (events) => delivered.push(...events));

  assert.deepEqual(delivered, [duplicate]);
});
