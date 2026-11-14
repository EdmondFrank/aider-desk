vi.mock('@/logger');

import { describe, expect, it, vi } from 'vitest';

import { McpManager } from '../mcp-manager';

type PooledMaps = {
  mcpConnectors: Map<string, Promise<unknown>>;
  connectorServerUrls: Map<string, string>;
};

const makeConnector = (serverName: string) => {
  const close = vi.fn(async () => undefined);
  const promise = Promise.resolve({
    client: { close },
    serverName,
    tools: [],
    toolDefinitions: { tools: [] },
    serverConfig: {},
  });
  return { promise, close };
};

describe('McpManager - evictConnectorsForDir', () => {
  it('closes connectors whose scope references the dir and preserves global/other projects', async () => {
    const manager = new McpManager();
    const maps = manager as unknown as PooledMaps;

    const projectScoped = makeConnector('srv'); // scope = /proj
    const taskScoped = makeConnector('srv'); // scope = /proj:/proj/wt (both interpolations)
    const otherProject = makeConnector('srv'); // scope = /other
    const globalScoped = makeConnector('srv'); // scope = global
    const lookalike = makeConnector('srv'); // scope = /projX (must NOT match /proj)

    maps.mcpConnectors.set('/proj:srv', projectScoped.promise);
    maps.mcpConnectors.set('/proj:/proj/wt:srv', taskScoped.promise);
    maps.mcpConnectors.set('/other:srv', otherProject.promise);
    maps.mcpConnectors.set('global:srv', globalScoped.promise);
    maps.mcpConnectors.set('/projX:srv', lookalike.promise);

    const closed = await manager.evictConnectorsForDir('/proj');

    expect(closed).toBe(2);
    expect(projectScoped.close).toHaveBeenCalledTimes(1);
    expect(taskScoped.close).toHaveBeenCalledTimes(1);
    expect(otherProject.close).not.toHaveBeenCalled();
    expect(globalScoped.close).not.toHaveBeenCalled();
    expect(lookalike.close).not.toHaveBeenCalled();
    expect(maps.mcpConnectors.has('/proj:srv')).toBe(false);
    expect(maps.mcpConnectors.has('/proj:/proj/wt:srv')).toBe(false);
    expect(maps.mcpConnectors.has('global:srv')).toBe(true);
    expect(maps.mcpConnectors.has('/other:srv')).toBe(true);
    expect(maps.mcpConnectors.has('/projX:srv')).toBe(true);
  });

  it('evicts a worktree task scope by the worktree path segment', async () => {
    const manager = new McpManager();
    const maps = manager as unknown as PooledMaps;

    const taskScoped = makeConnector('srv');
    maps.mcpConnectors.set('/proj:/proj/wt:srv', taskScoped.promise);

    const closed = await manager.evictConnectorsForDir('/proj/wt');

    expect(closed).toBe(1);
    expect(taskScoped.close).toHaveBeenCalledTimes(1);
    expect(maps.mcpConnectors.size).toBe(0);
  });

  it('returns 0 and closes nothing for an empty dir', async () => {
    const manager = new McpManager();
    const maps = manager as unknown as PooledMaps;
    const c = makeConnector('srv');
    maps.mcpConnectors.set('/proj:srv', c.promise);

    const closed = await manager.evictConnectorsForDir('');

    expect(closed).toBe(0);
    expect(c.close).not.toHaveBeenCalled();
    expect(maps.mcpConnectors.size).toBe(1);
  });
});
