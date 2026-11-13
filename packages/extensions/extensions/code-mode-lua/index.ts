import { readFileSync } from 'fs';
import { join } from 'path';

import type { Extension, UIComponentDefinition } from '../../extensions.d.ts';

const metadata = {
  name: 'Code Mode Lua',
  version: '1.0.0',
  description: 'Renders mcp-hub code_mode tool messages with Lua syntax highlighting for the executed script',
  author: 'edmondfrank',
  capabilities: ['ui'],
};

class CodeModeLuaExtension implements Extension {
  static metadata = metadata;

  getUIComponents(): UIComponentDefinition[] {
    return [
      {
        id: 'code-mode-lua-message',
        placement: 'task-message',
        jsx: readFileSync(join(__dirname, 'CodeModeLuaMessage.jsx'), 'utf-8'),
        messageFilter: {
          types: ['tool'],
          serverName: 'mcp-hub',
          toolName: 'code_mode',
        },
      },
    ];
  }
}

export default CodeModeLuaExtension;