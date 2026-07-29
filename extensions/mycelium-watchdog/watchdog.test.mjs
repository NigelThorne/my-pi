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
} from './watchdog.ts';
import { IdleInboxDelivery } from './inbox.ts';

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

test('watchdog prompts ask whether work is done, blocked, or actually progressing', () => {
  assert.match(recoveryPrompt('activity:auth'), /Are you done, blocked, or actually working/i);
  assert.match(recoveryPrompt('activity:auth'), /Do not merely acknowledge/i);
  assert.match(retryPrompt('activity:auth', 'ack only'), /Do not acknowledge/i);
});

test('blocked instructions say where to post, who to mention, and which tools to use', () => {
  const instruction = blockingQuestionInstruction('activity:auth');
  assert.match(instruction, /send_message/);
  assert.match(instruction, /activityId "activity:auth"/);
  assert.match(instruction, /log/);
  assert.match(instruction, /orchestrator/);
  assert.match(instruction, /@Nigel Thorne/);
  assert.match(instruction, /set_my_status/);
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

test('classifies mentions and subscribed-thread replies as inbound events', () => {
  assert.equal(isInboundEvent({ type: 'mention' }), true);
  assert.equal(isInboundEvent({ type: 'thread_reply' }), true);
  assert.equal(isInboundEvent({ type: 'peer_changed' }), false);
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
