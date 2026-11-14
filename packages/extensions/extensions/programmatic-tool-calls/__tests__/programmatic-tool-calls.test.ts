import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { ExtensionContext, Tool, ToolsetCreatedEvent, ToolsetToolEntry } from '../../../extensions.d.ts';

type SandboxScope = {
  tools: Record<string, (input: Record<string, unknown>) => Promise<unknown>>;
  describeTool: (path: string) => string | { error: string };
  searchTools: (request?: { query?: string }) => { results: string[]; total: number };
  [name: string]: unknown;
};

const { runSandbox } = vi.hoisted(() => ({ runSandbox: vi.fn<(scope: SandboxScope) => unknown>() }));

vi.mock('@nyariv/sandboxjs', () => ({
  default: class Sandbox {
    compileAsync() {
      return (scope: SandboxScope) => ({ run: () => runSandbox(scope) });
    }
  },
}));

const { default: ProgrammaticToolCallsExtension, scoreToolRecords } = await import('../index');

const PTC_TOOL_NAME = 'programmatic_tool_calls';

const createEvent = (mode: string, tools: Record<string, ToolsetToolEntry>): ToolsetToolRecordlessEvent =>
  ({
    mode,
    agentProfile: { name: 'test-profile' },
    providerProfile: { name: 'test-provider' },
    model: 'test-model',
    tools,
  }) as unknown as ToolsetCreatedEvent;
type ToolsetToolRecordlessEvent = ToolsetCreatedEvent;

describe('ProgrammaticToolCallsExtension', () => {
  const extension = new ProgrammaticToolCallsExtension();

  describe('getModes', () => {
    it('provides the ptc mode', () => {
      const modes = extension.getModes!({} as never);

      expect(modes).toHaveLength(1);
      expect(modes[0].name).toBe('ptc');
      expect(modes[0].label).toBe('PTC');
    });
  });

  describe('onToolsetCreated', () => {
    it('keeps only the ptc tool and appends the signature catalog to its description in ptc mode', async () => {
      const event = createEvent('ptc', {
        'power---file-read': {
          description: 'Reads a file',
          inputSchema: z.object({ filePath: z.string().describe('The path to the file') }),
        },
        'mcp__server__tool': { description: 'MCP tool' },
        [PTC_TOOL_NAME]: { description: 'Executes code in a sandbox', inputSchema: z.object({ code: z.string() }) },
      });

      const result = await extension.onToolsetCreated!(event, {} as never);
      const ptcTool = result!.tools![PTC_TOOL_NAME]!;

      expect(Object.keys(result!.tools!)).toEqual([PTC_TOOL_NAME]);
      expect(ptcTool.description).toContain('## Available tools');
      expect(ptcTool.description).toContain('2 tools');
      expect(ptcTool.description).toContain('power_file_read');
      expect(ptcTool.description).toContain('/** The path to the file */');
      expect(ptcTool.description).toContain('filePath: string');
      expect(ptcTool.description).toContain('mcp__server__tool');
      expect(ptcTool.description).toContain('COMPLETE list');
    });

    it('truncates long tool descriptions in signatures and marks the catalog partial when the budget is exceeded', async () => {
      const longDescription = 'y'.repeat(300);
      const tools: Record<string, ToolsetToolEntry> = {
        [PTC_TOOL_NAME]: { description: 'Executes code in a sandbox' },
      };
      for (let i = 0; i < 300; i++) {
        tools[`tool-${i}`] = {
          description: longDescription,
          inputSchema: z.object({ field: z.number().describe('a'.repeat(120)) }),
        };
      }
      const event = createEvent('ptc', tools);

      const result = await extension.onToolsetCreated!(event, {} as never);
      const ptcTool = result!.tools![PTC_TOOL_NAME]!;

      expect(ptcTool.description).not.toContain(longDescription);
      expect(ptcTool.description).toMatch(/SIGNATURES PARTIAL/);
      expect(ptcTool.description).toContain('searchTools');
    });

    it('returns no modifications in non-ptc modes', async () => {
      const event = createEvent('agent', {
        'power---file-read': { description: 'Reads a file' },
        [PTC_TOOL_NAME]: { description: 'Executes code in a sandbox' },
      });

      const result = await extension.onToolsetCreated!(event, {} as never);

      expect(result).toBeUndefined();
    });

    it('returns no modifications when the ptc tool is not in the toolset', async () => {
      const event = createEvent('ptc', {
        'power---file-read': { description: 'Reads a file' },
      });

      const result = await extension.onToolsetCreated!(event, {} as never);

      expect(result).toBeUndefined();
    });
  });

  describe('tool name resolution', () => {
    beforeEach(() => {
      runSandbox.mockReset();
    });

    const execute = async (tools: Record<string, Tool>) => {
      const context = {
        log: vi.fn(),
        truncateToolResult: vi.fn(async (text: string) => text),
      } as unknown as ExtensionContext;
      const tool = extension.getTools()[0];
      const result = await tool.execute({ code: '', timeout: 1 }, undefined, context, tools);
      expect(result).not.toHaveProperty('isError', true);
      return result;
    };

    it.each(['tasks_create_task', 'tasks__create_task', 'tasks___create_task', 'tasks---create_task'])(
      'resolves %s under tools and in describeTool',
      async (name) => {
        const createTask = vi.fn().mockResolvedValue({ id: 'created' });
        runSandbox.mockImplementation(async (scope) => {
          expect(scope.describeTool(name)).toContain('tools.tasks_create_task(');
          expect(scope.describeTool(`tools.${name}`)).toContain('tools.tasks_create_task(');
          expect(scope.describeTool(`tools['${name}']`)).toContain('tools.tasks_create_task(');
          expect(scope.describeTool(`tools["${name}"]`)).toContain('tools.tasks_create_task(');
          expect(scope.searchTools().total).toBe(1);
          return scope.tools[name]({ name: 'test' });
        });

        const result = await execute({ 'tasks---create_task': { execute: createTask } as unknown as Tool });

        expect(createTask).toHaveBeenCalledExactlyOnceWith({ name: 'test' });
        expect(result).not.toHaveProperty('isError', true);
      },
    );

    it.each(['tasks_create_task', 'tasks__create_task', 'tasks___create_task'])('exposes standalone %s', async (name) => {
      const createTask = vi.fn().mockResolvedValue('created');
      runSandbox.mockImplementation(async (scope) => {
        expect(scope[name]).toBe(scope.tools[name]);
        const call = scope[name] as SandboxScope['tools'][string];
        return call({ name: 'test' });
      });

      await execute({ 'tasks---create_task': { execute: createTask } as unknown as Tool });

      expect(createTask).toHaveBeenCalledExactlyOnceWith({ name: 'test' });
    });

    it('wires collision-suffixed canonical names without overwriting other tools', async () => {
      const first = vi.fn().mockResolvedValue('first');
      const second = vi.fn().mockResolvedValue('second');
      runSandbox.mockImplementation(async (scope) => {
        expect(scope.describeTool('tasks_create_task_2')).toContain('tools.tasks_create_task_2(');
        return Promise.all([scope.tools.tasks_create_task({}), scope.tools.tasks_create_task_2({})]);
      });

      await execute({
        'tasks---create_task': { execute: first } as unknown as Tool,
        'tasks-create_task': { execute: second } as unknown as Tool,
      });

      expect(first).toHaveBeenCalledOnce();
      expect(second).toHaveBeenCalledOnce();
    });

    it('gives canonical names precedence over aliases', async () => {
      const first = vi.fn();
      const canonical = vi.fn();
      runSandbox.mockImplementation(async (scope) => {
        expect(scope.describeTool('tasks___create_task')).toContain('tools.tasks___create_task(');
        return scope.tools.tasks___create_task({});
      });

      await execute({
        'tasks---create_task': { execute: first } as unknown as Tool,
        'tasks___create_task': { execute: canonical } as unknown as Tool,
      });

      expect(first).not.toHaveBeenCalled();
      expect(canonical).toHaveBeenCalledOnce();
    });

    it('does not expose ambiguous aliases or resolve unknown names', async () => {
      runSandbox.mockImplementation((scope) => {
        expect(scope.tools.tasks___create_task).toBeUndefined();
        expect(scope.describeTool('tasks___create_task')).toHaveProperty('error', expect.stringContaining('UnknownTool'));
        expect(scope.describeTool('missing_tool')).toHaveProperty('error', expect.stringContaining('UnknownTool'));
      });

      await execute({
        'tasks---create-task': { execute: vi.fn() } as unknown as Tool,
        'tasks---create_task': { execute: vi.fn() } as unknown as Tool,
      });
    });

    it('does not overwrite discovery helpers with standalone tool names', async () => {
      const tool = vi.fn();
      runSandbox.mockImplementation((scope) => {
        expect(scope.searchTools().total).toBe(2);
        expect(scope.describeTool('describeTool')).toContain('tools.describeTool(');
      });

      await execute({
        searchTools: { execute: tool } as unknown as Tool,
        describeTool: { execute: tool } as unknown as Tool,
      });

      expect(tool).not.toHaveBeenCalled();
    });
  });

  describe('scoreToolRecords', () => {
    const records = [
      { rawName: 'power-file-read', path: 'tools.power_file_read', pathRender: 'tools.power_file_read', description: 'Reads and returns the content of a specified file.', schema: { type: 'object', properties: { filePath: { type: 'string', description: 'path to the file' } }, required: ['filePath'] } },
      { rawName: 'power-glob', path: 'tools.power_glob', pathRender: 'tools.power_glob', description: 'Finds files matching a glob pattern.', schema: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } },
      { rawName: 'other-tool', path: 'tools.other_tool', pathRender: 'tools.other_tool', description: 'Unrelated tool.', schema: undefined },
    ];

    it('scores path segment matches above description matches', () => {
      const { matches } = scoreToolRecords(records, 'file read');
      expect(matches[0].record.path).toBe('tools.power_file_read');
    });

    it('matches plural query terms via singular variants', () => {
      const globRecords = [{ rawName: 'issues-list', path: 'tools.issues_list', pathRender: 'tools.issues_list', description: 'Lists an issue.', schema: undefined }];
      const { matches } = scoreToolRecords(globRecords, 'issues');
      expect(matches).toHaveLength(1);
    });

    it('matches by schema property names', () => {
      const { matches } = scoreToolRecords(records, 'filepath');
      expect(matches[0].record.path).toBe('tools.power_file_read');
    });

    it('browses all tools alphabetically with an empty query', () => {
      const { matches, total } = scoreToolRecords(records, '');
      expect(total).toBe(3);
      expect(matches.map((m) => m.record.path)).toEqual(['tools.other_tool', 'tools.power_file_read', 'tools.power_glob']);
    });

    it('filters by namespace and paginates with limit and offset', () => {
      const nsRecords = [
        { rawName: 'a-x', path: 'tools.a.x', pathRender: "tools['a.x']", description: '', schema: undefined },
        { rawName: 'b-y', path: 'tools.b.y', pathRender: "tools['b.y']", description: '', schema: undefined },
      ];
      const { matches, total } = scoreToolRecords(nsRecords, '', 'a', 10, 0);
      expect(total).toBe(1);
      expect(matches[0].record.path).toBe('tools.a.x');
    });
  });
});
