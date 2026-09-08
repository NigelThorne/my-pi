#!/bin/zsh
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <app bundle> <output JSONL> <PID file>" >&2
  exit 64
fi

app_bundle="$1"
output="$2"
pid_file="$3"
tracker_command="${app_bundle}/Contents/MacOS/mac-focus-tracker"
waiter_pid=""

terminate_tracker() {
  local tracker_pid=""
  local command=""
  if [[ -s "${pid_file}" ]]; then
    tracker_pid="$(<"${pid_file}")"
  fi
  if [[ "${tracker_pid}" != <-> ]] || ! kill -0 "${tracker_pid}" 2>/dev/null; then
    return
  fi

  command="$(ps -p "${tracker_pid}" -o command= 2>/dev/null || true)"
  if [[ "${command}" == *"${tracker_command}"* ]]; then
    kill -TERM "${tracker_pid}" 2>/dev/null || true
  fi
}

cleanup() {
  trap - EXIT TERM INT
  if [[ -n "${waiter_pid}" ]] && kill -0 "${waiter_pid}" 2>/dev/null; then
    kill -TERM "${waiter_pid}" 2>/dev/null || true
  fi
  for _ in {1..50}; do
    [[ -s "${pid_file}" ]] && break
    [[ -z "${waiter_pid}" ]] || kill -0 "${waiter_pid}" 2>/dev/null || break
    sleep 0.1
  done
  terminate_tracker
  [[ -z "${waiter_pid}" ]] || wait "${waiter_pid}" 2>/dev/null || true
  rm -f "${pid_file}"
}

trap cleanup EXIT
trap 'exit 0' TERM INT
rm -f "${pid_file}"
/usr/bin/open -W "${app_bundle}" --args --output "${output}" --pid-file "${pid_file}" &
waiter_pid=$!
wait "${waiter_pid}"
