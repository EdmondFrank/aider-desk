#!/bin/sh
# Launcher for the standalone AiderDesk Lite server: points the executable at
# the assets shipped next to it, then execs it with the runtime defaults.
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

: "${AIDER_DESK_RENDERER_DIR:=$DIR/renderer}"
: "${AIDER_DESK_RESOURCES_DIR:=$DIR/resources}"
: "${AIDER_DESK_NODE_PTY_PATH:=$DIR/node_modules/@homebridge/node-pty-prebuilt-multiarch/lib/index.js}"
: "${AIDER_DESK_RUNTIME_MODULES_DIR:=$DIR/node_modules}"
if [ -z "${AIDER_DESK_DATA_DIR:-}" ] && [ -f "$DIR/data-dir" ]; then
  AIDER_DESK_DATA_DIR=$(cat "$DIR/data-dir")
fi
: "${AIDER_DESK_DATA_DIR:=$HOME/.local/share/aider-desk-lite}"
: "${AIDER_DESK_PORT:=23456}"

export AIDER_DESK_RENDERER_DIR AIDER_DESK_RESOURCES_DIR AIDER_DESK_NODE_PTY_PATH AIDER_DESK_RUNTIME_MODULES_DIR AIDER_DESK_DATA_DIR AIDER_DESK_PORT

mkdir -p "$AIDER_DESK_DATA_DIR"
exec "$DIR/aiderdesk-lite" "$@"