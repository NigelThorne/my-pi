#!/bin/zsh
set -u
setopt pipefail

readonly ROOT=${0:A:h:h}
readonly HELPER=$ROOT/shell/ghostty-zellij-managed-launch.zsh
integer failed=0

fail() { print -u2 -- "FAIL: $1"; (( failed += 1 )) }
pass() { print -- "PASS: $1" }

case_directory=$(/usr/bin/mktemp -d /tmp/pi-legacy-safety.XXXXXX) || exit 1
trap '/bin/rm -rf "$case_directory"' EXIT
/bin/mkdir "$case_directory/readiness"
/bin/cat > "$case_directory/zellij" <<'MOCK'
#!/bin/zsh
print -r -- "${(j: :)@}" >> "$MOCK_CALL_LOG"
exit 99
MOCK
/bin/chmod 700 "$case_directory/zellij"

if MOCK_CALL_LOG="$case_directory/calls" \
    PI_GHOSTTY_ZELLIJ_ACTION=attach \
    PI_GHOSTTY_ZELLIJ_WORKSPACE=verified-live-workspace \
    PI_GHOSTTY_ZELLIJ_PANE_ID=terminal_12 \
    PI_GHOSTTY_ZELLIJ_BOOTSTRAP_SESSION=pi-focus-TEST \
    PI_GHOSTTY_ZELLIJ_READINESS_PATH="$case_directory/readiness/status" \
    PI_GHOSTTY_ZELLIJ_WORKING_DIRECTORY=/tmp \
    PI_GHOSTTY_ZELLIJ_EXECUTABLE="$case_directory/zellij" \
    PI_GHOSTTY_ZELLIJ_PI_ARGC=0 \
    /bin/zsh "$HELPER" >"$case_directory/output" 2>&1; then
  fail "legacy attach returns nonzero"
else
  pass "legacy attach returns nonzero"
fi
for attempt in {1..100}; do
  [[ -f "$case_directory/readiness/status" ]] && break
  /bin/sleep 0.02
done
[[ -f "$case_directory/readiness/status" ]] \
  && [[ $(<"$case_directory/readiness/status") == error:unsupported-zellij-reattach ]] \
  && pass "legacy attach reports its safe compatibility limit" \
  || fail "legacy attach reports its safe compatibility limit"
[[ ! -s "$case_directory/calls" ]] \
  && pass "legacy attach invokes no Zellij command" \
  || fail "legacy attach invokes no Zellij command"

print -- "$((3 - failed)) passed, $failed failed"
(( failed == 0 ))
