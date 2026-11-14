import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataManager } from '../data-manager';

vi.mock('@/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/constants', () => ({
  DB_FILE_PATH: ':memory:',
  DIAGNOSTICS_MODE: false,
  DB_JOURNAL_MODE: 'WAL',
  DB_SYNCHRONOUS: 'NORMAL',
}));

describe('Agent journal cleanup', () => {
  let manager: DataManager;

  beforeEach(() => {
    manager = new DataManager();
    manager.init();
  });

  afterEach(() => {
    manager.close();
  });

  it('deletes all executions for missing tasks without affecting existing tasks or other projects', () => {
    manager.saveAgentExecution('/project', 'deleted', 'root', 'root checkpoint');
    manager.saveAgentExecution('/project', 'deleted', 'child', 'child checkpoint');
    manager.saveAgentExecution('/project', 'active', 'root', 'active checkpoint');
    manager.saveAgentExecution('/project', 'archived', 'root', 'archived checkpoint');
    manager.saveAgentExecution('/other', 'deleted', 'root', 'other project checkpoint');

    expect(manager.cleanupAgentExecutions('/project', ['active', 'archived'])).toBe(2);
    expect(manager.getAgentExecutions('/project', 'deleted')).toEqual([]);
    expect(manager.getAgentExecutions('/project', 'active')).toEqual(['active checkpoint']);
    expect(manager.getAgentExecutions('/project', 'archived')).toEqual(['archived checkpoint']);
    expect(manager.getAgentExecutions('/other', 'deleted')).toEqual(['other project checkpoint']);
    expect(manager.cleanupAgentExecutions('/project', ['active', 'archived'])).toBe(0);
  });

  it('deletes root and child journals for existing tasks excluded from recovery', () => {
    manager.saveAgentExecution('/project', 'interrupted', 'root', 'interrupted root');
    manager.saveAgentExecution('/project', 'interrupted', 'child', 'interrupted child');
    manager.saveAgentExecution('/project', 'archived-interrupted', 'root', 'archived interrupted root');
    manager.saveAgentExecution('/project', 'archived-running', 'root', 'archived running root');

    expect(manager.cleanupAgentExecutions('/project', ['archived-running'])).toBe(3);
    expect(manager.getAgentExecutions('/project', 'interrupted')).toEqual([]);
    expect(manager.getAgentExecutions('/project', 'archived-interrupted')).toEqual([]);
    expect(manager.getAgentExecutions('/project', 'archived-running')).toEqual(['archived running root']);
  });

  it('cleans a project with no remaining tasks', () => {
    manager.saveAgentExecution('/project', 'deleted', 'root', '{}');
    expect(manager.cleanupAgentExecutions('/project', [])).toBe(1);
    expect(manager.getAgentExecutions('/project', 'deleted')).toEqual([]);
  });

  it('handles large task lists without SQL parameter limits', () => {
    const taskIds = Array.from({ length: 40000 }, (_, index) => `task-${index}`);
    manager.saveAgentExecution('/project', 'task-39999', 'root', '{}');
    manager.saveAgentExecution('/project', 'deleted', 'root', '{}');
    expect(manager.cleanupAgentExecutions('/project', taskIds)).toBe(1);
    expect(manager.getAgentExecutions('/project', 'task-39999')).toEqual(['{}']);
  });
});
