#!/bin/zsh

emulate -LR zsh
setopt nounset pipefail extendedglob

readonly tmux_format=$'#{pid}\t#{session_id}\t#{window_id}\t#{pane_id}'
readonly client_format=$'#{client_pid}\t#{client_tty}\t#{session_id}\t#{window_id}\t#{pane_id}'

valid_workspace() { [[ $1 =~ '^[[:alnum:]][[:alnum:]_-]{0,127}$' ]]; }
valid_pid() { [[ $1 =~ '^[1-9][0-9]*$' ]]; }
valid_session_id() { [[ $1 =~ '^\$[0-9]+$' ]]; }
valid_window_id() { [[ $1 =~ '^@[0-9]+$' ]]; }
valid_pane_id() { [[ $1 =~ '^%[0-9]+$' ]]; }
valid_tty() { [[ $1 =~ '^/dev/tty[[:alnum:]_.-]+$' ]]; }

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

publish_attach_error() {
  local readiness_path=${PI_GHOSTTY_TMUX_READINESS_PATH-}
  local readiness_directory=${readiness_path:h}
  local reason=$1
  if [[ $readiness_path == /* && ${readiness_path:t} == status \
        && -d $readiness_directory && ! -L $readiness_directory \
        && -w $readiness_directory && ! -e $readiness_path ]]; then
    publish_status "$readiness_directory" "error:$reason" || true
  fi
}

bounded_command() {
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

bounded_tmux() {
  local timeout=$1 executable=$2 socket_path=$3
  shift 3
  bounded_command "$timeout" "$executable" -S "$socket_path" "$@"
}

process_start_time() {
  local timeout=$1 pid=$2 output
  output=$(LC_ALL=C bounded_command "$timeout" /bin/ps -p "$pid" -o lstart= 2>/dev/null) || return $?
  output=${output##[[:space:]]#}
  output=${output%%[[:space:]]#}
  [[ -n $output && $output != *$'\n'* ]] || return 1
  print -r -- "$output"
}

read_pi_arguments() {
  local argument_count=$1 index variable_name
  reply=()
  for (( index = 0; index < argument_count; index += 1 )); do
    variable_name="PI_GHOSTTY_TMUX_PI_ARG_${index}"
    (( ${+parameters[$variable_name]} )) || return 1
    reply+=("${(P)variable_name}")
  done
}

common_contract_valid() {
  local executable=${PI_GHOSTTY_TMUX_EXECUTABLE-}
  local socket_path=${PI_GHOSTTY_TMUX_SOCKET_PATH-}
  local working_directory=${PI_GHOSTTY_TMUX_WORKING_DIRECTORY-}
  local argument_count=${PI_GHOSTTY_TMUX_PI_ARGC-}

  [[ $executable == /* && -x $executable \
      && $socket_path == /* \
      && $working_directory == /* && -d $working_directory \
      && $argument_count =~ '^[0-9]+$' ]] || return 1
  (( argument_count <= 16 )) || return 1
  valid_pid "${PI_GHOSTTY_APP_PID-}" || return 1
  valid_tty "${PI_GHOSTTY_PARENT_TTY-}" || return 1
  [[ ${PI_GHOSTTY_HANDSHAKE_TOKEN-} =~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' \
      && -n ${PI_GHOSTTY_WINDOW_ID-} \
      && -n ${PI_GHOSTTY_TERMINAL_ID-} ]] || return 1
}

run_pi() {
  local executable=${PI_GHOSTTY_TMUX_EXECUTABLE-}
  local socket_path=${PI_GHOSTTY_TMUX_SOCKET_PATH-}
  local workspace=${PI_GHOSTTY_TMUX_WORKSPACE-}
  local working_directory=${PI_GHOSTTY_TMUX_WORKING_DIRECTORY-}
  local pi_executable=${PI_GHOSTTY_TMUX_PI_EXECUTABLE-}
  local argument_count=${PI_GHOSTTY_TMUX_PI_ARGC-}
  local inherited_name
  local -a pi_arguments environment_arguments

  common_contract_valid || return 2
  valid_workspace "$workspace" || return 2
  [[ $pi_executable == /* && -x $pi_executable ]] \
    || [[ $pi_executable =~ '^[[:alnum:]_.-]+$' ]] \
    || return 2
  read_pi_arguments "$argument_count" || return 2
  pi_arguments=("${reply[@]}")

  environment_arguments=(
    -e "PI_GHOSTTY_TMUX_EXECUTABLE=$executable"
    -e "PI_GHOSTTY_TMUX_SOCKET_PATH=$socket_path"
    -e "PI_GHOSTTY_APP_PID=${PI_GHOSTTY_APP_PID}"
    -e "PI_GHOSTTY_PARENT_TTY=${PI_GHOSTTY_PARENT_TTY}"
    -e "PI_GHOSTTY_HANDSHAKE_TOKEN=${PI_GHOSTTY_HANDSHAKE_TOKEN}"
    -e "PI_GHOSTTY_WINDOW_ID=${PI_GHOSTTY_WINDOW_ID}"
    -e "PI_GHOSTTY_TERMINAL_ID=${PI_GHOSTTY_TERMINAL_ID}"
  )
  for inherited_name in \
      PTC_ALLOW_UNSANDBOXED_SUBPROCESS \
      MYCELIUM_CONNECTED_COMMAND \
      MYCELIUM_HELP_FALLBACK_COMMAND; do
    if (( ${+parameters[$inherited_name]} )); then
      environment_arguments+=(-e "${inherited_name}=${(P)inherited_name}")
    fi
  done

  exec "$executable" -S "$socket_path" new-session \
    -s "$workspace" -c "$working_directory" "${environment_arguments[@]}" \
    /usr/bin/env -u ZELLIJ -u ZELLIJ_SESSION_NAME -u ZELLIJ_PANE_ID \
    "$pi_executable" "${pi_arguments[@]}"
}

server_route_valid() {
  local timeout=$1 executable=$2 socket_path=$3 expected_pid=$4 expected_start=$5
  local expected_session=$6 expected_window=$7 expected_pane=$8 output start_time
  local -a fields

  output=$(bounded_tmux "$timeout" "$executable" "$socket_path" \
    display-message -p -t "$expected_pane" "$tmux_format" 2>/dev/null) || return $?
  fields=("${(@ps:\t:)output}")
  (( ${#fields[@]} == 4 )) || return 1
  [[ ${fields[1]} == $expected_pid \
      && ${fields[2]} == $expected_session \
      && ${fields[3]} == $expected_window \
      && ${fields[4]} == $expected_pane ]] || return 1
  start_time=$(process_start_time "$timeout" "$expected_pid") || return $?
  [[ $start_time == $expected_start ]]
}

client_route() {
  local timeout=$1 executable=$2 socket_path=$3 tty=$4
  bounded_tmux "$timeout" "$executable" "$socket_path" \
    display-message -p -c "$tty" "$client_format" 2>/dev/null
}

valid_client_route() {
  local output=$1 expected_tty=$2
  reply=("${(@ps:\t:)output}")
  (( ${#reply[@]} == 5 )) || return 1
  valid_pid "${reply[1]}" \
    && [[ ${reply[2]} == $expected_tty ]] \
    && valid_session_id "${reply[3]}" \
    && valid_window_id "${reply[4]}" \
    && valid_pane_id "${reply[5]}"
}

attach_controller() {
  local owner_pid=$1 executable=$2 socket_path=$3 expected_server_pid=$4 expected_server_start=$5
  local session_id=$6 window_id=$7 pane_id=$8 tty=$9 readiness_directory=${10} deadline=${11}
  local output command_status
  local -a fields
  integer attempt
  typeset -F remaining sleep_interval

  controller_failure() {
    publish_status "$readiness_directory" "error:$1" || true
    exit 1
  }
  trap 'controller_failure interrupted' HUP INT TERM

  for attempt in {1..50}; do
    remaining=$(( deadline - EPOCHREALTIME ))
    (( remaining > 0.0 )) || controller_failure timeout
    /bin/kill -0 "$owner_pid" 2>/dev/null || controller_failure client-exited

    if output=$(client_route "$remaining" "$executable" "$socket_path" "$tty"); then
      if valid_client_route "$output" "$tty"; then
        fields=("${reply[@]}")
      else
        fields=()
      fi
      if (( ${#fields[@]} == 5 )) \
          && [[ ${fields[1]} == $owner_pid \
              && ${fields[3]} == $session_id \
              && ${fields[4]} == $window_id \
              && ${fields[5]} == $pane_id ]]; then
        remaining=$(( deadline - EPOCHREALTIME ))
        (( remaining > 0.0 )) || controller_failure timeout
        if server_route_valid "$remaining" "$executable" "$socket_path" \
            "$expected_server_pid" "$expected_server_start" "$session_id" "$window_id" "$pane_id"; then
          publish_status "$readiness_directory" ready || controller_failure readiness-write-failed
          exit 0
        fi
        command_status=$?
        (( command_status == 124 )) && controller_failure timeout
        controller_failure server-incarnation-mismatch
      fi
    else
      command_status=$?
      (( command_status == 124 )) && controller_failure timeout
    fi

    remaining=$(( deadline - EPOCHREALTIME ))
    (( remaining > 0.0 )) || controller_failure timeout
    sleep_interval=0.1
    (( remaining < sleep_interval )) && sleep_interval=$remaining
    /bin/sleep "$sleep_interval"
  done
  controller_failure timeout
}

attach() {
  local executable=${PI_GHOSTTY_TMUX_EXECUTABLE-}
  local socket_path=${PI_GHOSTTY_TMUX_SOCKET_PATH-}
  local server_pid=${PI_GHOSTTY_TMUX_SERVER_PID-}
  local server_start=${PI_GHOSTTY_TMUX_SERVER_START_TIME-}
  local session_id=${PI_GHOSTTY_TMUX_SESSION_ID-}
  local window_id=${PI_GHOSTTY_TMUX_WINDOW_ID-}
  local pane_id=${PI_GHOSTTY_TMUX_PANE_ID-}
  local readiness_path=${PI_GHOSTTY_TMUX_READINESS_PATH-}
  local readiness_directory=${readiness_path:h}
  local tty=${PI_GHOSTTY_PARENT_TTY-}
  local argument_count=${PI_GHOSTTY_TMUX_PI_ARGC-}
  local command_status
  typeset -F deadline remaining

  if ! common_contract_valid \
      || ! valid_pid "$server_pid" \
      || [[ -z $server_start || $server_start == *$'\n'* ]] \
      || ! valid_session_id "$session_id" \
      || ! valid_window_id "$window_id" \
      || ! valid_pane_id "$pane_id" \
      || [[ $argument_count != 0 \
          || $readiness_path != /* || ${readiness_path:t} != status \
          || ! -d $readiness_directory || -L $readiness_directory \
          || ! -w $readiness_directory || -e $readiness_path ]]; then
    publish_attach_error invalid-contract
    return 2
  fi

  zmodload zsh/datetime || {
    publish_attach_error clock-unavailable
    return 1
  }
  deadline=$(( EPOCHREALTIME + 5.0 ))
  remaining=$(( deadline - EPOCHREALTIME ))
  if ! server_route_valid "$remaining" "$executable" "$socket_path" \
      "$server_pid" "$server_start" "$session_id" "$window_id" "$pane_id"; then
    command_status=$?
    (( command_status == 124 )) && publish_attach_error timeout \
      || publish_attach_error server-incarnation-mismatch
    return 1
  fi

  remaining=$(( deadline - EPOCHREALTIME ))
  local existing_client
  if existing_client=$(client_route "$remaining" "$executable" "$socket_path" "$tty"); then
    if valid_client_route "$existing_client" "$tty"; then
      publish_attach_error client-already-attached
      return 1
    fi
  else
    command_status=$?
    if (( command_status == 124 )); then
      publish_attach_error timeout
      return 1
    fi
  fi

  attach_controller "$$" "$executable" "$socket_path" "$server_pid" "$server_start" \
    "$session_id" "$window_id" "$pane_id" "$tty" "$readiness_directory" "$deadline" &

  exec "$executable" -S "$socket_path" attach-session -t "$session_id" \
    \; select-window -t "$window_id" \
    \; select-pane -t "$pane_id"
}

case ${PI_GHOSTTY_TMUX_ACTION-} in
  run-pi) run_pi ;;
  attach) attach ;;
  *) exit 2 ;;
esac
