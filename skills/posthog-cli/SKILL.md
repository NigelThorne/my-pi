---
name: posthog-cli
description: Use when working with PostHog feature flags, logs, HogQL, events, persons, projects, or when the user asks to inspect or modify PostHog from the terminal.
---

# PostHog CLI

## Overview

Use the local `posthog` command for PostHog access. It reads the personal API key, project id, and host from macOS Keychain, so never ask the user to paste secrets into chat.

## Secrets

The CLI reads:

| Keychain service | Purpose |
|---|---|
| `posthog-api-key` | Personal API key |
| `posthog-project-id` | Default project/environment id |
| `posthog-host` | Optional host, defaults to `https://us.posthog.com` |

If missing, prompt via macOS UI or ask the user to run:

```bash
security add-generic-password -U -s posthog-api-key -a "$USER" -w 'phx_...'
security add-generic-password -U -s posthog-project-id -a "$USER" -w 'PROJECT_ID'
```

## Quick Reference

```bash
posthog projects
posthog hogql 'select * from events limit 10'
posthog events --limit 20
posthog persons --limit 20
```

Feature flags:

```bash
posthog flags list
posthog flags get FLAG_KEY_OR_ID
posthog flags status FLAG_KEY --days 7
posthog flags explain FLAG_KEY --days 7
```

Early access / beta features:

```bash
posthog early-access list
posthog early-access get EARLY_ACCESS_FEATURE_ID
POSTHOG_ALLOW_WRITE=1 posthog early-access create --flag-id FLAG_ID --name "Feature name" --stage beta --description "Shown in opt-in UI"
POSTHOG_ALLOW_WRITE=1 posthog early-access patch EARLY_ACCESS_FEATURE_ID '{"stage":"beta"}'
POSTHOG_ALLOW_WRITE=1 posthog early-access enroll-flag FLAG_KEY_OR_ID
```

Write operations are intentionally gated:

```bash
POSTHOG_ALLOW_WRITE=1 posthog flags rollout FLAG_KEY_OR_ID 25
POSTHOG_ALLOW_WRITE=1 posthog flags enable FLAG_KEY_OR_ID
POSTHOG_ALLOW_WRITE=1 posthog flags disable FLAG_KEY_OR_ID
POSTHOG_ALLOW_WRITE=1 posthog flags patch FLAG_KEY_OR_ID '{"active":true}'
```

Logs:

```bash
posthog logs --limit 20
posthog logs --level ERROR --service patientnotes-firebase --search timeout
posthog logs errors --days 1
posthog logs services
posthog logs attrs --search deployment
posthog logs query 'select count() from logs'
```

Raw API is read-only unless explicitly enabled:

```bash
posthog api GET /api/projects/
POSTHOG_ALLOW_WRITE=1 posthog api PATCH /api/projects/123/feature_flags/456/ '{"active":false}'
```

## Safety Rules

- Prefer read-only commands first: `flags get`, `flags list`, `logs`, `hogql`.
- Before changing a feature flag, fetch and inspect the current definition.
- Preserve existing `filters.groups` unless the user explicitly asks to replace them.
- Use `POSTHOG_ALLOW_WRITE=1` only for an explicit requested mutation.
- Verify mutations with a fresh `flags get` or relevant read query before reporting success.

## Common Tasks

Add an organization ID to a feature flag while preserving current rules:

```bash
posthog flags list > /tmp/flags.json
# Build a patch from the existing flag JSON, append a filters.groups rule:
# {"key":"organizationId","type":"person","value":["ORG_ID"],"operator":"exact"}
POSTHOG_ALLOW_WRITE=1 posthog flags patch FLAG_ID "$(cat /tmp/patch.json)"
posthog flags get FLAG_ID
```

Reason about a feature flag:

```bash
posthog flags explain FLAG_KEY --days 7
posthog flags status FLAG_KEY --days 7
posthog logs --search FLAG_KEY --days 1
```

Investigate logs:

```bash
posthog logs errors --days 1 --limit 50
posthog logs --service SERVICE_NAME --search 'some text'
posthog logs query 'select timestamp, severity_text, service_name, body from logs order by timestamp desc limit 20'
```

## Troubleshooting

- Run `command -v posthog` to confirm the CLI exists.
- Run `posthog --help` for current commands.
- A `phx_...` value is a normal PostHog personal API key format.
- If PostHog returns 403, the personal API key likely lacks the needed scope, e.g. `logs:read`.
