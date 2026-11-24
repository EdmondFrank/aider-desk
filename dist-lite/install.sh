#!/usr/bin/env bash
# Install AiderDesk Lite (self-contained binary); no Node, Bun or Python needed.
#
#   ./install.sh                         # -> ~/.local/{bin,lib/aiderdesk-lite}
#   ./install.sh --prefix /opt           # -> /opt/{bin,lib/aiderdesk-lite}
#   ./install.sh --data-dir ~/ad-lite    # keep settings elsewhere
#   ./install.sh --force                 # replace an existing install
#   ./install.sh --dry-run
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FROM="$HERE"
PREFIX="${PREFIX:-$HOME/.local}"
DATA_DIR="${AIDER_DESK_DATA_DIR:-$HOME/.local/share/aider-desk-lite}"
FORCE=0
DRY=0
SHIM=1

die() { echo "error: $*" >&2; exit 1; }
say() { echo "== $*"; }
run() { if [ "$DRY" = 1 ]; then echo "   [dry] $*"; else "$@"; fi; }

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix)   PREFIX="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --from)     FROM="$2"; shift 2 ;;
    --force)    FORCE=1; shift ;;
    --no-shim)  SHIM=0; shift ;;
    --dry-run)  DRY=1; shift ;;
    -h|--help)  sed -n '2,10p' "$0"; exit 0 ;;
    *)          die "unknown option: $1" ;;
  esac
done

# A release tarball unpacks the payload next to install.sh; pass --from for
# a staged build tree (dist-lite/release/aiderdesk-lite-<version>-<slug>).
[ -f "$FROM/aiderdesk-lite" ] || die "missing $FROM/aiderdesk-lite (install from an unpacked release tarball, or pass --from <dir>)"
[ -f "$FROM/run.sh" ] || die "missing $FROM/run.sh"
[ -d "$FROM/renderer" ] || die "missing $FROM/renderer"

LIB="$PREFIX/lib/aiderdesk-lite"
BIN_DIR="$PREFIX/bin"

if [ -e "$LIB" ] && [ "$FORCE" != 1 ]; then
  die "$LIB already exists (use --force to replace it)"
fi

say "installing into $LIB"
run mkdir -p "$LIB" "$BIN_DIR"
if [ "$FORCE" = 1 ] && [ -e "$LIB" ]; then
  run rm -rf "$LIB"
  run mkdir -p "$LIB"
fi
for entry in aiderdesk-lite run.sh renderer resources node_modules package.json VERSION README.md GUIDELINE.md; do
  [ -e "$FROM/$entry" ] || continue
  run cp -R "$FROM/$entry" "$LIB/"
done
run chmod +x "$LIB/aiderdesk-lite" "$LIB/run.sh"
# Pin the data directory so the launcher does not fall back to its default.
if [ "$DRY" = 1 ]; then
  echo "   [dry] pin data dir $DATA_DIR"
else
  printf '%s\n' "$DATA_DIR" > "$LIB/data-dir"
fi

if [ "$SHIM" = 1 ]; then
  say "linking $BIN_DIR/aiderdesk-lite"
  if [ "$DRY" = 1 ]; then
    echo "   [dry] write $BIN_DIR/aiderdesk-lite"
  else
    printf '#!/bin/sh\nexec "%s/run.sh" "$@"\n' "$LIB" > "$BIN_DIR/aiderdesk-lite"
    chmod +x "$BIN_DIR/aiderdesk-lite"
  fi
fi

run mkdir -p "$DATA_DIR"

say "installed"
cat <<EOF

  start:   AIDER_DESK_PORT=23456 aiderdesk-lite
           (or run $LIB/run.sh)
  open:    http://localhost:23456
  data:    $DATA_DIR
  config:  AIDER_DESK_DATA_DIR, AIDER_DESK_PORT, AIDER_DESK_USERNAME/.PASSWORD,
           AIDER_DESK_PROJECTS (comma-separated project paths)

EOF
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "note: add $BIN_DIR to PATH to run 'aiderdesk-lite' directly" ;;
esac