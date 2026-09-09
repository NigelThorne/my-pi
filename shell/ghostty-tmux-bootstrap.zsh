# Ghostty-to-tmux bootstrap.
# Source this from the final interactive Ghostty startup block. It imports and
# validates ghostty-context itself, so callers do not need a separate eval.

if (( ! $+functions[_pi_ghostty_tmux_bootstrap_bounded] )); then
  _pi_ghostty_tmux_bootstrap_bounded() {
    local timeout=$1
    shift
    (( timeout > 0.0 )) || return 124
    /usr/bin/perl -MTime::HiRes=alarm -MPOSIX=setpgid -e '
      my $timeout = shift @ARGV;
      my $child = fork();
      exit 125 unless defined $child;
      if ($child == 0) {
        setpgid 0, 0;
        exec @ARGV;
        exit 127;
      }
      setpgid $child, $child;
      $SIG{ALRM} = sub {
        kill "TERM", -$child;
        select undef, undef, undef, 0.05;
        kill "KILL", -$child;
        waitpid $child, 0;
        exit 124;
      };
      alarm $timeout;
      waitpid $child, 0;
      alarm 0;
      exit(($? & 127) ? 128 + ($? & 127) : $? >> 8);
    ' "$timeout" "$@"
  }
fi

if (( ! $+functions[_pi_ghostty_tmux_bootstrap_context] )); then
  _pi_ghostty_tmux_bootstrap_context() {
    local context_script=${PI_GHOSTTY_CONTEXT_SCRIPT:-$HOME/.my-pi/shell/ghostty-context.zsh}
    [[ -r $context_script ]] || return 1
    local -a context_environment
    # Ghostty may have inherited an old Pi route token when the app started.
    # Ordinary windows need unique probes; explicit managed requests retain
    # their token for the claim-once launch contract.
    if [[ ${PI_GHOSTTY_TMUX_BOOTSTRAP_MODE-} != managed \
        && ${PI_GHOSTTY_ZELLIJ_BOOTSTRAP_MODE-} != managed ]]; then
      context_environment=(-u PI_GHOSTTY_HANDSHAKE_TOKEN)
    fi
    _pi_ghostty_tmux_bootstrap_bounded 2.0 /usr/bin/env "${context_environment[@]}" \
      PI_GHOSTTY_CONTEXT_PID=$$ \
      PI_GHOSTTY_CONTEXT_RESOLVE_SURFACE=1 \
      /bin/zsh "$context_script"
  }
fi

_pi_ghostty_tmux_import_direct_context() {
  local context_exports

  context_exports=$(_pi_ghostty_tmux_bootstrap_context) || return 1
  [[ -n $context_exports ]] || return 1
  eval "$context_exports"
  [[ ${PI_GHOSTTY_APP_PID-} =~ '^[1-9][0-9]*$' \
      && ${PI_GHOSTTY_TTY-} =~ '^/dev/tty[[:alnum:]_.-]+$' \
      && ${PI_GHOSTTY_PARENT_TTY-} == ${PI_GHOSTTY_TTY-} \
      && ${PI_GHOSTTY_HANDSHAKE_TOKEN-} =~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' \
      && -n ${PI_GHOSTTY_WINDOW_ID-} \
      && -n ${PI_GHOSTTY_TERMINAL_ID-} ]]
}

# Reusable startup guard. A successful context probe proves this shell is a
# direct Ghostty child. TMUX/ZELLIJ values can then only be copied stale state.
# If ancestry is not proven, runtime mux state is left untouched and no launch
# occurs. This replaces ancestor walks in .zshrc.
_pi_ghostty_tmux_is_outer_shell() {
  [[ -o interactive && $TERM == xterm-ghostty && -n $PS1 ]] || return 1
  _pi_ghostty_tmux_import_direct_context || return 1

  unset TMUX TMUX_PANE
  unset ZELLIJ ZELLIJ_SESSION_NAME ZELLIJ_PANE_ID
  return 0
}

if (( ! $+functions[_pi_ghostty_tmux_bootstrap_claim_managed_request] )); then
  _pi_ghostty_tmux_bootstrap_claim_managed_request() {
    local backend=${1:-tmux}
    local token=${PI_GHOSTTY_HANDSHAKE_TOKEN-}
    local claim_directory old_umask claim_status

    [[ $token =~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' ]] || return 1
    case $backend in
      tmux) claim_directory=${TMPDIR:-/tmp}/pi-ghostty-tmux-claims ;;
      zellij) claim_directory=${TMPDIR:-/tmp}/pi-ghostty-zellij-claims ;;
      *) return 1 ;;
    esac
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

_pi_ghostty_tmux_discard_contract() {
  local index variable_name

  unset PI_GHOSTTY_TMUX_BOOTSTRAP_MODE PI_GHOSTTY_TMUX_ACTION
  unset PI_GHOSTTY_TMUX_EXECUTABLE PI_GHOSTTY_TMUX_SOCKET_PATH
  unset PI_GHOSTTY_TMUX_WORKSPACE PI_GHOSTTY_TMUX_WORKING_DIRECTORY
  unset PI_GHOSTTY_TMUX_PI_EXECUTABLE PI_GHOSTTY_TMUX_PI_ARGC
  unset PI_GHOSTTY_TMUX_SERVER_PID PI_GHOSTTY_TMUX_SERVER_START_TIME
  unset PI_GHOSTTY_TMUX_SESSION_ID PI_GHOSTTY_TMUX_WINDOW_ID PI_GHOSTTY_TMUX_PANE_ID
  unset PI_GHOSTTY_TMUX_READINESS_PATH PI_GHOSTTY_TMUX_LAUNCHER
  for index in {0..15}; do
    variable_name="PI_GHOSTTY_TMUX_PI_ARG_${index}"
    unset "$variable_name"
  done
}

_pi_ghostty_zellij_discard_contract() {
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

_pi_ghostty_tmux_run_managed_launch() {
  local launcher=${PI_GHOSTTY_TMUX_LAUNCHER:-$HOME/.my-pi/shell/ghostty-tmux-managed-launch.zsh}
  [[ -r $launcher ]] || return 127
  /bin/zsh "$launcher"
}

_pi_ghostty_zellij_run_managed_launch() {
  local launcher=${PI_GHOSTTY_ZELLIJ_LAUNCHER:-$HOME/.my-pi/shell/ghostty-zellij-managed-launch.zsh}
  [[ -r $launcher ]] || return 127
  /bin/zsh "$launcher"
}

if (( ! $+functions[_pi_ghostty_tmux_bootstrap_exec] )); then
  _pi_ghostty_tmux_bootstrap_exec() { exec "$@"; }
fi

_pi_ghostty_tmux_executable() {
  local executable=${PI_GHOSTTY_TMUX_EXECUTABLE-}
  if [[ -z $executable ]]; then
    executable=$(command -v tmux 2>/dev/null) || return 1
  fi
  [[ $executable == /* && -x $executable ]] || return 1
  print -r -- "$executable"
}

_pi_ghostty_tmux_start_ordinary() {
  local executable socket_path=${PI_GHOSTTY_TMUX_SOCKET_PATH-}
  executable=$(_pi_ghostty_tmux_executable) || return 127

  # A running server otherwise gives every new session its first window's
  # environment. Set only this session's identity, so its future child panes
  # inherit the same owner without changing other sessions or global state.
  local -a environment_arguments
  environment_arguments=(
    -e "PI_GHOSTTY_TMUX_EXECUTABLE=$executable"
    -e "PI_GHOSTTY_TMUX_SOCKET_PATH=$socket_path"
    -e "PI_GHOSTTY_APP_PID=${PI_GHOSTTY_APP_PID-}"
    -e "PI_GHOSTTY_TTY=${PI_GHOSTTY_TTY-}"
    -e "PI_GHOSTTY_PARENT_TTY=${PI_GHOSTTY_PARENT_TTY-}"
    -e "PI_GHOSTTY_HANDSHAKE_TOKEN=${PI_GHOSTTY_HANDSHAKE_TOKEN-}"
    -e "PI_GHOSTTY_WINDOW_ID=${PI_GHOSTTY_WINDOW_ID-}"
    -e "PI_GHOSTTY_TERMINAL_ID=${PI_GHOSTTY_TERMINAL_ID-}"
    -e "GHOSTTY_SURFACE_ID=${GHOSTTY_SURFACE_ID-}"
  )
  if [[ -n $socket_path ]]; then
    [[ $socket_path == /* ]] || return 2
    _pi_ghostty_tmux_bootstrap_exec "$executable" -S "$socket_path" new-session -c "$PWD" "${environment_arguments[@]}"
  else
    _pi_ghostty_tmux_bootstrap_exec "$executable" new-session -c "$PWD" "${environment_arguments[@]}"
  fi
}

_pi_ghostty_tmux_bootstrap() {
  _pi_ghostty_tmux_is_outer_shell || return 0

  if [[ ${PI_GHOSTTY_TMUX_BOOTSTRAP_MODE-} == managed ]]; then
    if _pi_ghostty_tmux_bootstrap_claim_managed_request tmux; then
      _pi_ghostty_tmux_run_managed_launch
      return $?
    fi
    _pi_ghostty_tmux_discard_contract
  elif [[ -n ${PI_GHOSTTY_TMUX_BOOTSTRAP_MODE-} ]]; then
    return 0
  fi

  if [[ ${PI_GHOSTTY_ZELLIJ_BOOTSTRAP_MODE-} == managed ]]; then
    if _pi_ghostty_tmux_bootstrap_claim_managed_request zellij; then
      _pi_ghostty_zellij_run_managed_launch
      return $?
    fi
    _pi_ghostty_zellij_discard_contract
  elif [[ -n ${PI_GHOSTTY_ZELLIJ_BOOTSTRAP_MODE-} ]]; then
    return 0
  fi

  _pi_ghostty_tmux_start_ordinary
}

_pi_ghostty_tmux_bootstrap
