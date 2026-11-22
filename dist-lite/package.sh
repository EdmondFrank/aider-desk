#!/usr/bin/env bash
# Stage a built executable + assets into a shippable tarball.
#
#   ./package.sh                      # version from package.json, host platform
#   ./package.sh 0.91.0 linux-x64
#   WITH_PROBE=0 ./package.sh         # skip the ~53 MB probe binary
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUN="${BUN:-$(command -v bun || true)}"

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

[ -n "$BUN" ] || die "bun not found"
VERSION="${1:-$("$BUN" -e "console.log(require('$ROOT/package.json').version)")}"
SLUG="${2:-$(host_slug)}"
STAGE="$HERE/release/aiderdesk-lite-$VERSION-$SLUG"
BIN="$HERE/out/aiderdesk-lite-$SLUG"
WITH_PROBE="${WITH_PROBE:-1}"

[ -f "$BIN" ] || die "missing $BIN (run ./build.sh $SLUG)"

say "staging aiderdesk-lite $VERSION $SLUG -> $STAGE"
rm -rf "$STAGE"
mkdir -p "$STAGE" "$STAGE/node_modules/@homebridge"

# executable + launcher
cp "$BIN" "$STAGE/aiderdesk-lite"
cp "$HERE/run.sh" "$STAGE/run.sh"
chmod +x "$STAGE/aiderdesk-lite" "$STAGE/run.sh"

# single-page app
cp -R "$ROOT/out/renderer" "$STAGE/renderer"

# resources: the lite profile only reads prompts, skills and the probe binary
mkdir -p "$STAGE/resources"
cp -R "$ROOT/resources/prompts" "$ROOT/resources/skills" "$STAGE/resources/"
[ -f "$ROOT/resources/icon.png" ] && cp "$ROOT/resources/icon.png" "$STAGE/resources/"

if [ "$WITH_PROBE" != "0" ]; then
  case "$SLUG" in
    darwin-arm64) PROBE_SRC="$ROOT/resources/macos-arm64/probe"; PROBE_DIR=macos ;;
    darwin-x64)   PROBE_SRC="$ROOT/resources/macos-x64/probe";   PROBE_DIR=macos ;;
    linux-x64)    PROBE_SRC="$ROOT/resources/linux-x64/probe";   PROBE_DIR=linux ;;
    linux-arm64)  PROBE_SRC="$ROOT/resources/linux-arm64/probe"; PROBE_DIR=linux ;;
    *)            PROBE_SRC=""; PROBE_DIR="" ;;
  esac
  if [ -n "$PROBE_SRC" ] && [ -f "$PROBE_SRC" ]; then
    mkdir -p "$STAGE/resources/$PROBE_DIR"
    cp "$PROBE_SRC" "$STAGE/resources/$PROBE_DIR/probe"
    chmod +x "$STAGE/resources/$PROBE_DIR/probe"
  else
    say "note: no probe binary for $SLUG — semantic code search will be unavailable"
  fi
fi

# node-pty: native prebuild for the target only (terminal support)
PTY_SRC="$ROOT/node_modules/@homebridge/node-pty-prebuilt-multiarch"
PTY_DST="$STAGE/node_modules/@homebridge/node-pty-prebuilt-multiarch"
mkdir -p "$PTY_DST"
cp -R "$PTY_SRC/lib" "$PTY_SRC/package.json" "$PTY_DST/"
case "$SLUG" in
  darwin-*) cp -R "$PTY_SRC/build" "$PTY_DST/" ;;
  linux-*)  cp -R "$PTY_SRC/prebuilds/$SLUG" "$PTY_DST/prebuilds" 2>/dev/null || true ;;
esac

# shared runtimes for extensions loaded through jiti at runtime
cp -R "$ROOT/node_modules/zod" "$STAGE/node_modules/zod"
mkdir -p "$STAGE/node_modules/@aiderdesk/extensions"
cp -R "$ROOT/packages/extensions/dist" "$STAGE/node_modules/@aiderdesk/extensions/"
cp "$ROOT/packages/extensions/package.json" "$STAGE/node_modules/@aiderdesk/extensions/"
[ -f "$ROOT/packages/extensions/extensions.json" ] && cp "$ROOT/packages/extensions/extensions.json" "$STAGE/node_modules/@aiderdesk/extensions/"

# metadata + docs
printf '{\n  "name": "aiderdesk-lite",\n  "version": "%s",\n  "private": true\n}\n' "$VERSION" > "$STAGE/package.json"
echo "$VERSION" > "$STAGE/VERSION"
cp "$HERE/install.sh" "$HERE/README.md" "$HERE/GUIDELINE.md" "$STAGE/"

TGZ="$HERE/release/aiderdesk-lite-$VERSION-$SLUG.tar.gz"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$TGZ" -C "$HERE/release" "aiderdesk-lite-$VERSION-$SLUG" 2>/dev/null \
  || COPYFILE_DISABLE=1 tar czf "$TGZ" -C "$HERE/release" "aiderdesk-lite-$VERSION-$SLUG"
( cd "$HERE/release" && shasum -a 256 "$(basename "$TGZ")" > "$(basename "$TGZ").sha256" )

say "release: $TGZ ($(du -h "$TGZ" | cut -f1))"
cat "$TGZ.sha256"