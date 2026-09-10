# macOS focus tracker

`mac-focus-tracker` is a personal macOS LaunchAgent that writes local JSONL records for frontmost-app changes and, after Accessibility permission is granted, focused-window and window-title changes.

It writes no network data. It records plaintext application names, bundle IDs, process IDs, and window titles. For Ghostty, it also records the stable ID of the front window and the focused terminal when Ghostty exposes both through AppleScript.

## Install

```bash
apps/macos-focus-tracker/install.sh
```

The installer builds `~/.my-pi/apps/MacFocusTracker.app`, installs `com.nigelthorne.mac-focus-tracker` in `~/Library/LaunchAgents`, bootstraps it for the current GUI user, and opens macOS Accessibility settings. Grant Accessibility permission to the installed app bundle, not to a command-line binary. The tracker logs app focus before that permission is granted. It adds window-title records once macOS trusts the app.

macOS asks once for Automation permission when the tracker first reads Ghostty's scripting interface. Allow `Mac Focus Tracker` to control `Ghostty` under System Settings > Privacy & Security > Automation. If permission is denied, Ghostty changes focus during the query, or Ghostty does not return an exact route, the tracker still writes the normal focus or window record and omits `ghostty_window_id` and `ghostty_terminal_id`. It never infers these IDs from the window title.

Use `apps/macos-focus-tracker/install.sh --dry-run` to see the installation commands without changing the system.

## Read the log

```bash
tail -f "$HOME/Library/Application Support/mac-focus-tracker/focus.jsonl"
```

Each line is one JSON object. Events are `ready`, `focus_changed`, `accessibility_state_changed`, `focused_window_observed`, `focused_window_changed`, and `window_title_changed`. The process writes a `focus_changed` record when an app becomes frontmost. It writes `focused_window_observed` after attaching Accessibility to the current window and `focused_window_changed` when macOS reports a different focused window. `window_title_changed` means that the current window's title changed without necessarily changing focus. Some apps do not expose a title or send title notifications. Ghostty focus and window records include `ghostty_window_id` and `ghostty_terminal_id` when both IDs are available.

Pi timeline entries and focus records are independent. Join them by timestamp when processing a work timeline.
