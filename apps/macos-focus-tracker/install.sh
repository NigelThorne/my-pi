#!/usr/bin/env bash
set -euo pipefail

readonly script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly label="com.nigelthorne.mac-focus-tracker"
readonly uid="$(id -u)"
readonly domain="gui/${uid}"
readonly app_bundle="${HOME}/.my-pi/apps/MacFocusTracker.app"
readonly app_info_template="${script_dir}/MacFocusTracker.app.Info.plist.template"
readonly supervisor="${HOME}/.my-pi/bin/mac-focus-tracker-supervisor"
readonly log_dir="${HOME}/Library/Application Support/mac-focus-tracker"
readonly event_log="${log_dir}/focus.jsonl"
readonly pid_file="${log_dir}/tracker.pid"
readonly plist="${HOME}/Library/LaunchAgents/${label}.plist"
readonly template="${script_dir}/${label}.plist.template"
readonly stdout_log="${log_dir}/launchd.stdout.log"
readonly stderr_log="${log_dir}/launchd.stderr.log"

dry_run=false
if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=true
elif [[ $# -ne 0 ]]; then
  echo "usage: $0 [--dry-run]" >&2
  exit 64
fi

print_command() {
  printf '+' >&2
  printf ' %q' "$@" >&2
  printf '\n' >&2
}

run() {
  print_command "$@"
  if [[ "${dry_run}" == false ]]; then
    "$@"
  fi
}

render_plist() {
  if [[ "${dry_run}" == true ]]; then
    printf '+ render %q -> %q\n' "${template}" "${plist}" >&2
    return
  fi

  python3 - "${template}" "${plist}" "${supervisor}" "${app_bundle}" "${event_log}" "${pid_file}" "${stdout_log}" "${stderr_log}" <<'PY'
from pathlib import Path
from xml.sax.saxutils import escape
import sys

template, destination, supervisor, app_bundle, event_log, pid_file, stdout_log, stderr_log = map(Path, sys.argv[1:])
content = template.read_text()
for key, value in {
    "__SUPERVISOR__": supervisor,
    "__APP_BUNDLE__": app_bundle,
    "__EVENT_LOG__": event_log,
    "__PID_FILE__": pid_file,
    "__STDOUT_LOG__": stdout_log,
    "__STDERR_LOG__": stderr_log,
}.items():
    content = content.replace(key, escape(str(value)))
destination.write_text(content)
PY
}

if [[ ! -f "${template}" || ! -f "${app_info_template}" ]]; then
  echo "missing focus-tracker installation template" >&2
  exit 1
fi

if [[ "${dry_run}" == true ]]; then
  printf '+ (cd %q && swift build -c release)\n' "${script_dir}" >&2
else
  (cd "${script_dir}" && swift build -c release)
fi
run mkdir -p "${app_bundle}/Contents/MacOS" "$(dirname "${supervisor}")" "${log_dir}" "$(dirname "${plist}")"
run install -m 755 "${script_dir}/.build/release/mac-focus-tracker" "${app_bundle}/Contents/MacOS/mac-focus-tracker"
run install -m 755 "${script_dir}/launch-supervisor.zsh" "${supervisor}"
run install -m 644 "${app_info_template}" "${app_bundle}/Contents/Info.plist"
render_plist

if [[ "${dry_run}" == true ]]; then
  print_command launchctl bootout "${domain}/${label}"
  print_command pkill -TERM -f "${app_bundle}/Contents/MacOS/mac-focus-tracker --output ${event_log}"
else
  launchctl bootout "${domain}/${label}" 2>/dev/null || true
  pkill -TERM -f "${app_bundle}/Contents/MacOS/mac-focus-tracker --output ${event_log}" 2>/dev/null || true
fi
run launchctl bootstrap "${domain}" "${plist}"
run launchctl print "${domain}/${label}"

if [[ "${dry_run}" == false ]]; then
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
  printf 'Installed %s. Grant Accessibility permission to %s.\n' "${label}" "${app_bundle}"
  printf 'Events: %s\n' "${event_log}"
fi
