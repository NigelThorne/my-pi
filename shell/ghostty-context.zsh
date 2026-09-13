#!/bin/zsh
# Print shell exports that identify the Ghostty surface owning a shell.
#
# Use directly from a shell:
#   eval "$(ghostty-context.zsh)"
#
# A command substitution runs this script in a child process, so it inspects
# $PPID by default. Callers that already know the owning shell can set
# PI_GHOSTTY_CONTEXT_PID to that process ID instead.

setopt extendedglob no_unset

if (( ! $+functions[_pi_ghostty_context_ps] )); then
  _pi_ghostty_context_ps() { /bin/ps "$@"; }
fi

if (( ! $+functions[_pi_ghostty_context_tty] )); then
  _pi_ghostty_context_tty() { /usr/bin/tty; }
fi

if (( ! $+functions[_pi_ghostty_context_uuidgen] )); then
  _pi_ghostty_context_uuidgen() { /usr/bin/uuidgen; }
fi

if (( ! $+functions[_pi_ghostty_context_osascript] )); then
  _pi_ghostty_context_osascript() { /usr/bin/osascript "$@"; }
fi

if (( ! $+functions[_pi_ghostty_context_set_route_title] )); then
  _pi_ghostty_context_set_route_title() {
    local token=$1

    [[ -w /dev/tty ]] || return 1
    print -nr -- $'\e]0;Pi Route '"$token"$'\a' > /dev/tty
  }
fi

if (( ! $+functions[_pi_ghostty_context_sleep] )); then
  _pi_ghostty_context_sleep() { /bin/sleep "$@"; }
fi

process_field() {
  local field=$1 pid=$2 value

  value=$(_pi_ghostty_context_ps -o "${field}=" -p "$pid" 2>/dev/null) || return 1
  value=${value##[[:space:]]#}
  value=${value%%[[:space:]]#}
  [[ -n $value ]] || return 1
  print -r -- "$value"
}

owning_ghostty_pid() {
  local shell_pid=$1 parent_pid parent_command app_pid app_command

  parent_pid=$(process_field ppid "$shell_pid") || return 1
  parent_command=$(process_field comm "$parent_pid") || return 1
  if [[ ${parent_command:t} == login ]]; then
    app_pid=$(process_field ppid "$parent_pid") || return 1
  elif [[ $parent_command == */Ghostty.app/Contents/MacOS/ghostty ]]; then
    app_pid=$parent_pid
  else
    return 1
  fi

  [[ $app_pid == <1-> ]] || return 1
  app_command=$(process_field comm "$app_pid") || return 1
  [[ $app_command == */Ghostty.app/Contents/MacOS/ghostty ]] || return 1
  print -r -- "$app_pid"
}

controlling_tty() {
  local tty

  tty=$(_pi_ghostty_context_tty 2>/dev/null) || return 1
  [[ $tty =~ '^/dev/tty[[:alnum:]_.-]+$' ]] || return 1
  print -r -- "$tty"
}

handshake_token() {
  local token=${PI_GHOSTTY_HANDSHAKE_TOKEN-}

  token=${token:u}
  if [[ $token =~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' ]]; then
    print -r -- "$token"
    return 0
  fi

  token=$(_pi_ghostty_context_uuidgen 2>/dev/null) || return 1
  token=${token:u}
  [[ $token =~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' ]] || return 1
  print -r -- "$token"
}

surface_tuple() {
  local app_pid=$1 terminal_id=$2 token=$3 output window_id resolved_terminal_id

  output=$(_pi_ghostty_context_osascript -l JavaScript -e '
ObjC.import("AppKit")
ObjC.import("ScriptingBridge")
function text(value) { return String(ObjC.unwrap(value)) }
function run(argv) {
  const appPID = Number(argv[0])
  const expectedTerminalID = argv[1]
  const token = argv[2]
  const runningApplications = $.NSWorkspace.sharedWorkspace.runningApplications
  let running = null
  for (let index = 0; index < Number(runningApplications.count); index++) {
    const candidate = runningApplications.objectAtIndex(index)
    if (Number(text(candidate.processIdentifier)) === appPID
        && text(candidate.bundleIdentifier) === "com.mitchellh.ghostty") {
      running = candidate
      break
    }
  }
  if (!running) throw new Error("Owning Ghostty process is unavailable")

  const app = $.SBApplication.alloc.initWithProcessIdentifier(appPID)
  const matches = []
  const routeTitle = token ? "Pi Route " + token : ""
  const windows = app.elementArrayWithCode(0x47776e64)
  for (let windowIndex = 0; windowIndex < Number(windows.count); windowIndex++) {
    const window = windows.objectAtIndex(windowIndex)
    const windowID = text(window.valueForKey("id"))
    const terminals = window.elementArrayWithCode(0x4774726d)
    for (let terminalIndex = 0; terminalIndex < Number(terminals.count); terminalIndex++) {
      const terminal = terminals.objectAtIndex(terminalIndex)
      const terminalID = text(terminal.valueForKey("id"))
      if (expectedTerminalID
          ? terminalID === expectedTerminalID
          : routeTitle && text(terminal.valueForKey("name")) === routeTitle) {
        matches.push([windowID, terminalID])
      }
    }
  }
  if (matches.length !== 1) throw new Error("Ghostty surface identity is ambiguous or unavailable")
  return matches[0].join("\t")
}' -- "$app_pid" "$terminal_id" "$token" 2>/dev/null) || return 1

  [[ $output != *$'\n'* && $output == *$'\t'* ]] || return 1
  window_id=${output%%$'\t'*}
  resolved_terminal_id=${output#*$'\t'}
  [[ -n $window_id && -n $resolved_terminal_id && $resolved_terminal_id != *$'\t'* ]] || return 1
  print -r -- "$window_id"$'\t'"$resolved_terminal_id"
}

emit_export() {
  local name=$1 value=$2
  print -r -- "export ${name}=${(q)value}"
}

main() {
  local shell_pid=${PI_GHOSTTY_CONTEXT_PID:-$PPID}
  local app_pid tty token inherited_terminal_id tuple window_id terminal_id attempt

  [[ $shell_pid == <1-> ]] || return 0
  app_pid=$(owning_ghostty_pid "$shell_pid") || return 0
  tty=$(controlling_tty) || return 0
  token=$(handshake_token) || return 0
  inherited_terminal_id=${GHOSTTY_SURFACE_ID-}

  emit_export PI_GHOSTTY_APP_PID "$app_pid"
  emit_export PI_GHOSTTY_TTY "$tty"
  emit_export PI_GHOSTTY_PARENT_TTY "$tty"
  emit_export PI_GHOSTTY_HANDSHAKE_TOKEN "$token"

  # Opening a Ghostty window only needs the process and TTY context. Exact
  # surface discovery performs a title handshake and is opt-in for consumers
  # that need it after terminal startup.
  [[ ${PI_GHOSTTY_CONTEXT_RESOLVE_SURFACE-1} == 1 ]] || return 0

  if [[ -n $inherited_terminal_id ]] && tuple=$(surface_tuple "$app_pid" "$inherited_terminal_id" "$token"); then
    window_id=${tuple%%$'\t'*}
    terminal_id=${tuple#*$'\t'}
    emit_export PI_GHOSTTY_WINDOW_ID "$window_id"
    emit_export PI_GHOSTTY_TERMINAL_ID "$terminal_id"
    return
  fi

  _pi_ghostty_context_set_route_title "$token" || return
  for attempt in {1..20}; do
    if tuple=$(surface_tuple "$app_pid" "" "$token"); then
      window_id=${tuple%%$'\t'*}
      terminal_id=${tuple#*$'\t'}
      emit_export PI_GHOSTTY_WINDOW_ID "$window_id"
      emit_export PI_GHOSTTY_TERMINAL_ID "$terminal_id"
      return
    fi
    (( attempt < 20 )) && _pi_ghostty_context_sleep 0.025
  done
  return 0
}

main
