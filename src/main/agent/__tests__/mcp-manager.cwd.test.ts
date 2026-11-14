import { describe, expect, it, vi } from 'vitest';
import { McpServerScope, type McpServerConfig } from '@common/types';

import { McpManager } from '../mcp-manager';

vi.mock('@/logger');

const resolveCwd = (config: McpServerConfig, projectDir: string | null, taskDir: string | null): string | undefined =>
  (new McpManager() as any).resolveConnectorCwd(config, projectDir, taskDir);

describe('McpManager - transport CWD resolution', () => {
  it('runs a non-interpolated server in the project directory by default (local task)', () => {
    const config: McpServerConfig = { command: 'node', args: ['server.js', '.'] };
    expect(resolveCwd(config, '/project', '/project')).toBe('/project');
  });

  it('runs a non-interpolated server in the project directory for a worktree task by default', () => {
    const config: McpServerConfig = { command: 'node', args: ['server.js', '.'] };
    expect(resolveCwd(config, '/project', '/project/worktree')).toBe('/project');
  });

  it('runs an explicitly task-scoped server in the task directory (worktree isolation)', () => {
    const config: McpServerConfig = { command: 'node', args: ['server.js'], scope: McpServerScope.Task };
    expect(resolveCwd(config, '/project', '/project/worktree')).toBe('/project/worktree');
  });

  it('runs a ${taskDir} server in the task directory', () => {
    const config: McpServerConfig = { command: 'node', args: ['server.js', '${taskDir}'] };
    expect(resolveCwd(config, '/project', '/project/worktree')).toBe('/project/worktree');
  });

  it('runs an explicitly global server rooted at the project', () => {
    const config: McpServerConfig = { command: 'node', args: ['server.js'], scope: McpServerScope.Global };
    expect(resolveCwd(config, '/project', '/project/worktree')).toBe('/project');
  });
});
