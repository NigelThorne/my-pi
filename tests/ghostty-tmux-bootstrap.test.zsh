#!/bin/zsh

set -eu
setopt pipefail

readonly REPO_ROOT=${0:A:h:h}
readonly BOOTSTRAP=${REPO_ROOT}/shell/ghostty-tmux-bootstrap.zsh

integer passed=0
integer failed=0
pass() { print -- "PASS: $1"; (( passed += 1 )); }
fail() { print -u2 -- "FAIL: $1"; (( failed += 1 )); }
assert_contains() { [[ $2 == *$3* ]] && pass "$1" || fail "$1 (missing ${3:q})"; }
assert_not_contains() { [[ $2 != *$3* ]] && pass "$1" || fail "$1 (found ${3:q})"; }

run_case() {
  local scenario=$1 directory output case_status
  directory=$(/usr/bin/mktemp -d /tmp/pi-tmux-bootstrap-test.XXXXXX)
  /bin/cat > "$directory/tmux-launcher" <<'LAUNCHER'
#!/bin/zsh
print -- "tmux-managed=${PI_GHOSTTY_TMUX_ACTION-}"
print -- "mux-global=${PI_SUBAGENT_MUX-unset}"
LAUNCHER
  /bin/cat > "$directory/zellij-launcher" <<'LAUNCHER'
#!/bin/zsh
print -- "zellij-managed=${PI_GHOSTTY_ZELLIJ_ACTION-}"
LAUNCHER
  : > "$directory/tmux"
  /bin/chmod 700 "$directory/tmux" "$directory/tmux-launcher" "$directory/zellij-launcher"

  if output=$(TERM=dumb PS1='$ ' SCENARIO=$scenario CALL_LOG="$directory/calls" \
      TEST_DIRECTORY="$directory" zsh -fdi -c '
    TERM=xterm-ghostty
    unset TMUX TMUX_PANE PI_SUBAGENT_MUX
    unset PI_GHOSTTY_TMUX_BOOTSTRAP_MODE PI_GHOSTTY_TMUX_ACTION
    unset PI_GHOSTTY_ZELLIJ_BOOTSTRAP_MODE PI_GHOSTTY_ZELLIJ_ACTION
    _pi_ghostty_tmux_bootstrap_context() {
      [[ $SCENARIO != nested ]] || return 1
      print -- "export PI_GHOSTTY_APP_PID=300"
      print -- "export PI_GHOSTTY_TTY=/dev/ttys123"
      print -- "export PI_GHOSTTY_PARENT_TTY=/dev/ttys123"
      print -- "export PI_GHOSTTY_HANDSHAKE_TOKEN=123E4567-E89B-12D3-A456-426614174000"
      print -- "export PI_GHOSTTY_WINDOW_ID=window-1"
      print -- "export PI_GHOSTTY_TERMINAL_ID=terminal-1"
    }
    _pi_ghostty_tmux_bootstrap_claim_managed_request() {
      [[ $SCENARIO != replay ]]
    }
    _pi_ghostty_tmux_bootstrap_exec() {
      print -r -- "tmux=${TMUX-unset} pane=${TMUX_PANE-unset} args=${(j: :)${(q)@}}" >> "$CALL_LOG"
    }
    if [[ $SCENARIO == ordinary ]]; then
      export TMUX=/stale/socket,999,0 TMUX_PANE=%99
    elif [[ $SCENARIO == managed || $SCENARIO == replay ]]; then
      export PI_GHOSTTY_TMUX_BOOTSTRAP_MODE=managed
      export PI_GHOSTTY_TMUX_ACTION=attach
      export PI_GHOSTTY_TMUX_LAUNCHER="$TEST_DIRECTORY/tmux-launcher"
    elif [[ $SCENARIO == legacy ]]; then
      export PI_GHOSTTY_ZELLIJ_BOOTSTRAP_MODE=managed
      export PI_GHOSTTY_ZELLIJ_ACTION=attach
      export PI_GHOSTTY_ZELLIJ_LAUNCHER="$TEST_DIRECTORY/zellij-launcher"
    fi
    export PI_GHOSTTY_TMUX_EXECUTABLE="$TEST_DIRECTORY/tmux"
    source "'$BOOTSTRAP'"
    [[ -f $CALL_LOG ]] && /bin/cat "$CALL_LOG"
  ' 2>&1); then case_status=0; else case_status=$?; fi
  /bin/rm -rf "$directory"
  print -r -- "$output"
  print -- "status=$case_status"
}

ordinary=$(run_case ordinary)
assert_contains "ordinary direct Ghostty shell starts tmux" "$ordinary" "new-session"
assert_contains "ordinary launch clears replayed TMUX" "$ordinary" "tmux=unset pane=unset"
assert_not_contains "ordinary launch does not set a global subagent mux" "$ordinary" "mux-global=tmux"

nested=$(run_case nested)
assert_not_contains "nested shell does not start tmux" "$nested" "args=new-session"

managed=$(run_case managed)
assert_contains "managed tmux request dispatches once" "$managed" "tmux-managed=attach"
assert_contains "managed request leaves global subagent mux unset" "$managed" "mux-global=unset"
assert_not_contains "managed request does not start an ordinary session" "$managed" "args=new-session"

replay=$(run_case replay)
assert_not_contains "replayed request does not dispatch managed attach" "$replay" "tmux-managed=attach"
assert_contains "replayed request falls back to one ordinary tmux session" "$replay" "new-session"

legacy=$(run_case legacy)
assert_contains "legacy managed request still reaches its Zellij launcher" "$legacy" "zellij-managed=attach"
assert_not_contains "legacy managed request does not start tmux" "$legacy" "args=new-session"

print -- "\n${passed} passed, ${failed} failed"
(( failed == 0 ))
