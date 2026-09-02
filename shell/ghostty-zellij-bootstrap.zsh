# Ghostty-to-Zellij bootstrap.
# Source this from the final Ghostty autostart block in ~/.zshrc.

if (( ! $+functions[_pi_ghostty_bootstrap_ps] )); then
  _pi_ghostty_bootstrap_ps() { /bin/ps "$@"; }
fi

if (( ! $+functions[_pi_ghostty_bootstrap_tty] )); then
  _pi_ghostty_bootstrap_tty() { /usr/bin/tty; }
fi

if (( ! $+functions[_pi_ghostty_bootstrap_uuidgen] )); then
  _pi_ghostty_bootstrap_uuidgen() { /usr/bin/uuidgen; }
fi

if (( ! $+functions[_pi_ghostty_bootstrap_zellij] )); then
  _pi_ghostty_bootstrap_zellij() { "$_pi_ghostty_zellij_executable" "$@"; }
fi

if (( ! $+functions[_pi_ghostty_bootstrap_exec_zellij] )); then
  _pi_ghostty_bootstrap_exec_zellij() { exec "$_pi_ghostty_zellij_executable" "$@"; }
fi

_pi_ghostty_bootstrap_process_field() {
  emulate -L zsh
  setopt extendedglob
  local field=$1
  local pid=$2
  local value

  value=$(_pi_ghostty_bootstrap_ps -o "${field}=" -p "$pid" 2>/dev/null) || return 1
  value=${value##[[:space:]]#}
  value=${value%%[[:space:]]#}
  [[ -n $value ]] || return 1
  print -r -- "$value"
}

_pi_ghostty_bootstrap_app_pid() {
  local parent_pid parent_command app_pid app_command

  parent_pid=$(_pi_ghostty_bootstrap_process_field ppid $$) || return 1
  parent_command=$(_pi_ghostty_bootstrap_process_field comm "$parent_pid") || return 1

  if [[ ${parent_command:t} == login ]]; then
    app_pid=$(_pi_ghostty_bootstrap_process_field ppid "$parent_pid") || return 1
  elif [[ $parent_command == */Ghostty.app/Contents/MacOS/ghostty ]]; then
    app_pid=$parent_pid
  else
    return 1
  fi

  [[ $app_pid == <1-> ]] || return 1
  app_command=$(_pi_ghostty_bootstrap_process_field comm "$app_pid") || return 1
  [[ $app_command == */Ghostty.app/Contents/MacOS/ghostty ]] || return 1
  print -r -- "$app_pid"
}

_pi_ghostty_bootstrap_parent_tty() {
  emulate -L zsh
  setopt extendedglob
  local parent_tty

  parent_tty=$(_pi_ghostty_bootstrap_tty 2>/dev/null) || return 1
  parent_tty=${parent_tty##[[:space:]]#}
  parent_tty=${parent_tty%%[[:space:]]#}
  [[ $parent_tty =~ '^/dev/tty[[:alnum:]_.-]+$' ]] || return 1
  print -r -- "$parent_tty"
}

_pi_ghostty_bootstrap_handshake_token() {
  local token

  token=$(_pi_ghostty_bootstrap_uuidgen 2>/dev/null) || return 1
  token=${token:u}
  [[ $token =~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' ]] || return 1
  print -r -- "$token"
}

_pi_ghostty_consume_managed_contract() {
  local index variable_name

  unset PI_GHOSTTY_ZELLIJ_BOOTSTRAP_MODE
  unset PI_GHOSTTY_ZELLIJ_ACTION
  unset PI_GHOSTTY_ZELLIJ_WORKSPACE
  unset PI_GHOSTTY_ZELLIJ_WORKING_DIRECTORY
  unset PI_GHOSTTY_ZELLIJ_EXECUTABLE
  unset PI_GHOSTTY_ZELLIJ_PI_EXECUTABLE
  unset PI_GHOSTTY_ZELLIJ_PI_ARGC
  for index in {0..15}; do
    variable_name="PI_GHOSTTY_ZELLIJ_PI_ARG_${index}"
    unset "$variable_name"
  done
}

# Hand managed Session Manager requests to the dedicated launch helper.
_pi_ghostty_run_managed_launch() {
  local launcher=${PI_GHOSTTY_ZELLIJ_LAUNCHER:-$HOME/.my-pi/shell/ghostty-zellij-managed-launch.zsh}

  [[ -r $launcher ]] || return 127
  exec /bin/zsh "$launcher"
}

_pi_ghostty_zellij_bootstrap() {
  local app_pid parent_tty handshake_token
  local _pi_ghostty_zellij_executable=/opt/homebrew/bin/zellij

  [[ -o interactive ]] || return 0
  [[ $TERM == xterm-ghostty ]] || return 0
  [[ -n $PS1 ]] || return 0

  app_pid=$(_pi_ghostty_bootstrap_app_pid) || return 0
  parent_tty=$(_pi_ghostty_bootstrap_parent_tty) || return 0
  handshake_token=$(_pi_ghostty_bootstrap_handshake_token) || return 0

  export PI_GHOSTTY_APP_PID=$app_pid
  export PI_GHOSTTY_PARENT_TTY=$parent_tty
  export PI_GHOSTTY_HANDSHAKE_TOKEN=$handshake_token

  unset ZELLIJ ZELLIJ_SESSION_NAME ZELLIJ_PANE_ID

  if [[ ${PI_GHOSTTY_ZELLIJ_BOOTSTRAP_MODE-} == managed ]]; then
    _pi_ghostty_run_managed_launch
    return $?
  fi

  [[ -z ${PI_GHOSTTY_ZELLIJ_BOOTSTRAP_MODE-} ]] || return 0
  eval "$(_pi_ghostty_bootstrap_zellij setup --generate-auto-start zsh)"
}

_pi_ghostty_zellij_bootstrap
