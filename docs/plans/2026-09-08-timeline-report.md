# Timeline report implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provide a local, read-only command that summarizes Pi model, tool, idle, and foreground-app time for a saved session.

**Architecture:** A dependency-free Node module parses the active branch of Pi JSONL entries and `timeline-telemetry` custom entries. It derives non-overlapping model and tool intervals, intersects the session window with macOS focus intervals, and renders a compact TOON report. The first slice does not infer PATs, CI, deployment, actual human attention, or a particular Pi terminal from a generic Ghostty focus event.

**Tech Stack:** Node.js ESM, built-in test runner, Pi JSONL, local focus JSONL, TOON stdout.

---

### Task 1: Parse durable timelines and derive Pi activity intervals

**Files:**
- Create: `tools/timeline-report.mjs`
- Create: `tools/timeline-report.test.mjs`

**Step 1: Write the failing test**

Add a synthetic session JSONL fixture in the test that includes a session header, telemetry custom entries, one model-only turn, and one turn with two parallel tools. Assert that the summary reports calendar duration, model duration, tool-wait duration as the union of parallel tool intervals, and idle duration without double-counting.

**Step 2: Run test to verify it fails**

Run: `node --test tools/timeline-report.test.mjs`

Expected: FAIL because the report module does not exist.

**Step 3: Write minimal implementation**

Implement pure functions that:

- select the active branch from parent IDs
- read custom `timeline-telemetry` entries in timestamp order
- represent model time from `turn_start` through the first tool start or `turn_end`
- represent tool time from matching tool start/end entries
- union overlapping intervals before summing
- derive calendar and residual idle duration

Do not classify command content, inspect prompts, or guess user attention.

**Step 4: Run test to verify it passes**

Run: `node --test tools/timeline-report.test.mjs`

Expected: PASS.

### Task 2: Join foreground app intervals

**Files:**
- Modify: `tools/timeline-report.mjs`
- Modify: `tools/timeline-report.test.mjs`

**Step 1: Write the failing test**

Add a focus JSONL fixture with application changes spanning the session bounds. Assert that the report clips intervals to the session window, sums duration per app, and treats the final interval as ending at the session end.

**Step 2: Run test to verify it fails**

Run: `node --test tools/timeline-report.test.mjs`

Expected: FAIL because focus intervals are not joined.

**Step 3: Write minimal implementation**

Parse only `focus_changed` records. Keep app name and bundle ID. Intersect each focus interval with the session window. Do not use window titles for session matching in this slice; titles identify context but cannot reliably identify one Pi session yet.

**Step 4: Run test to verify it passes**

Run: `node --test tools/timeline-report.test.mjs`

Expected: PASS.

### Task 3: Add an AXI command and document the data boundary

**Files:**
- Modify: `tools/timeline-report.mjs`
- Modify: `tools/timeline-report.test.mjs`
- Modify: `README.md`

**Step 1: Write the failing test**

Add a test that invokes `node tools/timeline-report.mjs session <fixture> --focus-log <fixture>` and asserts compact TOON output. Add a usage-error test for missing or unknown arguments.

**Step 2: Run test to verify it fails**

Run: `node --test tools/timeline-report.test.mjs`

Expected: FAIL because the command renderer and argument validation do not exist.

**Step 3: Write minimal implementation**

Implement one command:

```bash
node tools/timeline-report.mjs session <session.jsonl> [--focus-log <focus.jsonl>]
```

Render UTF-8 LF TOON to stdout. Send errors and progress only through the defined AXI channels. Include a definitive empty state if the session has no telemetry entries.

**Step 4: Run focused verification**

```bash
node --test tools/timeline-report.test.mjs
node tools/timeline-report.mjs session "$PI_SESSION_FILE" --focus-log "$HOME/Library/Application Support/mac-focus-tracker/focus.jsonl"
git diff --check
```

**Step 5: Commit**

```bash
git add tools/timeline-report.mjs tools/timeline-report.test.mjs README.md docs/plans/2026-09-08-timeline-report.md
git commit -m "feat: add local timeline report"
```
