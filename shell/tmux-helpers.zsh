# Additive tmux helpers for the tiled workflow. Existing z-prefixed Zellij
# functions keep their original meaning and live outside this file.

_pi_tmux_run_bounded() {
  /usr/bin/perl -e 'my $seconds = shift @ARGV; alarm $seconds; exec @ARGV' 5 "$@"
}

_pi_tmux_context() {
  local socket_path=${TMUX%%,*}
  local pane_id=${TMUX_PANE:-}
  if [[ -z ${TMUX:-} || "$socket_path" != /* || ! "$pane_id" =~ '^%[0-9]+$' ]]; then
    print -u2 -- 'error: this helper requires a valid tmux socket and pane identity'
    return 1
  fi
  print -r -- "$socket_path"$'\t'"$pane_id"
}

# Run a command in a new tiled pane beside the current pane.
tmux-run() {
  emulate -L zsh
  (( $# > 0 )) || { print -u2 -- 'usage: tmux-run <command>'; return 2; }

  local context socket_path pane_id tmux_bin child_pane command_text
  context=$(_pi_tmux_context) || return
  socket_path=${context%%$'\t'*}
  pane_id=${context#*$'\t'}
  tmux_bin=${PI_TMUX_EXECUTABLE:-tmux}
  command_text="$*"

  child_pane=$(_pi_tmux_run_bounded "$tmux_bin" -S "$socket_path" split-window -h -P -F '#{pane_id}' \
    -t "$pane_id" -c '#{pane_current_path}' /bin/zsh -ic "$command_text") || {
    print -u2 -- 'error: could not create the tmux command pane'
    return 1
  }
  [[ "$child_pane" =~ '^%[0-9]+$' ]] || { print -u2 -- 'error: tmux returned an invalid pane ID'; return 1; }
  _pi_tmux_run_bounded "$tmux_bin" -S "$socket_path" select-pane -t "$child_pane" -T "$command_text" >/dev/null || true
  print -r -- "$child_pane"
}

# Open files in $EDITOR in a new tiled pane. Arguments remain separate argv.
tmux-edit() {
  emulate -L zsh
  (( $# > 0 )) || { print -u2 -- 'usage: tmux-edit <file> [...]'; return 2; }

  local context socket_path pane_id tmux_bin child_pane editor_value title
  local -a editor_argv
  context=$(_pi_tmux_context) || return
  socket_path=${context%%$'\t'*}
  pane_id=${context#*$'\t'}
  tmux_bin=${PI_TMUX_EXECUTABLE:-tmux}
  editor_value=${EDITOR:-vi}
  editor_argv=(${(z)editor_value})
  (( ${#editor_argv[@]} > 0 )) || { print -u2 -- 'error: EDITOR is empty'; return 2; }
  title="edit ${1:t}"

  child_pane=$(_pi_tmux_run_bounded "$tmux_bin" -S "$socket_path" split-window -h -P -F '#{pane_id}' \
    -t "$pane_id" -c '#{pane_current_path}' "${editor_argv[@]}" "$@") || {
    print -u2 -- 'error: could not create the tmux editor pane'
    return 1
  }
  [[ "$child_pane" =~ '^%[0-9]+$' ]] || { print -u2 -- 'error: tmux returned an invalid pane ID'; return 1; }
  _pi_tmux_run_bounded "$tmux_bin" -S "$socket_path" select-pane -t "$child_pane" -T "$title" >/dev/null || true
  print -r -- "$child_pane"
}

# Keep the interactive spelling available after this file is sourced.
re-tmux() {
  "$HOME/bin/re-tmux" "$@"
}
