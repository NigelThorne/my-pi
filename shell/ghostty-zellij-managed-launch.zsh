#!/bin/zsh

emulate -LR zsh
setopt nounset pipefail

kdl_quote() {
  local value=$1
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\r'/\\r}
  value=${value//$'\n'/\\n}
  value=${value//$'\t'/\\t}
  print -nr -- "\"$value\""
}

valid_contract_name() {
  [[ $1 =~ '^[[:alnum:]][[:alnum:]_.-]{0,127}$' ]]
}

valid_bootstrap_name() {
  [[ $1 =~ '^pi-focus-[[:alnum:]][[:alnum:]_.-]{0,118}$' ]]
}

publish_status() {
  local readiness_directory=$1 status_value=$2
  local temporary_path="${readiness_directory}/.status.$$.$RANDOM"
  local status_path="${readiness_directory}/status"

  if ! (umask 077; print -r -- "$status_value" >| "$temporary_path"); then
    /bin/rm -f -- "$temporary_path"
    return 1
  fi
  if ! /bin/mv -f -- "$temporary_path" "$status_path"; then
    /bin/rm -f -- "$temporary_path"
    return 1
  fi
}

read_pi_arguments() {
  local argument_count=$1 index variable_name
  reply=()

  for (( index = 0; index < argument_count; index += 1 )); do
    variable_name="PI_GHOSTTY_ZELLIJ_PI_ARG_${index}"
    (( ${+parameters[$variable_name]} )) || return 1
    reply+=("${(P)variable_name}")
  done
}

run_pi() {
  local workspace=${PI_GHOSTTY_ZELLIJ_WORKSPACE-}
  local working_directory=${PI_GHOSTTY_ZELLIJ_WORKING_DIRECTORY-}
  local zellij_executable=${PI_GHOSTTY_ZELLIJ_EXECUTABLE-}
  local pi_executable=${PI_GHOSTTY_ZELLIJ_PI_EXECUTABLE:-pi}
  local argument_count=${PI_GHOSTTY_ZELLIJ_PI_ARGC-}
  local app_pid=${PI_GHOSTTY_APP_PID-}
  local parent_tty=${PI_GHOSTTY_PARENT_TTY-}
  local handshake_token=${PI_GHOSTTY_HANDSHAKE_TOKEN-}
  local argument layout
  local -a pi_arguments

  if ! valid_contract_name "$workspace" \
      || [[ $working_directory != /* ]] \
      || [[ $zellij_executable != /* || ! -x $zellij_executable ]] \
      || ! [[ $pi_executable == /* || $pi_executable =~ '^[[:alnum:]_.-]+$' ]] \
      || ! [[ $argument_count =~ '^[0-9]+$' ]] \
      || (( argument_count > 16 )) \
      || [[ -z $app_pid || -z $parent_tty || -z $handshake_token ]]; then
    return 2
  fi

  read_pi_arguments "$argument_count" || return 2
  pi_arguments=("${reply[@]}")

  layout="layout {
  pane cwd=$(kdl_quote "$working_directory") command=$(kdl_quote "$pi_executable") {"
  if (( ${#pi_arguments[@]} )); then
    layout+=$'\n    args'
    for argument in "${pi_arguments[@]}"; do
      layout+=" $(kdl_quote "$argument")"
    done
  fi
  layout+="
    close_on_exit true
  }
}
env {
  PI_GHOSTTY_APP_PID $(kdl_quote "$app_pid")
  PI_GHOSTTY_PARENT_TTY $(kdl_quote "$parent_tty")
  PI_GHOSTTY_HANDSHAKE_TOKEN $(kdl_quote "$handshake_token")
}"

  exec "$zellij_executable" --session "$workspace" --layout-string "$layout"
}

bounded_zellij() {
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

bootstrap_exists() {
  local timeout=$1 zellij_executable=$2 bootstrap=$3 output line command_status

  if output=$(bounded_zellij "$timeout" \
      "$zellij_executable" list-sessions --short --no-formatting 2>/dev/null); then
    for line in "${(@f)output}"; do
      [[ $line == "$bootstrap" ]] && return 0
    done
    return 1
  fi
  command_status=$?
  (( command_status == 124 )) && return 2
  return 1
}

cleanup_bootstrap() {
  local zellij_executable=$1 bootstrap=$2
  bounded_zellij 0.5 "$zellij_executable" kill-session "$bootstrap" >/dev/null 2>&1 || true
}

attach_controller() {
  local owner_pid=$1 zellij_executable=$2 workspace=$3 pane_id=$4 bootstrap=$5 readiness_directory=$6 deadline=$7
  local client_output command_status
  local -a client_lines
  integer attempt
  typeset -F remaining sleep_interval

  controller_failure() {
    local reason=$1
    publish_status "$readiness_directory" "error:$reason" || true
    cleanup_bootstrap "$zellij_executable" "$bootstrap"
    exit 1
  }

  trap 'controller_failure interrupted' HUP INT TERM

  for attempt in {1..50}; do
    remaining=$(( deadline - EPOCHREALTIME ))
    (( remaining > 0.0 )) || controller_failure timeout

    if ! /bin/kill -0 "$owner_pid" 2>/dev/null; then
      controller_failure client-exited
    fi

    if bootstrap_exists "$remaining" "$zellij_executable" "$bootstrap"; then
      remaining=$(( deadline - EPOCHREALTIME ))
      (( remaining > 0.0 )) || controller_failure timeout
      if client_output=$(bounded_zellij "$remaining" \
          "$zellij_executable" --session "$bootstrap" action list-clients 2>/dev/null); then
        client_lines=("${(@f)client_output}")
        if (( ${#client_lines[@]} > 2 )); then
          controller_failure multiple-clients
        fi
        if (( ${#client_lines[@]} == 2 )); then
          [[ ${client_lines[1]} == CLIENT_ID* ]] || controller_failure malformed-client-list
          [[ ${client_lines[2]} == <->\ * ]] || controller_failure malformed-client-list

          remaining=$(( deadline - EPOCHREALTIME ))
          (( remaining > 0.0 )) || controller_failure timeout
          if bounded_zellij "$remaining" "$zellij_executable" \
              --session "$bootstrap" action switch-session \
              "$workspace" --pane-id "$pane_id" >/dev/null 2>&1; then
            :
          else
            command_status=$?
            (( command_status == 124 )) && controller_failure timeout
            controller_failure switch-failed
          fi
          publish_status "$readiness_directory" ready || controller_failure readiness-write-failed
          cleanup_bootstrap "$zellij_executable" "$bootstrap"
          exit 0
        fi
        if (( ${#client_lines[@]} != 1 )) || [[ ${client_lines[1]-} != CLIENT_ID* ]]; then
          controller_failure malformed-client-list
        fi
      else
        command_status=$?
        (( command_status == 124 )) && controller_failure timeout
      fi
    else
      command_status=$?
      (( command_status == 2 )) && controller_failure timeout
    fi

    remaining=$(( deadline - EPOCHREALTIME ))
    (( remaining > 0.0 )) || controller_failure timeout
    sleep_interval=0.1
    (( remaining < sleep_interval )) && sleep_interval=$remaining
    /bin/sleep "$sleep_interval"
  done

  controller_failure timeout
}

invalid_attach_contract() {
  local readiness_path=$1 readiness_directory=${1:h}
  if [[ $readiness_path == /* && ${readiness_path:t} == status \
        && -d $readiness_directory && ! -L $readiness_directory \
        && ! -e $readiness_path ]]; then
    publish_status "$readiness_directory" error:invalid-contract || true
  fi
  return 2
}

attach() {
  local workspace=${PI_GHOSTTY_ZELLIJ_WORKSPACE-}
  local pane_id=${PI_GHOSTTY_ZELLIJ_PANE_ID-}
  local bootstrap=${PI_GHOSTTY_ZELLIJ_BOOTSTRAP_SESSION-}
  local readiness_path=${PI_GHOSTTY_ZELLIJ_READINESS_PATH-}
  local readiness_directory=${readiness_path:h}
  local working_directory=${PI_GHOSTTY_ZELLIJ_WORKING_DIRECTORY-}
  local zellij_executable=${PI_GHOSTTY_ZELLIJ_EXECUTABLE-}
  local argument_count=${PI_GHOSTTY_ZELLIJ_PI_ARGC-}

  if [[ $readiness_path != /* || ${readiness_path:t} != status \
        || ! -d $readiness_directory || -L $readiness_directory \
        || ! -w $readiness_directory || -e $readiness_path ]] \
      || ! valid_contract_name "$workspace" \
      || ! valid_contract_name "$pane_id" \
      || ! valid_bootstrap_name "$bootstrap" \
      || [[ $working_directory != /* ]] \
      || [[ $zellij_executable != /* || ! -x $zellij_executable ]] \
      || [[ $argument_count != 0 ]]; then
    invalid_attach_contract "$readiness_path"
    return $?
  fi

  # Zellij 0.44 has no verified external command that attaches this new client
  # to an exact pane. Fail before querying, creating, switching, or killing a session.
  publish_status "$readiness_directory" error:unsupported-zellij-reattach || true
  return 1
}

case ${PI_GHOSTTY_ZELLIJ_ACTION-} in
  run-pi) run_pi ;;
  attach) attach ;;
  *) exit 2 ;;
esac
