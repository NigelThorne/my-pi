---
name: linear-axi
description: Use when listing, searching, viewing, creating, or updating Linear issues from an agent-facing shell CLI, especially PatientNotes PAT tickets.
---

# Linear AXI

Use the `linear-axi` command directly for Linear issue work. Do not call a skill-local wrapper script.

`linear-axi` emits compact TOON-style output and reads its API key from macOS Keychain.

## Auth

Keychain item:

```bash
security add-generic-password -U -s linear-api-key -a "$USER" -w '<linear-api-key>'
```

## Quick commands

```bash
linear-axi                              # recent PAT issue context
linear-axi list --status "In Progress"
linear-axi list --assignee "Nigel Thorne"
linear-axi search "template prompt"
linear-axi view PAT-123
linear-axi view PAT-123 --full
linear-axi create --title "Fix bug" -F /tmp/body.md --status Todo
linear-axi update PAT-123 --status "In Progress"
linear-axi comment PAT-123 "Started working on this"
linear-axi states
linear-axi labels
```

## Filtering AXI output

Prefer `toonq` over converting to JSON and piping to `jq`:

```bash
linear-axi list --limit 50 | toonq --head 5
linear-axi list --limit 50 | toonq -f '.issues[] | select(.state == "Todo")'
linear-axi list --limit 50 | toonq -f '.issues[] | .id'
```

Only convert when a downstream tool genuinely requires JSON:

```bash
linear-axi list --limit 50 | toonq --to json
```

## Notes

- Unknown flags fail with structured stdout and exit code 2.
- Long issue descriptions/comments are truncated unless `--full` is passed.
- Mutations are non-interactive; pass all required values as flags/args.
- AXI source: `/Users/nigelthorne/code/linear-axi`
- Executable: `/Users/nigelthorne/.local/bin/linear-axi`
