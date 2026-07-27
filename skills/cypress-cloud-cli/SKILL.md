---
name: cypress-cloud-cli
description: Use when querying Cypress Cloud projects, runs, failed tests, flaky tests, test results, Cypress MCP data, or Cypress Cloud PAT/macOS Keychain auth from the terminal.
---

# Cypress Cloud CLI

## Overview

Use the local `cypress-cloud` command to query Cypress Cloud through the official Cypress Cloud MCP server. The user's Cypress MCP PAT is normally stored in macOS Keychain, so do not ask for it unless auth fails.

## When to Use

Use for requests involving:
- Cypress Cloud run status, results, failed tests, flaky tests, Test Replay links
- Cypress project listing or project IDs
- Cypress MCP personal access token (PAT) stored in macOS Keychain
- Run URLs like `https://cloud.cypress.io/projects/<projectId>/runs/<runNumber>`

Do not use for running local Cypress specs; use the project's normal Cypress commands for that.

## Quick Reference

| Need | Command |
| --- | --- |
| List projects | `cypress-cloud projects` |
| Run summary/results | `cypress-cloud results --run-url '<run-url>'` |
| Failed tests/errors | `cypress-cloud failures --run-url '<run-url>'` |
| Flaky tests | `cypress-cloud flaky --run-url '<run-url>'` |
| JSON for scripting | add `--json` |
| Store PAT | `cypress-cloud auth set --stdin-token` |
| Raw MCP tool | `cypress-cloud raw <tool> --arg key=value --json` |

Known PatientNotes project: `do5q24` (`Default Project`). Example:

```sh
cypress-cloud results --run-url 'https://cloud.cypress.io/projects/do5q24/runs/16075'
cypress-cloud failures --run-url 'https://cloud.cypress.io/projects/do5q24/runs/16075' --json
```

## Auth

Lookup order is:
1. `--token TOKEN`
2. `CYPRESS_MCP_TOKEN`
3. macOS Keychain item `cypress-cloud-mcp-pat`

The CLI executable is `~/.local/bin/cypress-cloud`, a wrapper around source at `/Users/nigelthorne/code/cypress_io_cli`.

## Troubleshooting

| Symptom | Meaning / Fix |
| --- | --- |
| `{"data":[]}` from `projects` | Try a direct run URL. If unauthorized, MCP integration may not be enabled for the org. |
| `The MCP integration is not enabled for this organization` | Enable Cloud MCP in Cypress Cloud org integrations, then retry. |
| Unauthorized/token errors | Regenerate Cypress MCP PAT at `https://cloud.cypress.io/profile`, then run `cypress-cloud auth set --stdin-token`. |
| Need exact project/run | Parse from run URL: `/projects/<projectId>/runs/<runNumber>`. |

## Common Mistakes

- Do not ask the user for the PAT before trying the Keychain-backed CLI.
- Do not assume org switching exists: the MCP `cypress_get_projects` tool has no org parameter.
- Use CLI commands (`failures`, `results`) rather than calling undocumented Cypress REST endpoints.
- Prefer `--json` when the output will be parsed or summarized.
