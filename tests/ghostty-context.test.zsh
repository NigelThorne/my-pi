#!/bin/zsh

set -eu
setopt pipefail

readonly REPO_ROOT=${0:A:h:h}
readonly CONTEXT=${REPO_ROOT}/shell/ghostty-context.zsh

integer passed=0
integer failed=0

fail() { print -u2 -- "FAIL: $1"; (( failed += 1 )); }
pass() { print -- "PASS: $1"; (( passed += 1 )); }

assert_contains() {
  local name=$1 output=$2 expected=$3
  [[ $output == *${expected}* ]] && pass "$name" || fail "$name (missing ${expected:q})"
}

assert_empty() {
  local name=$1 output=$2
  [[ -z $output ]] && pass "$name" || fail "$name (got ${output:q})"
}

assert_not_contains() {
  local name=$1 output=$2 unexpected=$3
  [[ $output != *${unexpected}* ]] && pass "$name" || fail "$name (found ${unexpected:q})"
}

run_case() {
  local scenario=$1

  SCENARIO=$scenario zsh -f -c '
    _pi_ghostty_context_ps() {
      local field=${2%=} pid=$4
      case "$field:$pid" in
        ppid:100) print -- 200 ;;
        comm:200) print -- /usr/bin/login ;;
        ppid:200) print -- 300 ;;
        comm:300) print -- /Applications/Ghostty.app/Contents/MacOS/ghostty ;;
        *) return 1 ;;
      esac
    }
    _pi_ghostty_context_tty() { print -- /dev/ttys123; }
    _pi_ghostty_context_uuidgen() { print -- 123E4567-E89B-12D3-A456-426614174000; }
    _pi_ghostty_context_set_route_title() { :; }
    _pi_ghostty_context_sleep() { :; }
    _pi_ghostty_context_osascript() {
      case "$SCENARIO" in
        direct) print -- $'"'"'window-direct\tterminal-direct'"'"' ;;
        title) print -- $'"'"'window-title\tterminal-title'"'"' ;;
        missing) return 1 ;;
      esac
    }
    export PI_GHOSTTY_CONTEXT_PID=100
    [[ $SCENARIO == direct ]] && export GHOSTTY_SURFACE_ID=terminal-direct
    [[ $SCENARIO == startup ]] && export PI_GHOSTTY_CONTEXT_RESOLVE_SURFACE=0
    source "'$CONTEXT'"
  '
}

direct_output=$(run_case direct)
assert_contains "direct surface exports the owning app PID" "$direct_output" "export PI_GHOSTTY_APP_PID=300"
assert_contains "direct surface exports the controlling tty" "$direct_output" "export PI_GHOSTTY_TTY=/dev/ttys123"
assert_contains "direct surface keeps the compatibility tty export" "$direct_output" "export PI_GHOSTTY_PARENT_TTY=/dev/ttys123"
assert_contains "direct surface exports a handshake token" "$direct_output" "export PI_GHOSTTY_HANDSHAKE_TOKEN=123E4567-E89B-12D3-A456-426614174000"
assert_contains "direct surface exports the exact window ID" "$direct_output" "export PI_GHOSTTY_WINDOW_ID=window-direct"
assert_contains "direct surface exports the exact terminal ID" "$direct_output" "export PI_GHOSTTY_TERMINAL_ID=terminal-direct"

title_output=$(run_case title)
assert_contains "route title lookup exports the owning app PID" "$title_output" "export PI_GHOSTTY_APP_PID=300"
assert_contains "route title lookup exports its window ID" "$title_output" "export PI_GHOSTTY_WINDOW_ID=window-title"
assert_contains "route title lookup exports its terminal ID" "$title_output" "export PI_GHOSTTY_TERMINAL_ID=terminal-title"

missing_output=$(run_case missing)
assert_contains "missing surface still exports the app PID" "$missing_output" "export PI_GHOSTTY_APP_PID=300"
assert_not_contains "missing surface omits a window ID" "$missing_output" "PI_GHOSTTY_WINDOW_ID"
assert_not_contains "missing surface omits a terminal ID" "$missing_output" "PI_GHOSTTY_TERMINAL_ID"

startup_output=$(run_case startup)
assert_contains "startup exports the owning app PID without surface discovery" "$startup_output" "export PI_GHOSTTY_APP_PID=300"
assert_contains "startup exports the controlling tty without surface discovery" "$startup_output" "export PI_GHOSTTY_TTY=/dev/ttys123"
assert_not_contains "startup does not resolve a window" "$startup_output" "PI_GHOSTTY_WINDOW_ID"
assert_not_contains "startup does not resolve a terminal" "$startup_output" "PI_GHOSTTY_TERMINAL_ID"

print -- "\n${passed} passed, ${failed} failed"
(( failed == 0 ))
