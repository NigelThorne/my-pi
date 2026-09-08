# macOS focus tracker

`mac-focus-tracker` is a personal macOS LaunchAgent that writes local JSONL records for frontmost-app changes and, after Accessibility permission is granted, focused-window and window-title changes.

It writes no network data. It records plaintext application names, bundle IDs, process IDs, and window titles.

## Install

```bash
apps/macos-focus-tracker/install.sh
```

The installer builds `~/.my-pi/apps/MacFocusTracker.app`, installs `com.nigelthorne.mac-focus-tracker` in `~/Library/LaunchAgents`, bootstraps it for the current GUI user, and opens macOS Accessibility settings. Grant Accessibility permission to the installed app bundle, not to a command-line binary. The tracker logs app focus before that permission is granted. It adds window-title records once macOS trusts the app.

Use `apps/macos-focus-tracker/install.sh --dry-run` to see the installation commands without changing the system.

## Read the log

```bash
tail -f "$HOME/Library/Application Support/mac-focus-tracker/focus.jsonl"
```

Each line is one JSON object. Events are `ready`, `focus_changed`, `accessibility_state_changed`, and `window_title_changed`. The process writes a `focus_changed` record when an app becomes frontmost. It writes `window_title_changed` records when an accessibility-compliant app changes the focused window or its title. Some apps do not expose a title or send title notifications.

Pi timeline entries and focus records are independent. Join them by timestamp when processing a work timeline.
