# macOS focus tracker implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Run a personal macOS LaunchAgent that writes plaintext app-focus and Accessibility window-title changes to a local JSONL file.

**Architecture:** A Swift executable uses `NSWorkspace` notifications for frontmost application transitions. It uses macOS Accessibility APIs when the executable is trusted to observe focused-window and title changes. It keeps writing app-focus records when Accessibility is unavailable. A user LaunchAgent starts one durable process at login; Pi remains an independent telemetry source and a later processor joins both streams by timestamp.

**Tech Stack:** Swift 6, AppKit, ApplicationServices Accessibility APIs, Swift Package Manager, launchd LaunchAgent, local JSONL.

**Risks and acceptance criteria:** The tracker handles sensitive plaintext titles, by explicit user request. It makes no network requests. It must create no child processes, emit a valid JSON object per line, use a stable binary path for Accessibility permission, log app focus without Accessibility permission, cleanly switch to window-title tracking after permission becomes available, and terminate when launchd unloads it.

---

### Task 1: Define and test the JSONL event format

**Files:**
- Create: `apps/macos-focus-tracker/Package.swift`
- Create: `apps/macos-focus-tracker/Tests/FocusTrackerCoreTests/FocusRecordTests.swift`
- Create: `apps/macos-focus-tracker/Sources/FocusTrackerCore/FocusRecord.swift`

**Step 1: Write the failing test**

Create a test that constructs an app-focus record and checks that `encodedLine()` is one JSON object followed by one newline. Add a second test that checks optional window fields are omitted when Accessibility has not supplied them.

**Step 2: Run test to verify it fails**

Run: `cd apps/macos-focus-tracker && swift test`

Expected: FAIL because `FocusTrackerCore` and `FocusRecord` do not exist.

**Step 3: Write minimal implementation**

Add `FocusRecord`, a Codable plaintext schema, and `encodedLine()`. Keep the core module Foundation-only so its JSON contract is testable without macOS focus APIs.

**Step 4: Run test to verify it passes**

Run: `cd apps/macos-focus-tracker && swift test`

Expected: PASS.

### Task 2: Observe app and window focus locally

**Files:**
- Create: `apps/macos-focus-tracker/Sources/mac-focus-tracker/main.swift`
- Modify: `apps/macos-focus-tracker/Package.swift`
- Modify: `apps/macos-focus-tracker/Tests/FocusTrackerCoreTests/FocusRecordTests.swift`

**Step 1: Write the failing test**

Add a test that verifies `FocusRecord` can distinguish `focus_changed`, `window_title_changed`, `ready`, and Accessibility state records without putting an absent title into JSON.

**Step 2: Run test to verify it fails**

Run: `cd apps/macos-focus-tracker && swift test`

Expected: FAIL for the missing supported event contract.

**Step 3: Write minimal implementation**

Implement the executable:

- parse `--output <absolute path>`
- append and synchronize one JSONL record per event
- immediately report the current frontmost app and subscribe to `NSWorkspace.didActivateApplicationNotification`
- report Accessibility state
- when trusted, attach `AXObserver` to the active process, observe focused-window changes, then observe title changes on the focused window
- retry trust checks so granting permission activates title tracking without a restart
- handle `SIGTERM` and `SIGINT` by flushing and exiting

**Step 4: Run test and build verification**

Run:

```bash
cd apps/macos-focus-tracker
swift test
swift build -c release
```

Expected: PASS and a release executable.

### Task 3: Install and run at login

**Files:**
- Create: `apps/macos-focus-tracker/install.sh`
- Create: `apps/macos-focus-tracker/com.nigelthorne.mac-focus-tracker.plist.template`
- Modify: `apps/macos-focus-tracker/README.md`
- External: `~/.my-pi/bin/mac-focus-tracker`
- External: `~/Library/LaunchAgents/com.nigelthorne.mac-focus-tracker.plist`
- External: `~/Library/Application Support/mac-focus-tracker/focus.jsonl`

**Step 1: Write the installation script**

The script must build the release binary, install it to `~/.my-pi/bin/mac-focus-tracker`, render a plist with absolute paths, create the local log directory, unload any existing agent, bootstrap the agent for the current user, and verify the expected launchd service is present.

**Step 2: Test in dry-run mode**

Run: `apps/macos-focus-tracker/install.sh --dry-run`

Expected: shows the exact build, install, plist, and launchctl operations without changing the system.

**Step 3: Install and start**

Run: `apps/macos-focus-tracker/install.sh`

Expected: the LaunchAgent is bootstrapped and the JSONL log gets a `ready` and `focus_changed` record.

**Step 4: Grant Accessibility permission**

Open the macOS Accessibility Privacy pane, grant the stable `~/.my-pi/bin/mac-focus-tracker` executable permission, then switch windows and confirm `window_title_changed` records appear.

**Step 5: Commit**

```bash
git add apps/macos-focus-tracker docs/plans/2026-09-08-macos-focus-tracker.md
git commit -m "feat: add macOS focus tracker"
```

### Task 4: Verify and review

**Files:**
- Review: `apps/macos-focus-tracker/**`

**Step 1: Run focused checks**

```bash
cd apps/macos-focus-tracker
swift test
swift build -c release
```

**Step 2: Inspect the live log**

```bash
tail -n 10 "$HOME/Library/Application Support/mac-focus-tracker/focus.jsonl"
```

Expected: well-formed JSONL records with local timestamps.

**Step 3: Review the completed change**

Request one scoped review for plaintext data handling, Accessibility lifecycle, launchd ownership, and cleanup. Block only concrete defects or unmet acceptance criteria.
