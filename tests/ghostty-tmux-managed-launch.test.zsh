#!/bin/zsh

set -u
setopt pipefail
zmodload zsh/datetime
unset PI_GHOSTTY_APP_PID PI_GHOSTTY_PARENT_TTY PI_GHOSTTY_HANDSHAKE_TOKEN
unset PI_GHOSTTY_WINDOW_ID PI_GHOSTTY_TERMINAL_ID TMUX TMUX_PANE

readonly REPO_ROOT=${0:A:h:h}
readonly HELPER=${REPO_ROOT}/shell/ghostty-tmux-managed-launch.zsh
integer passed=0
integer failed=0
pass() { print -- "PASS: $1"; (( passed += 1 )); }
fail() { print -u2 -- "FAIL: $1"; (( failed += 1 )); }
assert_equal() { [[ $2 == $3 ]] && pass "$1" || fail "$1 (expected ${3:q}, got ${2:q})"; }
assert_contains() { [[ $2 == *$3* ]] && pass "$1" || fail "$1 (missing ${3:q})"; }
assert_not_contains() { [[ $2 != *$3* ]] && pass "$1" || fail "$1 (found ${3:q})"; }

make_mock_tmux() {
  local path=$1
  /bin/cat > "$path" <<'MOCK'
#!/bin/zsh
set -u
print -r -- "${(j: :)${(q)@}}" >> "$MOCK_CALL_LOG"

if [[ ${MOCK_SCENARIO-} == hung && " $* " == *" display-message "* ]]; then
  /bin/sleep 6
fi

if [[ ${1-} == -S && ${3-} == display-message && ${6-} == -t ]]; then
  :
fi

if [[ ${1-} == -S && ${3-} == display-message && ${4-} == -p && ${5-} == -t ]]; then
  print -r -- "${MOCK_SERVER_PID}"$'\t''$2'$'\t''@3'$'\t''%7'
  exit 0
fi

if [[ ${1-} == -S && ${3-} == display-message && ${4-} == -p && ${5-} == -c ]]; then
  if [[ ! -f $MOCK_STATE_DIR/attached ]]; then
    print -r -- $'\t\t\t\t'
    exit 0
  fi
  local owner_pid=$(<"$MOCK_STATE_DIR/owner-pid")
  print -r -- "${owner_pid}"$'\t''/dev/ttys123'$'\t''$2'$'\t''@3'$'\t''%7'
  exit 0
fi

if [[ ${1-} == -S && ${3-} == new-session ]]; then
  exit 0
fi

if [[ ${1-} == -S && ${3-} == attach-session ]]; then
  print -r -- $$ > "$MOCK_STATE_DIR/owner-pid"
  : > "$MOCK_STATE_DIR/attached"
  integer attempt
  for attempt in {1..300}; do
    if [[ -f $MOCK_READINESS_DIRECTORY/status ]]; then
      [[ $(<"$MOCK_READINESS_DIRECTORY/status") == ready ]] && exit 0
      exit 71
    fi
    /bin/sleep 0.01
  done
  exit 72
fi
exit 64
MOCK
  /bin/chmod 700 "$path"
}

new_case() {
  local directory
  directory=$(/usr/bin/mktemp -d /tmp/pi-tmux-managed-test.XXXXXX) || return 1
  /bin/mkdir "$directory/readiness"
  : > "$directory/calls"
  make_mock_tmux "$directory/tmux"
  print -r -- "$directory"
}

/bin/sleep 30 &
readonly TEST_SERVER_PID=$!
trap '/bin/kill "$TEST_SERVER_PID" 2>/dev/null || true; wait "$TEST_SERVER_PID" 2>/dev/null || true' EXIT
readonly TEST_SERVER_START=$(LC_ALL=C /bin/ps -p "$TEST_SERVER_PID" -o lstart= | /usr/bin/sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

run_directory=$(new_case)
/bin/mkdir "$run_directory/project with space"
readonly run_socket_directory="$run_directory/private socket"
: > "$run_directory/pi"
/bin/chmod 700 "$run_directory/pi"
if MOCK_SCENARIO=run \
    MOCK_STATE_DIR="$run_directory" MOCK_CALL_LOG="$run_directory/calls" \
    MOCK_READINESS_DIRECTORY="$run_directory/readiness" \
    PI_GHOSTTY_TMUX_ACTION=run-pi \
    PI_GHOSTTY_TMUX_EXECUTABLE="$run_directory/tmux" \
    PI_GHOSTTY_TMUX_SOCKET_PATH="$run_socket_directory/socket" \
    PI_GHOSTTY_TMUX_WORKSPACE=pi-test-unique \
    PI_GHOSTTY_TMUX_WORKING_DIRECTORY="$run_directory/project with space" \
    PI_GHOSTTY_TMUX_PI_EXECUTABLE="$run_directory/pi" \
    PI_GHOSTTY_TMUX_PI_ARGC=2 \
    PI_GHOSTTY_TMUX_PI_ARG_0=--session \
    PI_GHOSTTY_TMUX_PI_ARG_1='/tmp/session with space.jsonl' \
    PI_GHOSTTY_APP_PID=300 PI_GHOSTTY_PARENT_TTY=/dev/ttys123 \
    PI_GHOSTTY_HANDSHAKE_TOKEN=AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE \
    PI_GHOSTTY_WINDOW_ID=window-managed PI_GHOSTTY_TERMINAL_ID=terminal-managed \
    PTC_ALLOW_UNSANDBOXED_SUBPROCESS=true \
    MYCELIUM_CONNECTED_COMMAND='connected hook with spaces' \
    MYCELIUM_HELP_FALLBACK_COMMAND='fallback hook with spaces' \
    /bin/zsh "$HELPER" >"$run_directory/output" 2>&1; then run_status=0; else run_status=$?; fi
run_calls=$(<"$run_directory/calls")
assert_equal "run-pi succeeds" "$run_status" 0
assert_contains "run-pi uses the explicit socket" "$run_calls" "-S ${(q)run_socket_directory}/socket new-session"
[[ -d $run_socket_directory && ! -L $run_socket_directory ]] && pass "run-pi creates a fresh socket parent" || fail "run-pi creates a fresh socket parent"
assert_equal "run-pi socket parent is private" "$(/usr/bin/stat -f %Lp "$run_socket_directory" 2>/dev/null)" 700
assert_contains "run-pi creates the unique requested session" "$run_calls" "-s pi-test-unique"
assert_contains "run-pi preserves spaced cwd as one argument" "$run_calls" "-c $run_directory/project\\ with\\ space"
assert_contains "run-pi directly executes Pi" "$run_calls" "$run_directory/pi --session /tmp/session\\ with\\ space.jsonl"
assert_contains "run-pi passes exact Ghostty terminal identity" "$run_calls" "PI_GHOSTTY_TERMINAL_ID=terminal-managed"
assert_contains "run-pi overrides a reused server with current PTC policy" "$run_calls" "PTC_ALLOW_UNSANDBOXED_SUBPROCESS=true"
assert_contains "run-pi overrides a reused server with the current Mycelium connected hook" "$run_calls" "MYCELIUM_CONNECTED_COMMAND=connected\\ hook\\ with\\ spaces"
assert_contains "run-pi overrides a reused server with the current Mycelium fallback hook" "$run_calls" "MYCELIUM_HELP_FALLBACK_COMMAND=fallback\\ hook\\ with\\ spaces"
assert_not_contains "run-pi does not set global subagent mux" "$run_calls" "PI_SUBAGENT_MUX"
/bin/rm -rf "$run_directory"

attach_directory=$(new_case)
/bin/mkdir "$attach_directory/project with space"
if MOCK_SCENARIO=attach \
    MOCK_STATE_DIR="$attach_directory" MOCK_CALL_LOG="$attach_directory/calls" \
    MOCK_READINESS_DIRECTORY="$attach_directory/readiness" \
    MOCK_SERVER_PID="$TEST_SERVER_PID" \
    PI_GHOSTTY_TMUX_ACTION=attach \
    PI_GHOSTTY_TMUX_EXECUTABLE="$attach_directory/tmux" \
    PI_GHOSTTY_TMUX_SOCKET_PATH="$attach_directory/socket" \
    PI_GHOSTTY_TMUX_SERVER_PID="$TEST_SERVER_PID" \
    PI_GHOSTTY_TMUX_SERVER_START_TIME="$TEST_SERVER_START" \
    PI_GHOSTTY_TMUX_SESSION_ID='$2' PI_GHOSTTY_TMUX_WINDOW_ID='@3' PI_GHOSTTY_TMUX_PANE_ID='%7' \
    PI_GHOSTTY_TMUX_READINESS_PATH="$attach_directory/readiness/status" \
    PI_GHOSTTY_TMUX_WORKING_DIRECTORY="$attach_directory/project with space" \
    PI_GHOSTTY_TMUX_PI_ARGC=0 \
    PI_GHOSTTY_APP_PID=300 PI_GHOSTTY_PARENT_TTY=/dev/ttys123 \
    PI_GHOSTTY_HANDSHAKE_TOKEN=AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE \
    PI_GHOSTTY_WINDOW_ID=window-managed PI_GHOSTTY_TERMINAL_ID=terminal-managed \
    /bin/zsh "$HELPER" >"$attach_directory/output" 2>&1; then attach_status=0; else attach_status=$?; fi
attach_calls=$(<"$attach_directory/calls")
assert_equal "attach succeeds" "$attach_status" 0
attach_readiness=$([[ -f "$attach_directory/readiness/status" ]] && <"$attach_directory/readiness/status" || print -r -- missing)
assert_equal "attach publishes ready after client ownership is verified" "$attach_readiness" ready
attach_client=$([[ -f "$attach_directory/readiness/client" ]] && <"$attach_directory/readiness/client" || print -r -- missing)
attach_owner_pid=$(<"$attach_directory/owner-pid")
assert_equal "attach privately publishes the controller-validated client identity" "$attach_client" "${attach_owner_pid}"$'\t/dev/ttys123'
assert_contains "attach validates target on the explicit socket" "$attach_calls" "display-message -p -t %7"
assert_contains "attach starts one client for the existing session" "$attach_calls" 'attach-session -t \$2'
assert_contains "attach selects the exact existing window" "$attach_calls" "select-window -t @3"
assert_contains "attach selects the exact existing pane" "$attach_calls" "select-pane -t %7"
assert_contains "attach verifies the exact Ghostty tty client" "$attach_calls" "display-message -p -c /dev/ttys123"
assert_not_contains "attach never starts Pi" "$attach_calls" "new-session"
assert_not_contains "attach never executes Pi" "$attach_calls" "/custom/bin/pi"
/bin/rm -rf "$attach_directory"

invalid_directory=$(new_case)
if MOCK_SCENARIO=attach \
    MOCK_STATE_DIR="$invalid_directory" MOCK_CALL_LOG="$invalid_directory/calls" \
    MOCK_READINESS_DIRECTORY="$invalid_directory/readiness" MOCK_SERVER_PID="$TEST_SERVER_PID" \
    PI_GHOSTTY_TMUX_ACTION=attach PI_GHOSTTY_TMUX_EXECUTABLE="$invalid_directory/tmux" \
    PI_GHOSTTY_TMUX_SOCKET_PATH="$invalid_directory/socket" \
    PI_GHOSTTY_TMUX_SERVER_PID="$TEST_SERVER_PID" PI_GHOSTTY_TMUX_SERVER_START_TIME='stale start' \
    PI_GHOSTTY_TMUX_SESSION_ID='$2' PI_GHOSTTY_TMUX_WINDOW_ID='@3' PI_GHOSTTY_TMUX_PANE_ID='%7' \
    PI_GHOSTTY_TMUX_READINESS_PATH="$invalid_directory/readiness/status" \
    PI_GHOSTTY_TMUX_WORKING_DIRECTORY=/tmp PI_GHOSTTY_TMUX_PI_ARGC=0 \
    PI_GHOSTTY_APP_PID=300 PI_GHOSTTY_PARENT_TTY=/dev/ttys123 \
    PI_GHOSTTY_HANDSHAKE_TOKEN=AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE \
    PI_GHOSTTY_WINDOW_ID=window-managed PI_GHOSTTY_TERMINAL_ID=terminal-managed \
    /bin/zsh "$HELPER" >"$invalid_directory/output" 2>&1; then invalid_status=0; else invalid_status=$?; fi
(( invalid_status != 0 )) && pass "stale server incarnation fails" || fail "stale server incarnation fails"
invalid_readiness=$([[ -f "$invalid_directory/readiness/status" ]] && <"$invalid_directory/readiness/status" || print -r -- missing)
assert_equal "stale server reports an error" "$invalid_readiness" error:server-incarnation-mismatch
invalid_calls=$(<"$invalid_directory/calls")
assert_not_contains "stale server never attaches" "$invalid_calls" "attach-session"
assert_not_contains "stale server never starts Pi" "$invalid_calls" "new-session"
/bin/rm -rf "$invalid_directory"

hung_directory=$(new_case)
typeset -F hung_started=$EPOCHREALTIME
if MOCK_SCENARIO=hung \
    MOCK_STATE_DIR="$hung_directory" MOCK_CALL_LOG="$hung_directory/calls" \
    MOCK_READINESS_DIRECTORY="$hung_directory/readiness" MOCK_SERVER_PID="$TEST_SERVER_PID" \
    PI_GHOSTTY_TMUX_ACTION=attach PI_GHOSTTY_TMUX_EXECUTABLE="$hung_directory/tmux" \
    PI_GHOSTTY_TMUX_SOCKET_PATH="$hung_directory/socket" \
    PI_GHOSTTY_TMUX_SERVER_PID="$TEST_SERVER_PID" PI_GHOSTTY_TMUX_SERVER_START_TIME="$TEST_SERVER_START" \
    PI_GHOSTTY_TMUX_SESSION_ID='$2' PI_GHOSTTY_TMUX_WINDOW_ID='@3' PI_GHOSTTY_TMUX_PANE_ID='%7' \
    PI_GHOSTTY_TMUX_READINESS_PATH="$hung_directory/readiness/status" \
    PI_GHOSTTY_TMUX_WORKING_DIRECTORY=/tmp PI_GHOSTTY_TMUX_PI_ARGC=0 \
    PI_GHOSTTY_APP_PID=300 PI_GHOSTTY_PARENT_TTY=/dev/ttys123 \
    PI_GHOSTTY_HANDSHAKE_TOKEN=AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE \
    PI_GHOSTTY_WINDOW_ID=window-managed PI_GHOSTTY_TERMINAL_ID=terminal-managed \
    /bin/zsh "$HELPER" >"$hung_directory/output" 2>&1; then hung_status=0; else hung_status=$?; fi
typeset -F hung_elapsed=$(( EPOCHREALTIME - hung_started ))
(( hung_status != 0 )) && pass "hung identity query fails" || fail "hung identity query fails"
(( hung_elapsed < 5.8 )) && pass "hung identity query stays inside readiness bound" || fail "hung identity query took ${hung_elapsed}s"
assert_not_contains "hung identity query never attaches" "$(<"$hung_directory/calls")" "attach-session"
/bin/rm -rf "$hung_directory"

print -- "\n${passed} passed, ${failed} failed"
(( failed == 0 ))
