---
name: session-outliner
description: Use when taking over, investigating, searching, or auditing a Pi session JSONL log, especially to understand another agent's work, drill into tool activity, or identify measured time loss and errors.
---

# Session outliner

Use `session-outliner` for the content and timing of a Pi session. It reads Pi JSONL directly and keeps reasoning and bulky tool results out of the default views.

## Quick workflow

```bash
# Orient yourself. A path alone means overview.
session-outliner ~/.pi/agent/sessions/<session>.jsonl

# See timestamped events and concise tool activity.
session-outliner timeline <session>.jsonl

# Find a topic, command, or output fragment, then inspect its event.
session-outliner search <session>.jsonl "query"
session-outliner show <session>.jsonl e42

# Audit tool duration, failures, and timestamp gaps.
session-outliner waste <session>.jsonl
session-outliner waste <session>.jsonl --over 30
```

`waste` measures tool-call-to-result time. Its other gaps are observations only. They can mean reasoning, waiting, interruption, or unrecorded work.

Use `--json` when another program or agent will analyse the result. Use Retro's `pi-session-view.mjs --tree` separately when you need to establish the active branch of a branched session before reading it.
