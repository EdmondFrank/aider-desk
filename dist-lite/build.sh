#!/usr/bin/env bash
# Build a self-contained AiderDesk Lite executable (Bun runtime embedded, no
# Node/Bun/Python needed on the target).
#
#   ./build.sh                     # host platform -> out/aiderdesk-lite-<slug>
#   ./build.sh linux-x64           # cross-build for another target
#   SKIP_BUILD=1 ./build.sh        # reuse the existing out/server + out/renderer
#   BUN=/path/to/bun ./build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OUT_DIR="$HERE/out"

say() { echo "== $*"; }
die() { echo "error: $*" >&2; exit 1; }

host_slug() {
  local os arch
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) die "unsupported host: $(uname -s) (pass a slug explicitly)" ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) arch=arm64 ;;
    x86_64|amd64) arch=x64 ;;
    *) die "unsupported architecture: $(uname -m)" ;;
  esac
  echo "$os-$arch"
}

SLUG="${1:-$(host_slug)}"
HOST="$(host_slug)"
BUN="${BUN:-$(command -v bun || true)}"
[ -n "$BUN" ] || die "bun not found (needed to build; https://bun.sh)"

BUN_VERSION="$("$BUN" --version)"
[ "$(printf '%s\n1.3.0\n' "$BUN_VERSION" | sort -V | head -1)" = "1.3.0" ] || die "bun >= 1.3 required (found $BUN_VERSION)"

OUT="$OUT_DIR/aiderdesk-lite-$SLUG"

say "aiderdesk-lite $SLUG -> $OUT"

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  say "building renderer + server bundles (npm run build:lite)"
  ( cd "$ROOT" && npm run build:lite )
fi

say "compiling standalone executable"
"$BUN" "$HERE/scripts/build-lite-dist.ts" "$SLUG"

# Bun does not sign the produced executable; Apple Silicon refuses unsigned
# (even ad-hoc-free) binaries on first run.
if [ -x "$(command -v codesign 2>/dev/null || true)" ]; then
  case "$SLUG" in darwin-*)
    codesign --force --sign - "$OUT" >/dev/null 2>&1 && say "ad-hoc signed for macOS" || say "warning: ad-hoc codesign failed"
    ;;
  esac
fi

# Smoke test only on the host: a cross-built binary cannot run here.
if [ "$SLUG" = "$HOST" ]; then
  say "smoke test"
  WORK="$(mktemp -d)"
  DATA="$WORK/data"
  PORT="$("$BUN" -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
  no_proxy="127.0.0.1,localhost,::1" NO_PROXY="127.0.0.1,localhost,::1" \
  AIDER_DESK_DATA_DIR="$DATA" \
  AIDER_DESK_PORT="$PORT" \
  AIDER_DESK_RESOURCES_DIR="$ROOT/out/resources" \
  AIDER_DESK_RENDERER_DIR="$ROOT/out/renderer" \
  NODE_ENV=production \
    "$OUT" > "$WORK/server.log" 2>&1 &
  PID=$!
  READY=0
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 1 "http://127.0.0.1:$PORT/api/settings" >/dev/null 2>&1; then READY=1; break; fi
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.5
  done
  if [ "$READY" = 1 ]; then
    say "smoke test ok (http://127.0.0.1:$PORT)"
  else
    echo "== smoke test FAILED" >&2
    tail -40 "$WORK/server.log" >&2
  fi
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  rm -rf "$WORK"
  [ "$READY" = 1 ] || exit 1
else
  say "cross-built for $SLUG — skipped smoke test (run it on the target)"
fi

say "done: $OUT ($(du -h "$OUT" | cut -f1))"