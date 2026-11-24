vi.mock('@/logger');

import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AgentProfile, type McpServerConfig } from '@common/types';

type InitFailure = (serverName: string, error: unknown) => void;

type TestableManager = {
  initMcpConnectors: (
    mcpServers: Record<string, McpServerConfig>,
    projectDir: string | null,
    taskDir: string | null,
    forceReload?: boolean,
    enabledServers?: string[],
    onFailure?: InitFailure,
  ) => Promise<unknown[]>;
  initMcpConnector: (...args: unknown[]) => Promise<unknown>;
  saveToolsCache: () => Promise<void>;
  createToolset: (
    task: unknown,
    profile: AgentProfile,
    providerName: string,
    mcpServers: Record<string, McpServerConfig>,
    approvalManager: unknown,
  ) => Promise<Record<string, unknown>>;
};

const servers: Record<string, McpServerConfig> = {
  'test-server': { url: 'http://127.0.0.1:1/mcp' },
};

const createProfile = (): AgentProfile =>
  ({
    enabledServers: ['test-server'],
    toolApprovals: {},
    minTimeBetweenToolCalls: 0,
  }) as AgentProfile;

const createTask = () => ({
  getProjectDir: () => '/project',
  getTaskDir: () => '/project/task',
  addLogMessage: vi.fn(),
  addToolMessage: vi.fn(),
});

const connector = {
  client: { close: vi.fn(async () => undefined) },
  serverName: 'test-server',
  tools: [],
  toolDefinitions: { tools: [] },
  serverConfig: {},
};

/**
 * The init deadline is a module-level constant read from the environment, so each
 * test loads a fresh copy of the module with the budget it needs. `'0'` disables
 * the deadline, which keeps the "rejected connector" test independent of timers.
 */
const loadManager = async (timeoutMs: string): Promise<TestableManager> => {
  vi.resetModules();
  vi.stubEnv('AIDER_DESK_MCP_INIT_TIMEOUT_MS', timeoutMs);
  const { McpManager } = await import('../mcp-manager');
  const manager = new McpManager({ getStatus: async () => ({ status: 'none' }), init: async () => undefined } as never, () => 'en');
  const testable = manager as unknown as TestableManager;
  vi.spyOn(testable, 'saveToolsCache').mockResolvedValue(undefined);
  return testable;
};

describe('McpManager - connector init recovery', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('evicts a connector that failed to connect, so the next prompt dials it again', async () => {
    const manager = await loadManager('0');
    const connect = vi.spyOn(manager, 'initMcpConnector').mockRejectedValueOnce(new Error('connect ECONNREFUSED')).mockResolvedValue(connector);
    const failures: string[] = [];

    const first = await manager.initMcpConnectors(servers, '/project', '/project/task', false, ['test-server'], (name) => failures.push(name));

    expect(first).toEqual([]);
    expect(failures).toEqual(['test-server']);
    expect(connect).toHaveBeenCalledTimes(1);

    // The rejected promise must not stay pooled: a dead entry would never be
    // retried and the server's tools would stay missing for the whole session.
    const second = await manager.initMcpConnectors(servers, '/project', '/project/task', false, ['test-server'], (name) => failures.push(name));

    expect(connect).toHaveBeenCalledTimes(2);
    expect(second).toEqual([connector]);
    expect(failures).toEqual(['test-server']);
  });

  it('gives up on a connector that never answers instead of waiting for the client timeout', async () => {
    const manager = await loadManager('50');
    const connect = vi.spyOn(manager, 'initMcpConnector').mockImplementation(() => new Promise(() => undefined));
    const failures: string[] = [];

    const startedAt = Date.now();
    const connectors = await manager.initMcpConnectors(servers, '/project', '/project/task', false, ['test-server'], (name) => failures.push(name));
    const elapsed = Date.now() - startedAt;

    expect(connectors).toEqual([]);
    expect(failures).toEqual(['test-server']);
    expect(elapsed).toBeLessThan(2_000);

    // Evicted on timeout as well, so a hung attempt is retried, not remembered.
    await manager.initMcpConnectors(servers, '/project', '/project/task', false, ['test-server'], () => undefined);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('tells the user which servers are missing from the run', async () => {
    const manager = await loadManager('0');
    vi.spyOn(manager, 'initMcpConnector').mockRejectedValue(new Error('connect ECONNREFUSED'));
    const task = createTask();

    const toolSet = await manager.createToolset(task, createProfile(), 'openai', servers, { handleToolApproval: vi.fn() });

    expect(toolSet).toEqual({});
    expect(task.addLogMessage).toHaveBeenCalledWith('error', expect.stringContaining('test-server'), false, undefined);
  });
});
