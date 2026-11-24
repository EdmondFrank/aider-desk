# Code Mode Lua Extension

Renders [AiderDesk](https://aiderdesk.hotovo.com) task messages for the `mcp-hub` MCP server's
`code_mode` tool with proper **Lua syntax highlighting**.

## What it does

The `code_mode` tool accepts a `{ code, timeout }` argument pair, where `code` is a Lua script that
is executed in a sandbox. By default AiderDesk renders the tool message as generic plain text, which
makes the Lua script hard to read.

This extension registers a `task-message` UI component filtered to tool messages from the `mcp-hub`
server and the `code_mode` tool. When a matching message is rendered it:

- displays the executed Lua script in a syntax-highlighted `CodeBlock` (`language="lua"`);
- splits the tool result into its two logical parts - the script's **Output** (`print` stdout) and
  its **Return value** - and renders each in its own labeled section;
- highlights the return value as JSON when it parses as JSON, otherwise as plain text, with a
  spinner while running, an error/success icon once finished, and a `timeout` chip when the call
  set one.

## Target

| Field        | Value      |
| ------------ | ---------- |
| MCP server   | `mcp-hub`  |
| MCP tool     | `code_mode`|
| Placement    | `task-message` |

## Installation

Copy this folder to one of:

- **Global**: `~/.aider-desk/extensions/code-mode-lua/`
- **Project**: `<project-folder>/.aider-desk/extensions/code-mode-lua/`

The extension is UI-only and has no dependencies, so no `npm install` step is required.