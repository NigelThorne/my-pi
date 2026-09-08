# Pi timeline telemetry implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist trustworthy Pi lifecycle events in each session JSONL file so later reporting can calculate model, tool, idle, and observed user-interaction intervals.

**Architecture:** A global Pi extension appends small `timeline-telemetry` custom entries to the active session when Pi emits lifecycle events. The entries are local, branch-aware, and need no server. Each entry has an event name, an ISO timestamp supplied by Pi's session writer, and only data available from the lifecycle hook. The extension does not infer human attention, CI state, or deployment status.

**Tech Stack:** TypeScript Pi extension, Node's built-in test runner, Pi session custom entries.

---

### Task 1: Define the durable event contract

**Files:**
- Create: `extensions/timeline-telemetry.ts`
- Test: `extensions/timeline-telemetry.test.mjs`

**Step 1: Write the failing test**

Create a test that imports the extension, registers it against a fake Pi API, and asserts that the extension subscribes to `input`, `agent_start`, `turn_start`, `turn_end`, `tool_execution_start`, `tool_execution_end`, `agent_settled`, and `session_shutdown`.

**Step 2: Run test to verify it fails**

Run: `node --test extensions/timeline-telemetry.test.mjs`

Expected: FAIL because the extension module does not exist.

**Step 3: Write minimal implementation**

Export the extension factory. Register the lifecycle hooks and append events with a fixed custom type, event name, source, and small typed metadata. Use `pi.appendEntry()` so Pi stores the event in the session JSONL and keeps it out of model context.

**Step 4: Run test to verify it passes**

Run: `node --test extensions/timeline-telemetry.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add extensions/timeline-telemetry.ts extensions/timeline-telemetry.test.mjs
git commit -m "feat: record Pi timeline telemetry"
```

### Task 2: Capture reliable data from each lifecycle transition

**Files:**
- Modify: `extensions/timeline-telemetry.ts`
- Modify: `extensions/timeline-telemetry.test.mjs`

**Step 1: Write failing tests**

Add tests that invoke captured handlers and assert:

- `input` records the submission source and whether it was queued as steering or follow-up work.
- `turn_end` records the index, stop reason, token usage, and tool-result count.
- tool events record the call ID, tool name, and final error status.
- `session_shutdown` records the shutdown reason.
- absent optional values are omitted instead of recorded as fabricated values.

**Step 2: Run tests to verify they fail**

Run: `node --test extensions/timeline-telemetry.test.mjs`

Expected: FAIL for each unimplemented event payload.

**Step 3: Write minimal implementation**

Add payload builders that copy only event values that Pi supplies. Never classify a command as CI, infer a PAT, inspect tool inputs, or measure human attention.

**Step 4: Run tests to verify they pass**

Run: `node --test extensions/timeline-telemetry.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add extensions/timeline-telemetry.ts extensions/timeline-telemetry.test.mjs
git commit -m "feat: capture Pi lifecycle timing events"
```

### Task 3: Document activation and the metric boundary

**Files:**
- Modify: `README.md`
- Test: `extensions/timeline-telemetry.test.mjs`

**Step 1: Write failing test**

Add a test that confirms the extension only uses `appendEntry` and does not require network access or a background process.

**Step 2: Run the focused test**

Run: `node --test extensions/timeline-telemetry.test.mjs`

Expected: PASS or FAIL only for the newly added assertion.

**Step 3: Document the extension**

Add a short README section with the custom entry type, activation instructions, emitted event names, and explicit limits: it records Pi activity, not actual attention, CI outcome, or deployment.

**Step 4: Run focused verification**

Run:

```bash
node --test extensions/timeline-telemetry.test.mjs
node --test extensions/pi-session-manager-presence.test.mjs
```

Expected: PASS. If the existing presence test fails because of the unrelated uncommitted presence refactor, record that separately and do not modify its files.

**Step 5: Inspect the diff**

Run: `git diff --check && git diff -- extensions/timeline-telemetry.ts extensions/timeline-telemetry.test.mjs README.md`

Expected: no whitespace errors; only the telemetry extension, its tests, and documentation change.

**Step 6: Commit**

```bash
git add extensions/timeline-telemetry.ts extensions/timeline-telemetry.test.mjs README.md docs/plans/2026-09-08-pi-timeline-telemetry.md
git commit -m "docs: describe Pi timeline telemetry"
```
