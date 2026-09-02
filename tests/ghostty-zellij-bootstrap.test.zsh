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

readonly MANAGED_LAUNCHER=$(mktemp /tmp/pi-managed-bootstrap-launcher.XXXXXX)
/bin/cat > "$MANAGED_LAUNCHER" <<'LAUNCHER'
#!/bin/zsh
print -- "started=$([[ ${PI_GHOSTTY_ZELLIJ_ACTION-} == run-pi || ${PI_GHOSTTY_ZELLIJ_ACTION-} == attach ]] && print 1 || print 0)"
print -- "app_pid=${PI_GHOSTTY_APP_PID-}"
print -- "parent_tty=${PI_GHOSTTY_PARENT_TTY-}"
print -- "token=${PI_GHOSTTY_HANDSHAKE_TOKEN-}"
print -- "zellij=${ZELLIJ-unset}"
print -- "zellij_session=${ZELLIJ_SESSION_NAME-unset}"
print -- "zellij_pane=${ZELLIJ_PANE_ID-unset}"
print -- "managed_mode=${PI_GHOSTTY_ZELLIJ_BOOTSTRAP_MODE-unset}"
print -- "action=${PI_GHOSTTY_ZELLIJ_ACTION-}"
print -- "workspace=${PI_GHOSTTY_ZELLIJ_WORKSPACE-}"
print -- "pane=${PI_GHOSTTY_ZELLIJ_PANE_ID-}"
print -- "bootstrap=${PI_GHOSTTY_ZELLIJ_BOOTSTRAP_SESSION-}"
print -- "readiness=${PI_GHOSTTY_ZELLIJ_READINESS_PATH-}"
print -- "working_directory=${PI_GHOSTTY_ZELLIJ_WORKING_DIRECTORY-}"
print -- "zellij_executable=${PI_GHOSTTY_ZELLIJ_EXECUTABLE-}"
print -- "pi_argc=${PI_GHOSTTY_ZELLIJ_PI_ARGC-}"
[[ ${PI_GHOSTTY_ZELLIJ_ACTION-} == run-pi || ${PI_GHOSTTY_ZELLIJ_ACTION-} == attach ]]
LAUNCHER
/bin/chmod 700 "$MANAGED_LAUNCHER"
trap '/bin/rm -f "$MANAGED_LAUNCHER"' EXIT

run_case() {
  local scenario=$1
  local call_log output case_status
  call_log=$(mktemp)

  if output=$(TERM=dumb PS1='$ ' SCENARIO=$scenario ZELLIJ_CALL_LOG=$call_log \
      TEST_MANAGED_LAUNCHER="$MANAGED_LAUNCHER" \
    zsh -fdi -c '
      TERM=xterm-ghostty
      unset PI_GHOSTTY_APP_PID PI_GHOSTTY_PARENT_TTY PI_GHOSTTY_HANDSHAKE_TOKEN
      unset PI_GHOSTTY_ZELLIJ_BOOTSTRAP_MODE PI_GHOSTTY_ZELLIJ_ACTION
      unset PI_GHOSTTY_ZELLIJ_WORKSPACE PI_GHOSTTY_ZELLIJ_WORKING_DIRECTORY
      unset PI_GHOSTTY_ZELLIJ_PANE_ID PI_GHOSTTY_ZELLIJ_BOOTSTRAP_SESSION
      unset PI_GHOSTTY_ZELLIJ_READINESS_PATH PI_GHOSTTY_ZELLIJ_LAUNCHER
      unset PI_GHOSTTY_ZELLIJ_EXECUTABLE PI_GHOSTTY_ZELLIJ_PI_EXECUTABLE
      unset PI_GHOSTTY_ZELLIJ_PI_ARGC
      unset PI_GHOSTTY_ZELLIJ_PI_ARG_0 PI_GHOSTTY_ZELLIJ_PI_ARG_1
      unset ZELLIJ ZELLIJ_SESSION_NAME ZELLIJ_PANE_ID

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
        export PI_GHOSTTY_ZELLIJ_LAUNCHER="$TEST_MANAGED_LAUNCHER"
        export PI_GHOSTTY_ZELLIJ_ACTION=attach
        export PI_GHOSTTY_ZELLIJ_WORKSPACE=child-workspace
        export PI_GHOSTTY_ZELLIJ_PANE_ID=terminal_12
        export PI_GHOSTTY_ZELLIJ_BOOTSTRAP_SESSION=pi-focus-TEST
        export PI_GHOSTTY_ZELLIJ_READINESS_PATH=/tmp/pi-focus-TEST/status
        export PI_GHOSTTY_ZELLIJ_WORKING_DIRECTORY="/tmp/project with space"
        export PI_GHOSTTY_ZELLIJ_EXECUTABLE=/custom/bin/zellij
        export PI_GHOSTTY_ZELLIJ_PI_ARGC=0
      elif [[ $SCENARIO == invalid ]]; then
        export PI_GHOSTTY_ZELLIJ_BOOTSTRAP_MODE=managed
        export PI_GHOSTTY_ZELLIJ_LAUNCHER="$TEST_MANAGED_LAUNCHER"
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
    ' 2>/dev/null); then
    case_status=0
  else
    case_status=$?
  fi
  rm -f "$call_log"
  print -r -- "$output"
  print -r -- "exit_status=$case_status"
  return 0
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
assert_contains "managed launch dispatches exactly once" "$managed_output" "started=1"
assert_contains "managed launch receives cleared stale Zellij state" "$managed_output" "zellij=unset"
assert_contains "managed launch forwards attach action" "$managed_output" "action=attach"
assert_contains "managed launch forwards exact target workspace" "$managed_output" "workspace=child-workspace"
assert_contains "managed launch forwards exact target pane" "$managed_output" "pane=terminal_12"
assert_contains "managed launch forwards request bootstrap" "$managed_output" "bootstrap=pi-focus-TEST"
assert_contains "managed launch forwards request readiness path" "$managed_output" "readiness=/tmp/pi-focus-TEST/status"
assert_contains "managed launch forwards absolute working directory" "$managed_output" "working_directory=/tmp/project with space"
assert_contains "managed launch forwards configured Zellij" "$managed_output" "zellij_executable=/custom/bin/zellij"
assert_contains "managed attach forwards zero Pi arguments" "$managed_output" "pi_argc=0"
assert_not_contains "managed launch skips ordinary generated autostart" "$managed_output" "args=setup --generate-auto-start zsh"

invalid_output=$(run_case invalid)
assert_contains "invalid managed contract does not start Zellij" "$invalid_output" "started=0"
assert_contains "invalid managed contract returns nonzero" "$invalid_output" "exit_status=1"
assert_not_contains "invalid managed contract executes no Zellij commands" "$invalid_output" "args="

assert_not_contains "phase 1 does not emit an OSC title" "$outer_output" $'\e]2;'

print -- "\n${passed} passed, ${failed} failed"
(( failed == 0 ))
