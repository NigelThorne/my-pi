#!/bin/zsh
set -euo pipefail

root="$(cd -- "$(dirname -- "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

(cd "$root" && swift build)
app="$tmp/MacFocusTracker.app"
mkdir -p "$app/Contents/MacOS"
cp "$root/.build/debug/mac-focus-tracker" "$app/Contents/MacOS/mac-focus-tracker"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>mac-focus-tracker</string>
<key>CFBundleIdentifier</key><string>com.nigelthorne.test-focus-tracker</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSBackgroundOnly</key><true/>
</dict></plist>
PLIST

output="$tmp/focus.jsonl"
pid_file="$tmp/tracker.pid"
"$root/launch-supervisor.zsh" "$app" "$output" "$pid_file" &
supervisor_pid=$!
for _ in {1..50}; do
  [[ -s "$pid_file" ]] && break
  sleep 0.1
done
tracker_pid="$(<"$pid_file")"
kill -TERM "$supervisor_pid"
wait "$supervisor_pid" || true
[[ ! -e "$pid_file" ]]
for _ in {1..50}; do
  ! kill -0 "$tracker_pid" 2>/dev/null && break
  sleep 0.1
done
! kill -0 "$tracker_pid" 2>/dev/null
