import { describe, it, expect } from 'vitest';
import { McpServerScope } from '@common/types';

import { McpManager } from '../mcp-manager';

import type { McpServerConfig } from '@common/types';

describe('McpManager - scope calculation', () => {
  it('should share a non-interpolated stdio server across local tasks (project scope)', () => {
    const manager = new McpManager();
    const config: McpServerConfig = {
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', '/path'],
    };

    // Local task: taskDir === projectDir -> project scope (shared across the project's tasks).
    const scope = (manager as any).calculateServerScope(config, '/project', '/project', 'test-server');
    expect(scope).toBe('/project');
  });

  it('should share a non-interpolated stdio server across worktree tasks by default (project scope)', () => {
    const manager = new McpManager();
    const config: McpServerConfig = {
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', '/path'],
    };

    // Worktree task without explicit scope or ${taskDir} -> project scope (shared).
    const scopeA = (manager as any).calculateServerScope(config, '/project', '/project/worktree-a', 'test-server');
    const scopeB = (manager as any).calculateServerScope(config, '/project', '/project/worktree-b', 'test-server');
    expect(scopeA).toBe('/project');
    expect(scopeB).toBe('/project');
  });

  it('should isolate worktree connectors when ${taskDir} is used', () => {
    const manager = new McpManager();
    const config: McpServerConfig = {
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', '${taskDir}'],
    };

    const scopeA = (manager as any).calculateServerScope(config, '/project', '/project/worktree-a', 'test-server');
    const scopeB = (manager as any).calculateServerScope(config, '/project', '/project/worktree-b', 'test-server');
    expect(scopeA).toBe('/project/worktree-a');
    expect(scopeB).toBe('/project/worktree-b');
    expect(scopeA).not.toBe(scopeB);
  });

  it('should honor an explicit project scope to share a server across worktree tasks', () => {
    const manager = new McpManager();
    const config: McpServerConfig = {
      command: 'npx',
      args: ['@modelcontextprotocol/server-playwright'],
      scope: McpServerScope.Project,
    };

    const scopeA = (manager as any).calculateServerScope(config, '/project', '/project/worktree-a', 'test-server');
    const scopeB = (manager as any).calculateServerScope(config, '/project', '/project/worktree-b', 'test-server');
    expect(scopeA).toBe('/project');
    expect(scopeB).toBe('/project');
  });

  it('should honor an explicit global scope across projects', () => {
    const manager = new McpManager();
    const config: McpServerConfig = {
      command: 'npx',
      args: ['-y', 'context7-mcp'],
      scope: McpServerScope.Global,
    };

    const scopeA = (manager as any).calculateServerScope(config, '/projectA', '/projectA', 'test-server');
    const scopeB = (manager as any).calculateServerScope(config, '/projectB', '/projectB', 'test-server');
    expect(scopeA).toBe('global');
    expect(scopeB).toBe('global');
  });

  it('should honor an explicit task scope to isolate a server', () => {
    const manager = new McpManager();
    const config: McpServerConfig = {
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', '.'],
      scope: McpServerScope.Task,
    };

    const scope = (manager as any).calculateServerScope(config, '/project', '/project/worktree', 'test-server');
    expect(scope).toBe('/project/worktree');
  });

  it('should fall back to global for a non-interpolated stdio server without a projectDir', () => {
    const manager = new McpManager();
    const config: McpServerConfig = {
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', '/path'],
    };

    const scope = (manager as any).calculateServerScope(config, null, '/project/worktree', 'test-server');
    expect(scope).toBe('global');
  });

  it('should calculate scope with projectDir when no taskDir', () => {
    const manager = new McpManager();
    const config: McpServerConfig = {
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', '/path'],
    };

    const scope = (manager as any).calculateServerScope(config, '/project', null, 'test-server');
    expect(scope).toBe('/project');
  });

  it('should calculate global scope when no interpolation and no dirs', () => {
    const manager = new McpManager();
    const config: McpServerConfig = {
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', '/path'],
    };

    const scope = (manager as any).calculateServerScope(config, null, null, 'test-server');
    expect(scope).toBe('global');
  });

  it('should calculate global scope for a remote server without interpolation', () => {
    const manager = new McpManager();
    const config: McpServerConfig = {
      url: 'http://localhost:8080/sse',
    };

    const scope = (manager as any).calculateServerScope(config, '/project', '/project/worktree', 'test-server');
    expect(scope).toBe('global');
  });

  it('should calculate scope with projectDir interpolation only', () => {
    const manager = new McpManager();
    const config: McpServerConfig = {
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', '${projectDir}/data'],
    };

    const scope = (manager as any).calculateServerScope(config, '/project', '/project/worktree', 'test-server');
    expect(scope).toBe('/project');
  });

  it('should calculate global scope with projectDir interpolation but no projectDir', () => {
    const manager = new McpManager();
    const config: McpServerConfig = {
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', '${projectDir}/data'],
    };

    const scope = (manager as any).calculateServerScope(config, null, '/project/worktree', 'test-server');
    expect(scope).toBe('global');
  });

  it('should calculate scope with both projectDir and taskDir interpolation', () => {
    const manager = new McpManager();
    const config: McpServerConfig = {
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', '${projectDir}/${taskDir}'],
    };

    const scope = (manager as any).calculateServerScope(config, '/project', '/project/worktree', 'test-server');
    expect(scope).toBe('/project:/project/worktree');
  });

  it('should calculate global scope with both interpolations but no projectDir', () => {
    const manager = new McpManager();
    const config: McpServerConfig = {
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', '${projectDir}/${taskDir}'],
    };

    const scope = (manager as any).calculateServerScope(config, null, '/project/worktree', 'test-server');
    expect(scope).toBe('global');
  });

  it('should detect interpolation in env vars', () => {
    const manager = new McpManager();
    const config: McpServerConfig = {
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', '/path'],
      env: {
        PROJECT_PATH: '${projectDir}',
      },
    };

    const scope = (manager as any).calculateServerScope(config, '/project', '/project/worktree', 'test-server');
    expect(scope).toBe('/project');
  });

  it('should detect interpolation in URL', () => {
    const manager = new McpManager();
    const config: McpServerConfig = {
      url: 'http://localhost:8080/${projectDir}',
    };

    const scope = (manager as any).calculateServerScope(config, '/project', '/project/worktree', 'test-server');
    expect(scope).toBe('/project');
  });

  it('should detect interpolation in headers', () => {
    const manager = new McpManager();
    const config: McpServerConfig = {
      url: 'http://localhost:8080',
      headers: {
        'X-Project-Dir': '${projectDir}',
      },
    };

    const scope = (manager as any).calculateServerScope(config, '/project', '/project/worktree', 'test-server');
    expect(scope).toBe('/project');
  });
});
