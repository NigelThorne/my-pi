#!/bin/zsh

set -u
setopt pipefail

readonly REPO_ROOT=${0:A:h:h}
readonly HELPER=${REPO_ROOT}/shell/ghostty-zellij-managed-launch.zsh

integer passed=0
integer failed=0

pass() {
  print -- "PASS: $1"
  (( passed += 1 ))
}

fail() {
  print -u2 -- "FAIL: $1"
  (( failed += 1 ))
}

assert_equal() {
  local name=$1 actual=$2 expected=$3
  if [[ $actual == $expected ]]; then
    pass "$name"
  else
    fail "$name (expected ${expected:q}, got ${actual:q})"
  fi
}

assert_contains() {
  local name=$1 output=$2 expected=$3
  if [[ $output == *${expected}* ]]; then
    pass "$name"
  else
    fail "$name (missing ${expected:q} in ${output:q})"
  fi
}

assert_not_contains() {
  local name=$1 output=$2 unexpected=$3
  if [[ $output != *${unexpected}* ]]; then
    pass "$name"
  else
    fail "$name (found ${unexpected:q} in ${output:q})"
  fi
}

assert_file_one_line_matching() {
  local name=$1 file=$2 pattern=$3
  local -a lines
  lines=("${(@f)$(<"$file")}")
  if (( ${#lines[@]} == 1 )) && [[ $lines[1] =~ $pattern ]]; then
    pass "$name"
  else
    fail "$name (contents ${$(<"$file"):q})"
  fi
}

wait_until() {
  local description=$1 command=$2
  local attempt
  for attempt in {1..100}; do
    if eval "$command"; then
      return 0
    fi
    /bin/sleep 0.02
  done
  fail "$description (timed out)"
  return 1
}

make_mock_zellij() {
  local path=$1
  /bin/cat > "$path" <<'MOCK'
#!/bin/zsh

set -u

log_call() {
  print -r -- "${(j: :)${(q)@}}" >> "$MOCK_CALL_LOG"
}

increment_counter() {
  local file=$1 count=0
  [[ -f $file ]] && count=$(<"$file")
  (( count += 1 ))
  print -r -- "$count" > "$file"
  print -r -- "$count"
}

log_call "$@"

if [[ ${1-} == list-sessions ]]; then
  increment_counter "$MOCK_STATE_DIR/list-sessions.count" >/dev/null
  [[ -f "$MOCK_STATE_DIR/session" ]] && print -r -- "$MOCK_BOOTSTRAP"
  exit 0
fi

if [[ ${1-} == attach && ${2-} == --create ]]; then
  [[ ${3-} == "$MOCK_BOOTSTRAP" ]] || exit 65
  : > "$MOCK_STATE_DIR/session"
  : > "$MOCK_STATE_DIR/attach.started"
  /bin/sleep 0.15
  : > "$MOCK_STATE_DIR/client"

  integer attempt
  for attempt in {1..700}; do
    if [[ -f "$MOCK_READINESS_DIRECTORY/status" ]]; then
      [[ $(<"$MOCK_READINESS_DIRECTORY/status") == ready ]] && exit 0
      exit 71
    fi
    /bin/sleep 0.01
  done
  exit 72
fi

if [[ ${1-} == --session && ${2-} == "$MOCK_BOOTSTRAP" \
    && ${3-} == action && ${4-} == list-clients ]]; then
  [[ $MOCK_SCENARIO == hung-command ]] && /bin/sleep 6
  print -r -- "CLIENT_ID ZELLIJ_PANE_ID RUNNING_COMMAND"
  [[ -f "$MOCK_STATE_DIR/client" ]] || exit 0
  case "$MOCK_SCENARIO" in
    timeout|signal) ;;
    multiple)
      print -r -- "1 terminal_1 zellij"
      print -r -- "2 terminal_2 zellij"
      ;;
    *) print -r -- "1 terminal_1 zellij" ;;
  esac
  exit 0
fi

if [[ ${1-} == --session && ${2-} == "$MOCK_BOOTSTRAP" \
    && ${3-} == action && ${4-} == switch-session ]]; then
  [[ ${5-} == child-workspace && ${6-} == --pane-id && ${7-} == terminal_12 ]] || exit 66
  [[ $MOCK_SCENARIO == switch-failure ]] && exit 67
  exit 0
fi

if [[ ${1-} == kill-session ]]; then
  [[ ${2-} == "$MOCK_BOOTSTRAP" ]] || exit 68
  /bin/rm -f "$MOCK_STATE_DIR/session" "$MOCK_STATE_DIR/client"
  : > "$MOCK_STATE_DIR/killed"
  exit 0
fi

if [[ ${1-} == --session && ${2-} == pi-test-session && ${3-} == --layout-string ]]; then
  print -r -- "$4" > "$MOCK_STATE_DIR/layout"
  exit 0
fi

exit 64
MOCK
  /bin/chmod 700 "$path"
}

new_case_directory() {
  local directory
  directory=$(/usr/bin/mktemp -d /tmp/pi-managed-launch-test.XXXXXX) || return 1
  /bin/mkdir "$directory/readiness"
  make_mock_zellij "$directory/zellij"
  print -r -- "$directory"
}

run_attach_case() {
  local scenario=$1 directory=$2
  local output

  if output=$(MOCK_SCENARIO="$scenario" \
      MOCK_STATE_DIR="$directory" \
      MOCK_CALL_LOG="$directory/calls" \
      MOCK_BOOTSTRAP=pi-focus-TEST \
      MOCK_READINESS_DIRECTORY="$directory/readiness" \
      PI_GHOSTTY_ZELLIJ_ACTION=attach \
      PI_GHOSTTY_ZELLIJ_WORKSPACE=child-workspace \
      PI_GHOSTTY_ZELLIJ_PANE_ID=terminal_12 \
      PI_GHOSTTY_ZELLIJ_BOOTSTRAP_SESSION=pi-focus-TEST \
      PI_GHOSTTY_ZELLIJ_READINESS_PATH="$directory/readiness/status" \
      PI_GHOSTTY_ZELLIJ_WORKING_DIRECTORY='/tmp/project with space' \
      PI_GHOSTTY_ZELLIJ_EXECUTABLE="$directory/zellij" \
      PI_GHOSTTY_ZELLIJ_PI_ARGC=0 \
      /bin/zsh "$HELPER" 2>&1); then
    ATTACH_STATUS=0
  else
    ATTACH_STATUS=$?
  fi
  ATTACH_OUTPUT=$output
}

assert_failure_cleanup() {
  local scenario=$1
  local directory calls case_status
  directory=$(new_case_directory) || return 1

  run_attach_case "$scenario" "$directory"
  case_status=$ATTACH_STATUS
  wait_until "$scenario cleans its bootstrap" "[[ -f ${(q)directory}/killed ]]" || true
  calls=$(<"$directory/calls")

  if (( case_status != 0 )); then
    pass "$scenario returns nonzero"
  else
    fail "$scenario returns nonzero"
  fi
  assert_file_one_line_matching "$scenario publishes one bounded error line" \
    "$directory/readiness/status" '^error:[[:alnum:]_.-]+$'
  assert_contains "$scenario kills its request bootstrap" "$calls" 'kill-session pi-focus-TEST'
  assert_not_contains "$scenario never kills the target workspace" "$calls" 'kill-session child-workspace'
  assert_not_contains "$scenario never creates or runs Pi" "$calls" '--layout-string'
  /bin/rm -rf "$directory"
}

# Existing run-pi behavior remains isolated from attach.
run_directory=$(new_case_directory)
if MOCK_SCENARIO=run-pi \
    MOCK_STATE_DIR="$run_directory" \
    MOCK_CALL_LOG="$run_directory/calls" \
    MOCK_BOOTSTRAP=pi-focus-TEST \
    MOCK_READINESS_DIRECTORY="$run_directory/readiness" \
    PI_GHOSTTY_ZELLIJ_ACTION=run-pi \
    PI_GHOSTTY_ZELLIJ_WORKSPACE=pi-test-session \
    PI_GHOSTTY_ZELLIJ_WORKING_DIRECTORY='/tmp/project with space' \
    PI_GHOSTTY_ZELLIJ_EXECUTABLE="$run_directory/zellij" \
    PI_GHOSTTY_ZELLIJ_PI_EXECUTABLE=/custom/bin/pi \
    PI_GHOSTTY_ZELLIJ_PI_ARGC=2 \
    PI_GHOSTTY_ZELLIJ_PI_ARG_0=--session \
    PI_GHOSTTY_ZELLIJ_PI_ARG_1='/tmp/session with space.jsonl' \
    PI_GHOSTTY_APP_PID=300 \
    PI_GHOSTTY_PARENT_TTY=/dev/ttys123 \
    PI_GHOSTTY_HANDSHAKE_TOKEN=AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE \
    /bin/zsh "$HELPER" >"$run_directory/output" 2>&1; then
  run_status=0
else
  run_status=$?
fi
run_calls=$(<"$run_directory/calls")
run_layout=$([[ -f "$run_directory/layout" ]] && <"$run_directory/layout" || print -r -- '')
assert_equal "run-pi uses the configured Zellij executable" "$run_status" 0
assert_contains "run-pi starts one named session from a layout string" "$run_calls" '--session pi-test-session --layout-string'
assert_contains "run-pi layout directly executes configured Pi" "$run_layout" 'command="/custom/bin/pi"'
assert_contains "run-pi layout preserves spaced Pi arguments" "$run_layout" '"/tmp/session with space.jsonl"'
assert_contains "run-pi layout keeps route variables" "$run_layout" 'PI_GHOSTTY_HANDSHAKE_TOKEN "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"'
/bin/rm -rf "$run_directory"

# Happy attach: one fresh client is switched by addressing only its bootstrap.
happy_directory=$(new_case_directory)
run_attach_case success "$happy_directory"
happy_calls=$(<"$happy_directory/calls")
wait_until "successful attach cleans its bootstrap" "[[ -f ${(q)happy_directory}/killed ]]" || true
assert_equal "attach succeeds" "$ATTACH_STATUS" 0
assert_equal "attach publishes ready only after switching" "$(<"$happy_directory/readiness/status")" ready
assert_contains "attach starts one client in the bootstrap" "$happy_calls" 'attach --create pi-focus-TEST'
assert_contains "attach polls clients only through the bootstrap" "$happy_calls" '--session pi-focus-TEST action list-clients'
assert_contains "attach switches only the bootstrap client to the exact pane" "$happy_calls" '--session pi-focus-TEST action switch-session child-workspace --pane-id terminal_12'
assert_contains "attach removes only its empty bootstrap" "$happy_calls" 'kill-session pi-focus-TEST'
assert_not_contains "attach never creates a layout" "$happy_calls" '--layout-string'
assert_not_contains "attach never targets attach --create at the destination" "$happy_calls" 'attach --create child-workspace'
assert_not_contains "attach never invokes generated autostart" "$happy_calls" 'generate-auto-start'
assert_not_contains "attach never runs Pi" "$happy_calls" '/custom/bin/pi'
attach_line=$(command grep -n -m1 '^attach --create pi-focus-TEST$' "$happy_directory/calls" | cut -d: -f1)
clients_line=$(command grep -n -m1 '^--session pi-focus-TEST action list-clients$' "$happy_directory/calls" | cut -d: -f1)
switch_line=$(command grep -n -m1 '^--session pi-focus-TEST action switch-session child-workspace --pane-id terminal_12$' "$happy_directory/calls" | cut -d: -f1)
kill_line=$(command grep -n -m1 '^kill-session pi-focus-TEST$' "$happy_directory/calls" | cut -d: -f1)
if [[ -n $attach_line && -n $clients_line && -n $switch_line && -n $kill_line ]] \
    && (( attach_line < clients_line && clients_line < switch_line && switch_line < kill_line )); then
  pass "attach performs client start, scoped poll, switch, then cleanup in order"
else
  fail "attach call order is unsafe (${happy_calls:q})"
fi
if [[ -z $(command find "$happy_directory/readiness" -maxdepth 1 -type f ! -name status -print -quit) ]]; then
  pass "atomic readiness leaves no temporary status file"
else
  fail "atomic readiness leaves no temporary status file"
fi
/bin/rm -rf "$happy_directory"

# Every post-mutation failure reports an error and names only its own bootstrap.
assert_failure_cleanup multiple
assert_failure_cleanup switch-failure
assert_failure_cleanup timeout

# Malformed contracts fail before mutation but still report through a valid request path.
invalid_directory=$(new_case_directory)
if MOCK_SCENARIO=success \
    MOCK_STATE_DIR="$invalid_directory" \
    MOCK_CALL_LOG="$invalid_directory/calls" \
    MOCK_BOOTSTRAP=pi-focus-TEST \
    MOCK_READINESS_DIRECTORY="$invalid_directory/readiness" \
    PI_GHOSTTY_ZELLIJ_ACTION=attach \
    PI_GHOSTTY_ZELLIJ_WORKSPACE='../child-workspace' \
    PI_GHOSTTY_ZELLIJ_PANE_ID=terminal_12 \
    PI_GHOSTTY_ZELLIJ_BOOTSTRAP_SESSION=pi-focus-TEST \
    PI_GHOSTTY_ZELLIJ_READINESS_PATH="$invalid_directory/readiness/status" \
    PI_GHOSTTY_ZELLIJ_WORKING_DIRECTORY=/tmp \
    PI_GHOSTTY_ZELLIJ_EXECUTABLE="$invalid_directory/zellij" \
    PI_GHOSTTY_ZELLIJ_PI_ARGC=0 \
    /bin/zsh "$HELPER" >"$invalid_directory/output" 2>&1; then
  invalid_status=0
else
  invalid_status=$?
fi
if (( invalid_status != 0 )); then
  pass "malformed attach contract returns nonzero"
else
  fail "malformed attach contract returns nonzero"
fi
assert_file_one_line_matching "malformed attach contract publishes one error" \
  "$invalid_directory/readiness/status" '^error:invalid-contract$'
if [[ ! -s "$invalid_directory/calls" ]]; then
  pass "malformed attach contract mutates no Zellij session"
else
  fail "malformed attach contract mutates no Zellij session ($( <"$invalid_directory/calls" ))"
fi
/bin/rm -rf "$invalid_directory"

# An occupied readiness path belongs to somebody else and must not be overwritten.
occupied_directory=$(new_case_directory)
print -r -- 'ready-from-another-request' > "$occupied_directory/readiness/status"
if MOCK_SCENARIO=success \
    MOCK_STATE_DIR="$occupied_directory" \
    MOCK_CALL_LOG="$occupied_directory/calls" \
    MOCK_BOOTSTRAP=pi-focus-TEST \
    MOCK_READINESS_DIRECTORY="$occupied_directory/readiness" \
    PI_GHOSTTY_ZELLIJ_ACTION=attach \
    PI_GHOSTTY_ZELLIJ_WORKSPACE=child-workspace \
    PI_GHOSTTY_ZELLIJ_PANE_ID=terminal_12 \
    PI_GHOSTTY_ZELLIJ_BOOTSTRAP_SESSION=pi-focus-TEST \
    PI_GHOSTTY_ZELLIJ_READINESS_PATH="$occupied_directory/readiness/status" \
    PI_GHOSTTY_ZELLIJ_WORKING_DIRECTORY=/tmp \
    PI_GHOSTTY_ZELLIJ_EXECUTABLE="$occupied_directory/zellij" \
    PI_GHOSTTY_ZELLIJ_PI_ARGC=0 \
    /bin/zsh "$HELPER" >"$occupied_directory/output" 2>&1; then
  occupied_status=0
else
  occupied_status=$?
fi
if (( occupied_status != 0 )); then
  pass "occupied readiness path returns nonzero"
else
  fail "occupied readiness path returns nonzero"
fi
assert_equal "occupied readiness path is never overwritten" \
  "$(<"$occupied_directory/readiness/status")" 'ready-from-another-request'
if [[ ! -s "$occupied_directory/calls" ]]; then
  pass "occupied readiness path mutates no Zellij session"
else
  fail "occupied readiness path mutates no Zellij session"
fi
/bin/rm -rf "$occupied_directory"

# A blocked Zellij control call cannot extend the five-second readiness bound.
zmodload zsh/datetime
hung_directory=$(new_case_directory)
typeset -F hung_started=$EPOCHREALTIME
typeset -F hung_elapsed
run_attach_case hung-command "$hung_directory"
hung_elapsed=$(( EPOCHREALTIME - hung_started ))
wait_until "hung command cleans its bootstrap" "[[ -f ${(q)hung_directory}/killed ]]" || true
if (( ATTACH_STATUS != 0 )); then
  pass "hung Zellij command returns nonzero"
else
  fail "hung Zellij command returns nonzero"
fi
if (( hung_elapsed < 5.8 )); then
  pass "hung Zellij command stays inside the readiness bound"
else
  fail "hung Zellij command exceeded readiness bound (${hung_elapsed}s)"
fi
assert_file_one_line_matching "hung Zellij command publishes one bounded error" \
  "$hung_directory/readiness/status" '^error:timeout$'
hung_calls=$(<"$hung_directory/calls")
assert_contains "hung Zellij command kills its request bootstrap" "$hung_calls" 'kill-session pi-focus-TEST'
assert_not_contains "hung Zellij command never kills the target" "$hung_calls" 'kill-session child-workspace'
/bin/rm -rf "$hung_directory"

# If the foreground client is signalled away, the controller rolls back its request.
signal_directory=$(new_case_directory)
MOCK_SCENARIO=signal \
  MOCK_STATE_DIR="$signal_directory" \
  MOCK_CALL_LOG="$signal_directory/calls" \
  MOCK_BOOTSTRAP=pi-focus-TEST \
  MOCK_READINESS_DIRECTORY="$signal_directory/readiness" \
  PI_GHOSTTY_ZELLIJ_ACTION=attach \
  PI_GHOSTTY_ZELLIJ_WORKSPACE=child-workspace \
  PI_GHOSTTY_ZELLIJ_PANE_ID=terminal_12 \
  PI_GHOSTTY_ZELLIJ_BOOTSTRAP_SESSION=pi-focus-TEST \
  PI_GHOSTTY_ZELLIJ_READINESS_PATH="$signal_directory/readiness/status" \
  PI_GHOSTTY_ZELLIJ_WORKING_DIRECTORY=/tmp \
  PI_GHOSTTY_ZELLIJ_EXECUTABLE="$signal_directory/zellij" \
  PI_GHOSTTY_ZELLIJ_PI_ARGC=0 \
  /bin/zsh "$HELPER" >"$signal_directory/output" 2>&1 &
signal_pid=$!
wait_until "signal case starts its client" "[[ -f ${(q)signal_directory}/attach.started ]]" || true
/bin/kill -TERM "$signal_pid" 2>/dev/null || true
wait "$signal_pid" 2>/dev/null
signal_status=$?
wait_until "signal case publishes its error" "[[ -f ${(q)signal_directory}/readiness/status ]]" || true
wait_until "signal case cleans its bootstrap" "[[ -f ${(q)signal_directory}/killed ]]" || true
signal_calls=$(<"$signal_directory/calls")
if (( signal_status != 0 )); then
  pass "signalled client returns nonzero"
else
  fail "signalled client returns nonzero"
fi
assert_file_one_line_matching "signalled client publishes one bounded error" \
  "$signal_directory/readiness/status" '^error:client-exited$'
assert_contains "signalled client kills its request bootstrap" "$signal_calls" 'kill-session pi-focus-TEST'
assert_not_contains "signalled client never kills the target" "$signal_calls" 'kill-session child-workspace'
/bin/rm -rf "$signal_directory"

print -- "\n${passed} passed, ${failed} failed"
(( failed == 0 ))
