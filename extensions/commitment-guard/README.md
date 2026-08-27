# Commitment Guard

A global Pi extension that prevents an agent from ending idle after it promises future operational work.

## Rule

A statement such as “I’ll monitor the build” is only valid after a durable executor exists. Valid executors are currently:

- a successfully launched `subagent` or `subagent_resume`; or
- a `bash` command that starts a detached process/pane (`nohup`, `disown`, `setsid`, `tmux new-window`, `zellij action new-pane`, or a background `&`).

A status marker, note, or intention is not an executor.

## Behaviour

1. Each agent turn gets a concise system-prompt reminder.
2. At settlement, the extension scans the final assistant text for operational promises such as “I’ll check”, “I will monitor”, or “I’m going to investigate”.
3. If no accepted executor launched in that run, it displays a warning and injects one automatic repair turn. The repair tells the agent to start the work or explicitly retract the promise.
4. A latch prevents an infinite repair loop. If the repair also makes an unsupported promise, the warning remains visible for the user.

Run `/commitment-guard` to inspect whether a repair is pending.

## Boundaries

This is deliberately a guardrail, not a generic job scheduler. It cannot prove every arbitrary shell process remains healthy. For a one-off delayed check, a foreground `sleep <seconds> && <check>` command remains the most reliable option because it completes before the final response.

Run the detector tests with:

```bash
node --test detector.test.mjs
```
