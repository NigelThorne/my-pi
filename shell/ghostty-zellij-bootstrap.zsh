# Ghostty-to-Zellij bootstrap.
# Source this from the final Ghostty autostart block in ~/.zshrc.
#
# The identity probe lives in ghostty-context.zsh. This file only decides which
# Zellij launch mode to use after importing that probe's shell exports.

if (( ! $+functions[_pi_ghostty_bootstrap_zellij] )); then
  _pi_ghostty_bootstrap_zellij() { "$_pi_ghostty_zellij_executable" "$@"; }
fi

if (( ! $+functions[_pi_ghostty_bootstrap_exec_zellij] )); then
  _pi_ghostty_bootstrap_exec_zellij() { exec "$_pi_ghostty_zellij_executable" "$@"; }
fi

# Ghostty copies a surface's environment into later File > New Window shells.
# Claim each managed request once so those ordinary windows cannot replay it.
if (( ! $+functions[_pi_ghostty_bootstrap_claim_managed_request] )); then
  _pi_ghostty_bootstrap_claim_managed_request() {
    local token=${PI_GHOSTTY_HANDSHAKE_TOKEN-}
    local claim_directory old_umask claim_status

    [[ $token =~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' ]] || return 1
    claim_directory=${TMPDIR:-/tmp}/pi-ghostty-zellij-claims
    old_umask=$(umask)
    umask 077
    /bin/mkdir -p "$claim_directory" 2>/dev/null || {
      umask "$old_umask"
      return 1
    }
    /bin/mkdir "$claim_directory/$token" 2>/dev/null
    claim_status=$?
    umask "$old_umask"
    return $claim_status
  }
fi

_pi_ghostty_bootstrap_discard_managed_contract() {
  local index variable_name

  unset PI_GHOSTTY_ZELLIJ_BOOTSTRAP_MODE PI_GHOSTTY_ZELLIJ_ACTION
  unset PI_GHOSTTY_ZELLIJ_WORKSPACE PI_GHOSTTY_ZELLIJ_WORKING_DIRECTORY
  unset PI_GHOSTTY_ZELLIJ_PANE_ID PI_GHOSTTY_ZELLIJ_BOOTSTRAP_SESSION
  unset PI_GHOSTTY_ZELLIJ_READINESS_PATH PI_GHOSTTY_ZELLIJ_LAUNCHER
  unset PI_GHOSTTY_ZELLIJ_EXECUTABLE PI_GHOSTTY_ZELLIJ_PI_EXECUTABLE
  unset PI_GHOSTTY_ZELLIJ_PI_ARGC
  for index in {0..15}; do
    variable_name="PI_GHOSTTY_ZELLIJ_PI_ARG_${index}"
    unset "$variable_name"
  done
}

if (( ! $+functions[_pi_ghostty_bootstrap_context] )); then
  _pi_ghostty_bootstrap_context() {
    local context_script=${PI_GHOSTTY_CONTEXT_SCRIPT:-$HOME/.my-pi/shell/ghostty-context.zsh}

    [[ -r $context_script ]] || return 1
    PI_GHOSTTY_CONTEXT_PID=$$ /bin/zsh "$context_script"
  }
fi

_pi_ghostty_bootstrap_import_context() {
  local context_exports

  context_exports=$(_pi_ghostty_bootstrap_context) || return 1
  [[ -n $context_exports ]] || return 1
  eval "$context_exports"
}

_pi_ghostty_bootstrap_has_surface_identity() {
  [[ -n ${PI_GHOSTTY_APP_PID-} \
      && -n ${PI_GHOSTTY_TTY-} \
      && -n ${PI_GHOSTTY_WINDOW_ID-} \
      && -n ${PI_GHOSTTY_TERMINAL_ID-} ]]
}

_pi_ghostty_bootstrap_identify_surface() {
  _pi_ghostty_bootstrap_has_surface_identity && return 0

  unset PI_GHOSTTY_APP_PID PI_GHOSTTY_TTY PI_GHOSTTY_PARENT_TTY
  unset PI_GHOSTTY_WINDOW_ID PI_GHOSTTY_TERMINAL_ID
  _pi_ghostty_bootstrap_import_context || return 1
  _pi_ghostty_bootstrap_has_surface_identity
}

# Hand managed Session Manager requests to the dedicated launch helper.
_pi_ghostty_run_managed_launch() {
  local launcher=${PI_GHOSTTY_ZELLIJ_LAUNCHER:-$HOME/.my-pi/shell/ghostty-zellij-managed-launch.zsh}

  [[ -r $launcher ]] || return 127
  /bin/zsh "$launcher"
}

_pi_ghostty_zellij_bootstrap() {
  local _pi_ghostty_zellij_executable=/opt/homebrew/bin/zellij

  [[ -o interactive ]] || return 0
  [[ $TERM == xterm-ghostty ]] || return 0
  [[ -n $PS1 ]] || return 0

  # A nested shell is already inside Zellij and has no direct Ghostty parent.
  # Leave it alone rather than creating another Zellij client.
  _pi_ghostty_bootstrap_identify_surface || return 0
  unset ZELLIJ ZELLIJ_SESSION_NAME ZELLIJ_PANE_ID

  if [[ ${PI_GHOSTTY_ZELLIJ_BOOTSTRAP_MODE-} == managed ]]; then
    if _pi_ghostty_bootstrap_claim_managed_request; then
      _pi_ghostty_run_managed_launch
      return $?
    fi
    _pi_ghostty_bootstrap_discard_managed_contract
  fi

  [[ -z ${PI_GHOSTTY_ZELLIJ_BOOTSTRAP_MODE-} ]] || return 0
  eval "$(_pi_ghostty_bootstrap_zellij setup --generate-auto-start zsh)"
}

_pi_ghostty_zellij_bootstrap
