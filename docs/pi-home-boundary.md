# Pi home directory boundary

`~/.my-pi` is the version-controlled source of truth for Nigel's pi configuration.

`~/.pi` is pi's runtime home. Keep only local/runtime data there:

- `~/.pi/agent/auth.json` — auth/session tokens
- `~/.pi/agent/models.json` — local provider/model config and API keys
- `~/.pi/agent/settings.json` — generated/local copy of `~/.my-pi/settings.example.json`, plus runtime-only fields such as `lastChangelogVersion`
- `~/.pi/agent/keybindings.json` — symlink to `~/.my-pi/keybindings.json`
- `~/.pi/agent/sessions/` — session logs
- `~/.pi/history/` — session artifacts/history
- `~/.pi/agent/memory/`, `~/.pi/memory/`, `~/.pi/.pi/memory/` — memory state
- `~/.pi/agent/disabled_extensions/` — local extension enable/disable toggles
- package-installed third-party skills under `~/.pi/agent/skills/`

Do not keep hand-written extensions, agents, or prompt/config source files in `~/.pi`.

Versioned sources now live in:

- `~/.my-pi/AGENTS.md`
- `~/.my-pi/agents/`
- `~/.my-pi/extensions/`
- `~/.my-pi/skills/`
- `~/.my-pi/keybindings.json`
- `~/.my-pi/settings.example.json`
- `~/.my-pi/docs/`
