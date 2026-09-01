#!/bin/zsh

set -eu
setopt pipefail

readonly REPO_ROOT=${0:A:h:h}
readonly BOOTSTRAP=${REPO_ROOT}/shell/ghostty-zellij-bootstrap.zsh

integer passed=0
integer failed=0

fail() {
  print -u2 -- "FAIL: $1"
  (( failed += 1 ))
}

pass() {
  print -- "PASS: $1"
  (( passed += 1 ))
}

assert_contains() {
  local name=$1
  local output=$2
  local expected=$3

  if [[ $output == *${expected}* ]]; then
    pass "$name"
  else
    fail "$name (missing ${expected:q} in ${output:q})"
  fi
}

assert_not_contains() {
  local name=$1
  local output=$2
  local unexpected=$3

  if [[ $output != *${unexpected}* ]]; then
    pass "$name"
  else
    fail "$name (found ${unexpected:q} in ${output:q})"
  fi
}

run_case() {
  local scenario=$1
  local call_log
  call_log=$(mktemp)

  TERM=xterm-ghostty PS1='$ ' SCENARIO=$scenario ZELLIJ_CALL_LOG=$call_log \
    zsh -fdi -c '
      _pi_ghostty_bootstrap_ps() {
        local field=${2%=}
        local pid=$4

        case "$SCENARIO:$field:$pid" in
          outer:ppid:$$|stale:ppid:$$|managed:ppid:$$|invalid:ppid:$$) print -- "  200 " ;;
          outer:comm:$$|stale:comm:$$|managed:comm:$$|invalid:comm:$$) print -- -zsh ;;
          outer:ppid:200|stale:ppid:200|managed:ppid:200|invalid:ppid:200) print -- 300 ;;
          outer:comm:200|stale:comm:200|managed:comm:200|invalid:comm:200) print -- /usr/bin/login ;;
          outer:ppid:300|stale:ppid:300|managed:ppid:300|invalid:ppid:300) print -- 1 ;;
          outer:comm:300|stale:comm:300|managed:comm:300|invalid:comm:300) print -- /Applications/Ghostty.app/Contents/MacOS/ghostty ;;
          inner:ppid:$$) print -- 400 ;;
          inner:comm:$$) print -- /bin/zsh ;;
          inner:ppid:400) print -- 1 ;;
          inner:comm:400) print -- /opt/homebrew/bin/zellij ;;
          *) return 1 ;;
        esac
      }

      _pi_ghostty_bootstrap_tty() {
        print -- /dev/ttys123
      }

      _pi_ghostty_bootstrap_uuidgen() {
        print -- 123E4567-E89B-12D3-A456-426614174000
      }

      _pi_ghostty_bootstrap_zellij() {
        print -r -- "zellij=${ZELLIJ-unset} args=${(j: :)${(q)@}}" >> "$ZELLIJ_CALL_LOG"
        if [[ $1 == setup && $2 == --generate-auto-start && $3 == zsh ]]; then
          print -- "export TEST_ZELLIJ_STARTED=1"
          return 0
        fi
        [[ $1 == list-sessions ]] && return 1
        return 0
      }

      _pi_ghostty_bootstrap_exec_zellij() {
        print -r -- "exec-zellij=${ZELLIJ-unset} args=${(j: :)${(q)@}}" >> "$ZELLIJ_CALL_LOG"
        export TEST_ZELLIJ_STARTED=1
      }

      if [[ $SCENARIO == stale ]]; then
        export ZELLIJ=0
        export ZELLIJ_SESSION_NAME=stale-session
        export ZELLIJ_PANE_ID=99
      elif [[ $SCENARIO == managed ]]; then
        export PI_GHOSTTY_ZELLIJ_BOOTSTRAP_MODE=managed
        export PI_GHOSTTY_ZELLIJ_ACTION=run-pi
        export PI_GHOSTTY_ZELLIJ_WORKSPACE=pi-test-session
        export PI_GHOSTTY_ZELLIJ_WORKING_DIRECTORY="/tmp/project with space"
        export PI_GHOSTTY_ZELLIJ_EXECUTABLE=/custom/bin/zellij
        export PI_GHOSTTY_ZELLIJ_PI_EXECUTABLE=/custom/bin/pi
        export PI_GHOSTTY_ZELLIJ_PI_ARGC=2
        export PI_GHOSTTY_ZELLIJ_PI_ARG_0=--session
        export PI_GHOSTTY_ZELLIJ_PI_ARG_1="/tmp/session with space.jsonl"
      elif [[ $SCENARIO == invalid ]]; then
        export PI_GHOSTTY_ZELLIJ_BOOTSTRAP_MODE=managed
        export PI_GHOSTTY_ZELLIJ_ACTION=unsafe-action
        export PI_GHOSTTY_ZELLIJ_WORKING_DIRECTORY=/tmp
        export PI_GHOSTTY_ZELLIJ_PI_ARGC=0
        setopt nounset
      fi

      source "'$BOOTSTRAP'"

      print -- "started=${TEST_ZELLIJ_STARTED-0}"
      print -- "app_pid=${PI_GHOSTTY_APP_PID-}"
      print -- "parent_tty=${PI_GHOSTTY_PARENT_TTY-}"
      print -- "token=${PI_GHOSTTY_HANDSHAKE_TOKEN-}"
      print -- "zellij=${ZELLIJ-unset}"
      print -- "zellij_session=${ZELLIJ_SESSION_NAME-unset}"
      print -- "zellij_pane=${ZELLIJ_PANE_ID-unset}"
      print -- "managed_mode=${PI_GHOSTTY_ZELLIJ_BOOTSTRAP_MODE-unset}"
      print -- "calls_begin"
      [[ -f $ZELLIJ_CALL_LOG ]] && cat "$ZELLIJ_CALL_LOG"
      print -- "calls_end"
    ' 2>/dev/null
  local exit_status=$?
  rm -f "$call_log"
  return $exit_status
}

outer_output=$(run_case outer)
assert_contains "outer Ghostty shell starts Zellij" "$outer_output" "started=1"
assert_contains "outer Ghostty shell exports app PID" "$outer_output" "app_pid=300"
assert_contains "outer Ghostty shell exports validated TTY" "$outer_output" "parent_tty=/dev/ttys123"
assert_contains "outer Ghostty shell exports UUID handshake" "$outer_output" "token=123E4567-E89B-12D3-A456-426614174000"

inner_output=$(run_case inner)
assert_contains "inner Zellij shell does not start nested Zellij" "$inner_output" "started=0"
assert_contains "inner Zellij shell has no Ghostty app identity" "$inner_output" "app_pid="
assert_contains "inner Zellij shell has no handshake token" "$inner_output" "token="

stale_output=$(run_case stale)
assert_contains "stale ZELLIJ does not block proven outer bootstrap" "$stale_output" "started=1"
assert_contains "proven outer bootstrap clears stale ZELLIJ" "$stale_output" "zellij=unset"
assert_contains "proven outer bootstrap clears stale session name" "$stale_output" "zellij_session=unset"
assert_contains "proven outer bootstrap clears stale pane id" "$stale_output" "zellij_pane=unset"

managed_output=$(run_case managed)
assert_contains "managed launch starts Zellij exactly once" "$managed_output" "started=1"
assert_contains "managed launch creates a missing workspace" "$managed_output" "args=attach --create-background pi-test-session"
assert_contains "managed launch runs Pi with exact route and spaced arguments" "$managed_output" "args=--session pi-test-session run --close-on-exit --cwd /tmp/project\\ with\\ space -- /usr/bin/env PI_GHOSTTY_APP_PID=300 PI_GHOSTTY_PARENT_TTY=/dev/ttys123 PI_GHOSTTY_HANDSHAKE_TOKEN=123E4567-E89B-12D3-A456-426614174000 /custom/bin/pi --session /tmp/session\\ with\\ space.jsonl"
assert_contains "managed launch attaches after starting Pi" "$managed_output" "args=attach pi-test-session"
assert_not_contains "managed launch skips ordinary generated autostart" "$managed_output" "args=setup --generate-auto-start zsh"
assert_contains "managed contract variables are consumed" "$managed_output" "managed_mode=unset"
assert_contains "managed Zellij calls see cleared stale session state" "$managed_output" "zellij=unset args=list-sessions"

invalid_output=$(run_case invalid)
assert_contains "invalid managed contract does not start Zellij" "$invalid_output" "started=0"
assert_contains "invalid managed contract is consumed before returning to shell" "$invalid_output" "managed_mode=unset"
assert_not_contains "invalid managed contract executes no Zellij commands" "$invalid_output" "args="

assert_not_contains "phase 1 does not emit an OSC title" "$outer_output" $'\e]2;'

print -- "\n${passed} passed, ${failed} failed"
(( failed == 0 ))
