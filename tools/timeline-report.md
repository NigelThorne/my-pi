# Timeline report

`timeline-report.mjs` reads a Pi session JSONL file and prints a compact TOON summary. It does not modify session or focus data.

```bash
node tools/timeline-report.mjs session <session.jsonl> \
  --focus-log "$HOME/Library/Application Support/mac-focus-tracker/focus.jsonl"
```

The report includes:

- calendar time between the first and last telemetry event
- model time from turn start until the turn ends or a tool starts
- tool-wait time, with parallel tools counted once by elapsed time
- residual idle time after model and tool intervals
- foreground-app time within that session window

`Ghostty` foreground time means a Ghostty window was frontmost. It does not yet prove which Pi session had focus. The report does not infer attention, PAT, CI, deployment, or work outcomes.
