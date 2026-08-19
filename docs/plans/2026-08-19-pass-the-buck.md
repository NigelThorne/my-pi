# Pass the Buck Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `/pass-the-buck`, which launches an independent successor Pi session with the active conversation, supports a question/answer handoff, and retires the predecessor after the successor accepts ownership.

**Architecture:** A global extension creates a durable, per-handoff JSONL relay under `~/.pi/agent/pass-the-buck/`, launches a new Pi process in a Zellij pane using `--fork` from the current session, and gives both sessions tools to exchange questions, answers, and the takeover acknowledgement. The predecessor polls only its own relay, injects questions for its agent to answer, and on takeover runs `/retro` only when at least both 20% of the context window and 16K tokens remain; otherwise it shuts down.

**Tech Stack:** Pi TypeScript extension API, Node built-ins, Zellij CLI, `node:test`.

---

### Task 1: Define and test the relay protocol

**Files:**
- Create: `extensions/pass-the-buck/index.test.mjs`
- Create: `extensions/pass-the-buck/index.ts`

**Step 1: Write the failing tests**

Cover command registration, success-path process launch arguments (`pi --session … --fork …`), successor handoff prompt, relay protocol creation, `pass_the_buck_ask` response waiting, previous-session reply, and takeover event emission.

**Step 2: Run test to verify it fails**

Run: `node --test extensions/pass-the-buck/index.test.mjs`
Expected: FAIL because the extension does not exist.

**Step 3: Write minimal implementation**

Implement relay helpers, commands/tools, and session-role checks sufficient for each test.

**Step 4: Run test to verify it passes**

Run: `node --test extensions/pass-the-buck/index.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add extensions/pass-the-buck/index.ts extensions/pass-the-buck/index.test.mjs
git commit -m "feat: add pass-the-buck handoff command"
```

### Task 2: Launch a real independent Pi successor

**Files:**
- Modify: `extensions/pass-the-buck/index.ts`
- Modify: `extensions/pass-the-buck/index.test.mjs`

**Step 1: Write the failing test**

Assert a Zellij pane receives a shell-escaped command that changes to the source cwd, preserves extension-critical environment variables, uses the handoff UUID as the successor session id, forks the predecessor session, and passes the successor prompt.

**Step 2: Run test to verify it fails**

Run: `node --test extensions/pass-the-buck/index.test.mjs`
Expected: FAIL on missing launch details.

**Step 3: Write minimal implementation**

Use `zellij action new-pane --tab-id … --close-on-exit --` to start the independent Pi process and write the relay metadata before launch.

**Step 4: Run test to verify it passes**

Run: `node --test extensions/pass-the-buck/index.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add extensions/pass-the-buck/index.ts extensions/pass-the-buck/index.test.mjs
git commit -m "feat: launch independent handoff sessions"
```

### Task 3: Retire the predecessor safely and document usage

**Files:**
- Modify: `extensions/pass-the-buck/index.ts`
- Modify: `extensions/pass-the-buck/index.test.mjs`
- Modify: `README.md`

**Step 1: Write the failing test**

Assert predecessor takeover detection sends `/retro` through extension-command expansion when its context has sufficient headroom, and invokes graceful shutdown when it does not.

**Step 2: Run test to verify it fails**

Run: `node --test extensions/pass-the-buck/index.test.mjs`
Expected: FAIL on takeover completion behavior.

**Step 3: Write minimal implementation**

Poll the predecessor relay only while an active handoff exists, persist consumed event IDs through custom entries, and clean up timers at session shutdown. Document command behavior and the three successor tools.

**Step 4: Run test to verify it passes**

Run: `node --test extensions/pass-the-buck/index.test.mjs && npm run lint`
Expected: PASS.

**Step 5: Commit**

```bash
git add extensions/pass-the-buck/index.ts extensions/pass-the-buck/index.test.mjs README.md docs/plans/2026-08-19-pass-the-buck.md
git commit -m "docs: document pass-the-buck handoffs"
```

### Task 4: Verify and review

**Files:**
- Verify only

**Step 1: Run targeted and repository tests**

Run: `node --test extensions/pass-the-buck/index.test.mjs && npm run lint && npm test`
Expected: PASS.

**Step 2: Review the diff**

Request a reviewer agent to check relay isolation, shell escaping, stale-session handling, and lifecycle cleanup.

**Step 3: Address review findings and rerun verification**

Run the affected tests plus `npm run lint`.

**Step 4: Commit, push, and open a pull request**

```bash
git push -u origin HEAD
gh pr create --fill --body-file /tmp/pr-body.md
```
