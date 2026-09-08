#!/bin/zsh
set -euo pipefail

root="$(cd -- "$(dirname -- "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

(cd "$root" && swift build)
binary="$root/.build/debug/mac-focus-tracker"
output="$tmp/focus.jsonl"
pid_file="$tmp/tracker.pid"

"$binary" --output "$output" --pid-file "$pid_file" &
tracker_pid=$!
for _ in {1..50}; do
  [[ -s "$pid_file" ]] && break
  sleep 0.1
done

[[ "$(<"$pid_file")" == "$tracker_pid" ]]
kill -TERM "$tracker_pid"
wait "$tracker_pid" || true
[[ ! -e "$pid_file" ]]
