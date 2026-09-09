# Tmux workflow

Tmux support is additive. Zellij scripts and `zr`, `ze`, floating and in-place helpers keep their original meaning. The tmux startup block in `.zshrc` uses a bounded Ghostty ownership check, prevents nesting, and still dispatches legacy managed Zellij requests.

## Daily use

Tmux 3.6a is managed by mise. `~/.tmux.conf` sources this repository's `tmux.conf`.

- Drag text to copy it directly to the macOS clipboard. No extra copy key is needed.
- Shift+Enter remains distinct from Enter in Pi.
- Use `tmux-run 'command'` for a tiled command pane and `tmux-edit file` for an editor pane.
- Pi subagents and `/pass-the-buck` target the source pane's window, not whichever window happens to be selected.
- `pi-fork-tab` keeps its history-fork behavior and opens a tmux window when invoked in tmux.
- `ask`, `ask-with-tools` and `ask-ollama` capture the current tmux pane when no piped input is supplied. Their Zellij and piped-input paths remain available.
- Mycelium names the current pane through `shell/mux-rename-pane.zsh`.

From outside tmux, `re-tmux --socket /absolute/socket/path` attaches to the most recently active session on that server. `open-detached-tmux-sessions --socket /absolute/socket/path --dry-run` lists sessions without clients. Omit `--dry-run` to open attach windows. The existing `re-zellij` and Zellij-specific scripts are unchanged.

Display the current server socket inside tmux with:

```sh
tmux display-message -p '#{socket_path}'
```

## Session Manager

`~/code/pi_session_manager` supports both backends. A tmux route carries the socket, server incarnation and exact session/window/pane IDs. Ghostty window identity and validated client PID/TTY remain separate from the Pi conversation UUID and JSONL file.

Focus revalidates the route before switching. A live Pi without a terminal gets an attachment, not a second Pi. Confirmed-dead recovery uses the original full JSONL path and cwd. Unknown launch outcomes stay pending rather than authorizing another writer.

The tmux helpers coexist with `ghostty-zellij-*`; no global `PI_SUBAGENT_MUX=tmux` is needed. PTC and Mycelium environment settings must be exported before the bootstrap can launch Pi directly.

A `Pi Route <id>` window title is the bootstrap's location probe, not an error or Pi conversation name. Ordinary windows get fresh probe IDs; managed requests retain their claim-once token. The title can remain visible until the terminal updates it.

Ordinary startup passes the current Ghostty identity through `new-session -e`, rather than inheriting the tmux server's first window identity. Later panes and windows inherit their own session's values. Existing Pi processes are not rewritten; `/register-window` only republishes the identity they inherited and does not discover or repair a stale link.

See the app's `docs/session-activation.md` and `docs/tmux-integration-audit.md` for its routing contract and coverage.

## Checks

```sh
python3 tests/tmux-config.test.py
python3 tests/zshrc-tmux.test.py
python3 tests/tmux-detached-timeout.test.py
zsh tests/ghostty-tmux-bootstrap.test.zsh
python3 tests/ghostty-tmux-context.test.py
python3 tests/tmux-ordinary-environment.test.py
zsh tests/ghostty-tmux-managed-launch.test.zsh
zsh tests/tmux-workflow-helpers.test.zsh
node --test extensions/pass-the-buck/index.test.mjs
```

The config test uses disposable servers and a clipboard stub. Physical Ghostty mouse-drag copying was separately confirmed by Nigel. Live Ghostty attachment, process-backed Pi status, steering and completion were also exercised on owned fixtures.

## Rollback

The migration's private shell and mise backups are in `~/.local/state/pi-tmux-migration/rollback-20260908/`. Restore the original `.zshrc` there to return new-window startup to Zellij. Preserve any later shell edits before copying a full backup. Removing the new `~/.tmux.conf` source file reverses the managed tmux config without stopping running sessions.

Original external helper backups are in `~/.local/state/pi-tmux-migration-backups/tmux-D-20260908T224434/`. The pre-cutover frontend bundle is in `~/.local/state/pi-tmux-migration/frontend-before-cutover-20260908/`. Frontend rollback does not require deleting conversation files, databases or attachment receipts.

Floating/in-place parity, browser access and reboot persistence were not part of this migration. Their Zellij implementations remain available.
