#!/usr/bin/env zsh
set -euo pipefail

ROOT=${0:A:h:h}
TMUX_BIN="$(mise where tmux@3.6a)/bin/tmux"
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/tmux-workflow-helpers.XXXXXX")
TMP_ROOT=${TMP_ROOT:A}
SOCKET="$TMP_ROOT/tmux.sock"
WORK="$TMP_ROOT/work tree"
BIN="$TMP_ROOT/bin"
mkdir -p "$WORK" "$BIN"

cleanup() {
  "$TMUX_BIN" -S "$SOCKET" kill-server >/dev/null 2>&1 || true
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

fail() {
  print -u2 -- "FAIL: $*"
  exit 1
}

assert_contains() {
  local label=$1 haystack=$2 needle=$3
  [[ "$haystack" == *"$needle"* ]] || fail "$label: expected <$needle> in <$haystack>"
}

wait_for_file() {
  local file=$1
  local attempt
  for attempt in {1..100}; do
    [[ -f "$file" ]] && return 0
    sleep 0.01
  done
  fail "timed out waiting for $file"
}

ln -s "$TMUX_BIN" "$BIN/tmux"
cat > "$BIN/llm" <<'SH'
#!/bin/sh
cat > "$LLM_INPUT"
printf 'ok\n'
SH
chmod +x "$BIN/llm"
cat > "$BIN/curl" <<'SH'
#!/bin/sh
printf 'not-the-local-script\n'
SH
chmod +x "$BIN/curl"
cat > "$BIN/md5sum" <<'SH'
#!/bin/sh
cat >/dev/null
printf 'test-hash  -\n'
SH
chmod +x "$BIN/md5sum"

"$TMUX_BIN" -S "$SOCKET" -f /dev/null new-session -d -s helpers -n parent -c "$WORK" sh -c 'printf "TMUX-SCREEN-CONTEXT\\n"; sleep 30'
PANE=$("$TMUX_BIN" -S "$SOCKET" display-message -p -t helpers:parent '#{pane_id}')
SESSION_ID=$("$TMUX_BIN" -S "$SOCKET" display-message -p -t "$PANE" '#{session_id}')
TMUX_ENV="$SOCKET,123,0"

# Screen capture uses the exact current tmux pane for every ask wrapper.
for helper in ask ask-with-tools ask-ollama; do
  input="$TMP_ROOT/$helper.input"
  output=$(env PATH="$BIN:$PATH" TMUX="$TMUX_ENV" TMUX_PANE="$PANE" LLM_INPUT="$input" "$HOME/bin/$helper" claude 'explain this' </dev/null)
  [[ "$output" == *ok* ]] || fail "$helper did not invoke llm"
  wait_for_file "$input"
  captured=$(<"$input")
  assert_contains "$helper tmux capture" "$captured" 'TMUX-SCREEN-CONTEXT'
done

# Piped input still wins over mux capture.
piped_input="$TMP_ROOT/piped.input"
printf 'PIPE-CONTEXT\n' | env PATH="$BIN:$PATH" TMUX="$TMUX_ENV" TMUX_PANE="$PANE" LLM_INPUT="$piped_input" "$HOME/bin/ask" claude 'explain pipe' >/dev/null
assert_contains 'ask piped input' "$(<"$piped_input")" 'PIPE-CONTEXT'

# The legacy Zellij capture path remains available.
cat > "$BIN/zellij" <<'SH'
#!/bin/sh
if [ "$1 $2" = 'action dump-screen' ]; then
  printf 'ZELLIJ-SCREEN-CONTEXT\n' > "$3"
  exit 0
fi
if [ "$1 $2" = 'action new-tab' ]; then
  printf '%s\n' "$@" > "$ZELLIJ_LOG"
  printf '17\n'
  exit 0
fi
exit 2
SH
chmod +x "$BIN/zellij"
zellij_input="$TMP_ROOT/zellij.input"
env -u TMUX -u TMUX_PANE PATH="$BIN:$PATH" ZELLIJ=1 LLM_INPUT="$zellij_input" "$HOME/bin/ask" claude 'explain this' </dev/null >/dev/null
assert_contains 'ask Zellij capture' "$(<"$zellij_input")" 'ZELLIJ-SCREEN-CONTEXT'

BAD_BIN="$TMP_ROOT/bad-bin"
mkdir "$BAD_BIN"
ln -s "$BIN/llm" "$BIN/curl" "$BAD_BIN/"
cat > "$BAD_BIN/tmux" <<'SH'
#!/bin/sh
printf 'must-not-be-captured\n'
SH
chmod +x "$BAD_BIN/tmux"
if env PATH="$BAD_BIN:$PATH" TMUX="$TMUX_ENV" TMUX_PANE='%1oops' LLM_INPUT="$TMP_ROOT/invalid.input" \
  "$HOME/bin/ask" claude 'invalid identity' </dev/null >/dev/null 2>&1; then
  fail 'ask accepted a malformed tmux pane ID'
fi

RENAME_BIN="$TMP_ROOT/rename-bin"
RENAME_LOG="$TMP_ROOT/rename.log"
mkdir "$RENAME_BIN"
cat > "$RENAME_BIN/tmux" <<'SH'
#!/bin/sh
printf '%s\n' "$@" > "$RENAME_LOG"
SH
cat > "$RENAME_BIN/zellij" <<'SH'
#!/bin/sh
printf '%s\n' "$@" > "$RENAME_LOG"
SH
chmod +x "$RENAME_BIN/tmux" "$RENAME_BIN/zellij"
env PATH="$RENAME_BIN:$PATH" RENAME_LOG="$RENAME_LOG" TMUX="$TMUX_ENV" TMUX_PANE="$PANE" \
  "$ROOT/shell/mux-rename-pane.zsh" 'Agent D'
rename_args=$(<"$RENAME_LOG")
assert_contains 'rename helper explicit tmux socket' "$rename_args" "$SOCKET"
assert_contains 'rename helper exact tmux pane' "$rename_args" "$PANE"
assert_contains 'rename helper title' "$rename_args" 'Agent D'
env -u TMUX -u TMUX_PANE PATH="$RENAME_BIN:$PATH" RENAME_LOG="$RENAME_LOG" ZELLIJ_PANE_ID=42 \
  "$ROOT/shell/mux-rename-pane.zsh" 'Legacy Agent'
rename_args=$(<"$RENAME_LOG")
assert_contains 'rename helper Zellij compatibility' "$rename_args" 'rename-pane'
assert_contains 'rename helper exact Zellij pane' "$rename_args" '42'

# Forking uses the Pi SDK on a disposable history and launches a direct tmux window.
session_data=$(SESSION_DIR="$TMP_ROOT/sessions" CWD="$WORK" node --input-type=module <<'NODE'
import { SessionManager } from '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
const manager = SessionManager.create(process.env.CWD, process.env.SESSION_DIR);
manager.appendMessage({ role: 'user', content: 'fake history only', timestamp: Date.now() });
const entry = manager.appendMessage({
  role: 'assistant',
  content: [{ type: 'text', text: 'fake response' }],
  api: 'test',
  provider: 'test',
  model: 'test',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: 'stop',
  timestamp: Date.now(),
});
manager.appendMessage({ role: 'user', content: 'latest fake prompt', timestamp: Date.now() });
process.stdout.write(`${manager.getSessionFile()}\t${entry}`);
NODE
)
IFS=$'\t' read -r SESSION_FILE ENTRY_ID <<< "$session_data"
PI_OBSERVED="$TMP_ROOT/pi-observed"
cat > "$BIN/pi" <<SH
#!/bin/sh
printf '%s\\n' "\$PWD" "\$@" > ${(q)PI_OBSERVED}
sleep 30
SH
chmod +x "$BIN/pi"
fork_output=$(env PATH="$BIN:$PATH" TMUX="$TMUX_ENV" TMUX_PANE="$PANE" "$HOME/.local/bin/pi-fork-tab" --session "$SESSION_FILE" --at "$ENTRY_ID" --window-name 'Fork Window')
assert_contains 'fork output backend id' "$fork_output" 'window_id: @'
wait_for_file "$PI_OBSERVED"
pi_observed=$(<"$PI_OBSERVED")
assert_contains 'fork cwd' "$pi_observed" "$WORK"
assert_contains 'fork argv session' "$pi_observed" '--session'
assert_contains 'fork argv name' "$pi_observed" 'Fork Window'
active_windows=$("$TMUX_BIN" -S "$SOCKET" list-windows -t helpers -F '#{window_active}:#{window_name}')
assert_contains 'fork keeps parent window selected' "$active_windows" '1:parent'
FORK_SESSION=$(print -r -- "$fork_output" | awk '/fork_session:/ { sub(/^.*fork_session: /, ""); print; exit }')
[[ -n "$FORK_SESSION" && "$FORK_SESSION" != "$SESSION_FILE" && -f "$FORK_SESSION" ]] || fail 'fork session was not created from fake history'

ZELLIJ_LOG="$TMP_ROOT/zellij-launch.log"
env -u TMUX -u TMUX_PANE PATH="$BIN:$PATH" ZELLIJ=1 ZELLIJ_LOG="$ZELLIJ_LOG" \
  "$HOME/.local/bin/pi-fork-tab" --session "$SESSION_FILE" --at "$ENTRY_ID" --tab-name 'Legacy Fork' >/dev/null
zellij_launch=$(<"$ZELLIJ_LOG")
assert_contains 'fork Zellij compatibility' "$zellij_launch" 'new-tab'
assert_contains 'fork Zellij cwd' "$zellij_launch" "$WORK"
assert_contains 'fork Zellij name' "$zellij_launch" 'Legacy Fork'

real_detached_output=$(env PI_TMUX_EXECUTABLE="$TMUX_BIN" "$HOME/.local/bin/open-detached-tmux-sessions" --socket "$SOCKET" --dry-run)
assert_contains 'real detached tmux discovery' "$real_detached_output" 'helpers'

# The separately named attach helper keeps the Zellij helper untouched and uses an explicit socket.
ATTACH_LOG="$TMP_ROOT/attach.log"
rm "$BIN/tmux"
cat > "$BIN/tmux" <<'SH'
#!/bin/sh
printf '%s\n' "$@" > "$ATTACH_LOG"
SH
chmod +x "$BIN/tmux"
env PATH="$BIN:$PATH" ATTACH_LOG="$ATTACH_LOG" "$HOME/.local/bin/ghostty-attach-tmux-session" "$SESSION_ID" "$SOCKET" helpers >/dev/null
attach_args=$(<"$ATTACH_LOG")
assert_contains 'attach explicit socket' "$attach_args" "$SOCKET"
assert_contains 'attach exact session ID' "$attach_args" "$SESSION_ID"

# Detached-session discovery has its own tmux-named entry point and dry-run is side-effect free.
cat > "$BIN/tmux" <<'SH'
#!/bin/sh
if [ "$3" = list-sessions ]; then
  printf '$1\tdetached-one\t0\n$2\tattached-one\t1\n'
else
  exit 2
fi
SH
chmod +x "$BIN/tmux"
detached_output=$(env PATH="$BIN:$PATH" "$HOME/.local/bin/open-detached-tmux-sessions" --socket "$SOCKET" --dry-run)
assert_contains 'detached session listed' "$detached_output" 'detached-one'
[[ "$detached_output" != *attached-one* ]] || fail 'attached session must not be opened'

# Tiled helpers are additive and never redefine the existing z-prefixed functions.
source "$ROOT/shell/tmux-helpers.zsh"
(( $+functions[tmux-run] )) || fail 'tmux-run missing'
(( $+functions[tmux-edit] )) || fail 'tmux-edit missing'
(( $+functions[re-tmux] )) || fail 're-tmux missing'
(( ! $+functions[zr] && ! $+functions[ze] )) || fail 'tmux helpers must not replace Zellij helper names'

run_marker="$TMP_ROOT/tmux-run.marker"
(
  TMUX="$TMUX_ENV" TMUX_PANE="$PANE" PI_TMUX_EXECUTABLE="$TMUX_BIN" \
    tmux-run "printf 'run-ok\\n' > ${(q)run_marker}; sleep 30" >/dev/null
)
wait_for_file "$run_marker"
assert_contains 'tmux-run command' "$(<"$run_marker")" 'run-ok'

editor_log="$TMP_ROOT/editor.log"
cat > "$BIN/test-editor" <<SH
#!/bin/sh
printf '%s\\n' "\$@" > ${(q)editor_log}
sleep 30
SH
chmod +x "$BIN/test-editor"
(
  TMUX="$TMUX_ENV" TMUX_PANE="$PANE" PI_TMUX_EXECUTABLE="$TMUX_BIN" EDITOR="$BIN/test-editor" \
    tmux-edit "$WORK/file with spaces.txt" >/dev/null
)
wait_for_file "$editor_log"
assert_contains 'tmux-edit exact file argv' "$(<"$editor_log")" "$WORK/file with spaces.txt"

REATTACH_LOG="$TMP_ROOT/reattach.log"
cat > "$BIN/fake-tmux" <<'SH'
#!/bin/sh
case " $* " in
  *' list-sessions '*) printf '100\t$1\thelpers\n' ;;
  *' attach-session '*) printf '%s\n' "$@" > "$REATTACH_LOG" ;;
  *) exit 2 ;;
esac
SH
chmod +x "$BIN/fake-tmux"
(
  unset TMUX TMUX_PANE
  REATTACH_LOG="$REATTACH_LOG" PI_TMUX_EXECUTABLE="$BIN/fake-tmux" PI_TMUX_SOCKET_PATH="$SOCKET" "$HOME/bin/re-tmux"
)
reattach_args=$(<"$REATTACH_LOG")
assert_contains 're-tmux script explicit socket' "$reattach_args" "$SOCKET"
assert_contains 're-tmux script latest session ID' "$reattach_args" '$1'
[[ "${reattach_args##*$'\n'}" == '$1' ]] || fail 're-tmux routed by a display name instead of session ID'
(
  unset TMUX TMUX_PANE
  REATTACH_LOG="$REATTACH_LOG" PI_TMUX_EXECUTABLE="$BIN/fake-tmux" PI_TMUX_SOCKET_PATH="$SOCKET" re-tmux
)
reattach_args=$(<"$REATTACH_LOG")
assert_contains 're-tmux function delegates' "$reattach_args" '$1'

FAIL_REATTACH_LOG="$TMP_ROOT/fail-reattach.log"
cat > "$BIN/failing-tmux" <<'SH'
#!/bin/sh
printf '%s\n' "$@" >> "$FAIL_REATTACH_LOG"
exit 1
SH
chmod +x "$BIN/failing-tmux"
if env -u TMUX -u TMUX_PANE FAIL_REATTACH_LOG="$FAIL_REATTACH_LOG" PI_TMUX_EXECUTABLE="$BIN/failing-tmux" \
  PI_TMUX_SOCKET_PATH="$SOCKET" "$HOME/bin/re-tmux" >/dev/null 2>&1; then
  fail 're-tmux succeeded when server discovery failed'
fi
[[ "$(<"$FAIL_REATTACH_LOG")" != *new-session* ]] || fail 're-tmux created a session after uncertain discovery'

print -- 'PASS: tmux workflow helpers'
