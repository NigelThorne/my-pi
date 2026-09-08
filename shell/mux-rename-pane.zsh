#!/bin/sh
set -eu

new_name=${1:?usage: mux-rename-pane.zsh NEW_NAME}

run_bounded() {
  /usr/bin/perl -e 'my $seconds = shift @ARGV; alarm $seconds; exec @ARGV' 5 "$@"
}

if [ -n "${TMUX:-}" ] && [ -n "${TMUX_PANE:-}" ]; then
  socket_path=${TMUX%%,*}
  case "$socket_path" in
    /*) ;;
    *) printf 'error: invalid tmux socket path\n' >&2; exit 2 ;;
  esac
  printf '%s\n' "$TMUX_PANE" | grep -Eq '^%[0-9]+$' || {
    printf 'error: invalid tmux pane ID\n' >&2
    exit 2
  }
  tmux_bin=${PI_TMUX_EXECUTABLE:-$(command -v tmux || true)}
  [ -n "$tmux_bin" ] || { printf 'error: tmux is not on PATH\n' >&2; exit 1; }
  run_bounded "$tmux_bin" -S "$socket_path" select-pane -t "$TMUX_PANE" -T "$new_name"
  exit $?
fi

if [ -n "${ZELLIJ_PANE_ID:-}" ]; then
  printf '%s\n' "$ZELLIJ_PANE_ID" | grep -Eq '^[0-9]+$' || {
    printf 'error: invalid Zellij pane ID\n' >&2
    exit 2
  }
  zellij_bin=$(command -v zellij || true)
  [ -n "$zellij_bin" ] || { printf 'error: zellij is not on PATH\n' >&2; exit 1; }
  run_bounded "$zellij_bin" action rename-pane --pane-id "$ZELLIJ_PANE_ID" "$new_name"
  exit $?
fi

printf 'error: no supported mux pane identity is available\n' >&2
exit 2
