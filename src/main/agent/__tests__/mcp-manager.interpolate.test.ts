import { describe, expect, it } from 'vitest';

import { McpManager } from '../mcp-manager';

import type { McpServerConfig } from '@common/types';

const baseConfig = (overrides: Partial<McpServerConfig> = {}): McpServerConfig => ({
  url: 'http://localhost:9069/desktop/mcp',
  ...overrides,
});

const interpolateServerConfig = (config: McpServerConfig, projectDir: string | null, taskDir: string | null): McpServerConfig => {
  const manager = new McpManager();
  return (manager as any).interpolateServerConfig(config, projectDir, taskDir);
};

describe('interpolateServerConfig', () => {
  it('substitutes ${projectDir} and ${taskDir} in every supported field', () => {
    const config = baseConfig({
      command: '${projectDir}/bin/mcp-server',
      url: 'http://localhost:9069/${projectDir}/mcp',
      env: { PROJECT: '${projectDir}', TASK: '${taskDir}' },
      args: ['--dir=${projectDir}', '--task=${taskDir}'],
      headers: { 'x-project-dir': '${projectDir}' },
    });

    const result = interpolateServerConfig(config, '/Users/me/repo', '/Users/me/repo/task');

    expect(result.command).toBe('/Users/me/repo/bin/mcp-server');
    expect(result.url).toBe('http://localhost:9069//Users/me/repo/mcp');
    expect(result.env).toEqual({ PROJECT: '/Users/me/repo', TASK: '/Users/me/repo/task' });
    expect(result.args).toEqual(['--dir=/Users/me/repo', '--task=/Users/me/repo/task']);
    expect(result.headers).toEqual({ 'x-project-dir': '/Users/me/repo' });
  });

  it('interpolates headers and arguments without a placeholder unchanged', () => {
    const config = baseConfig({ headers: { Authorization: 'Bearer token' }, args: ['--port=9069'] });

    const result = interpolateServerConfig(config, '/repo', null);

    expect(result.headers).toEqual({ Authorization: 'Bearer token' });
    expect(result.args).toEqual(['--port=9069']);
  });

  it('falls back to the project dir for ${taskDir} and to "." for an unknown project dir', () => {
    const config = baseConfig({ env: { TASK: '${taskDir}' }, args: ['--dir=${projectDir}'] });

    const withProjectDir = interpolateServerConfig(config, '/repo', null);
    expect(withProjectDir.env).toEqual({ TASK: '/repo' });
    expect(withProjectDir.args).toEqual(['--dir=/repo']);

    const withoutDirs = interpolateServerConfig(config, null, null);
    expect(withoutDirs.env).toEqual({ TASK: '.' });
    expect(withoutDirs.args).toEqual(['--dir=.']);
  });

  it('does not mutate the input config', () => {
    const config = baseConfig({ headers: { 'x-project-dir': '${projectDir}' }, args: ['--dir=${projectDir}'] });

    const result = interpolateServerConfig(config, '/repo', null);

    expect(result).not.toBe(config);
    expect(config.headers).toEqual({ 'x-project-dir': '${projectDir}' });
    expect(config.args).toEqual(['--dir=${projectDir}']);
  });
});
