# GUIDELINE — bring up AiderDesk Lite on a new machine

Runbook for the artifact produced by `build.sh` + `package.sh`. Target: macOS
(arm64/x64) or Linux (x64/arm64) with a shell. **No Node, Bun, Python or `aider-chat`
required** on the target.

Time: ~3 minutes once the tarball is on the machine.

---

## 0. Prepare the artifact (on the build machine)

```bash
cd ~/Code/aider-desk
npm run install:lite                 # once per upstream bump
./build.sh                           # -> dist-lite/out/aiderdesk-lite-darwin-arm64
./package.sh                         # -> dist-lite/release/aiderdesk-lite-<ver>-darwin-arm64.tar.gz
```

Cross-build for a server:

```bash
./build.sh linux-x64 && ./package.sh 0.91.0 linux-x64
```

`WITH_PROBE=0 ./package.sh` drops the ~53 MB search binary. The host build runs an
automatic smoke test (start, `GET /api/settings`, shutdown); cross-builds do not — verify
them on the target.

## 1. Transfer

```bash
scp dist-lite/release/aiderdesk-lite-0.91.0-linux-x64.tar.gz* user@host:/tmp/
```

## 2. Install

```bash
cd /tmp
shasum -a 256 -c aiderdesk-lite-0.91.0-linux-x64.tar.gz.sha256
tar xzf aiderdesk-lite-0.91.0-linux-x64.tar.gz
cd aiderdesk-lite-0.91.0-linux-x64
./install.sh                          # ~/.local/{bin,lib/aiderdesk-lite}
# or: ./install.sh --prefix /opt --data-dir /var/lib/aiderdesk
```

`install.sh` copies the payload, writes the `aiderdesk-lite` shim and creates the data
directory. Use `--force` to replace an existing install, `--dry-run` to preview.

## 3. Run

```bash
AIDER_DESK_PORT=23456 aiderdesk-lite
# open http://localhost:23456
```

First start is a blank profile: no providers, no projects. Configure providers in the UI,
or pre-seed `$AIDER_DESK_DATA_DIR/config.json`.

Open projects at startup and/or protect the server:

```bash
AIDER_DESK_PROJECTS="$HOME/Code/project-a,$HOME/Code/project-b" aiderdesk-lite
AIDER_DESK_USERNAME=admin AIDER_DESK_PASSWORD='…' aiderdesk-lite
AIDER_DESK_PROJECTS="$HOME/Code/project-a" AIDER_DESK_READONLY=true aiderdesk-lite
```

Health check: `curl -fsS http://127.0.0.1:23456/api/settings >/dev/null && echo ok`.

## 4. Keep it running (optional)

No service unit is installed. Minimal examples:

systemd (user):

```ini
# ~/.config/systemd/user/aiderdesk-lite.service
[Unit]
Description=AiderDesk Lite
[Service]
ExecStart=%h/.local/bin/aiderdesk-lite
Environment=AIDER_DESK_PORT=23456
Environment=AIDER_DESK_PROJECTS=%h/Code/project-a
Restart=on-failure
[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload && systemctl --user enable --now aiderdesk-lite
```

launchd (macOS):

```bash
cat > ~/Library/LaunchAgents/dev.aiderdesk.lite.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.aiderdesk.lite</string>
  <key>ProgramArguments</key><array>
    <string>/Users/me/.local/bin/aiderdesk-lite</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>AIDER_DESK_PORT</key><string>23456</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
PLIST
launchctl load ~/Library/LaunchAgents/dev.aiderdesk.lite.plist
```

## 5. Verify the profile

- `curl -fsS localhost:23456/api/settings | head -c 200` returns JSON.
- The UI shows **agent mode only** (the lite build hides aider modes).
- Terminals open (node-pty shipped); if not, check `<install>/node_modules/@homebridge/...`.
- Agent code search works when `resources/<macos|linux>/probe` exists and is executable.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `AiderDesk Lite is ready` never appears, port in use | another instance — set `AIDER_DESK_PORT` |
| Terminal panel fails with `Cannot find module` | node-pty missing/not executable; reinstall, or the build was staged without `node_modules/@homebridge` |
| Code search says probe is missing | package with `WITH_PROBE=1` (default) and ensure `resources/<os>/probe` is executable |
| macOS: "cannot be opened because the developer cannot be verified" | `xattr -dr com.apple.quarantine ~/.local/lib/aiderdesk-lite` |
| Extensions importing `node:sqlite` fail | known Bun limitation — disable that extension |
| Memory search fails after `AIDER_DESK_MEMORY_ENABLED=true` | embeddings are not shipped in the dist |

## Upgrading

```bash
./install.sh --force        # from the new unpacked tarball; the data dir is untouched
```

Stop the old process first: the data directory is last-writer-wins, so do not run two
versions against it.