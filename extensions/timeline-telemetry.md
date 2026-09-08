# Timeline telemetry

`timeline-telemetry.ts` records Pi lifecycle events as `custom` entries with `customType: "timeline-telemetry"` in the active session JSONL file. Pi auto-loads extensions in this directory. Restart Pi or run `/reload` in an existing session to activate it.

Each entry uses Pi's session-entry timestamp. The extension records:

- submitted input source and delivery mode
- agent start and settled states
- turn start and end
- final token and cache usage for assistant turns
- tool execution start and end, including the tool name, call ID, and error state
- session shutdown reason

The extension writes no prompt text, images, tool arguments, tool output, file paths, PAT numbers, or network requests.

These entries measure Pi activity. They do not prove human attention, identify CI work, report a deployment, or include macOS window focus. Use explicit work and pipeline events to join those later.
