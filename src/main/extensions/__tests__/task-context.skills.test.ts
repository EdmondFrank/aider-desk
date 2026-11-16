import { describe, expect, it, vi } from 'vitest';

import { TaskContextImpl } from '../task-context';

import type { TaskContext } from '@common/extensions';
import type { Task } from '@/task';

describe('TaskContextImpl.activateSkill', () => {
  it('delegates activation and returns the persisted skill messages', async () => {
    const messages: Awaited<ReturnType<Task['activateSkill']>> = [
      { id: 'assistant', role: 'assistant', content: [] },
      { id: 'tool', role: 'tool', content: [] },
    ];
    const activateSkill = vi.fn<Task['activateSkill']>().mockResolvedValue(messages);
    const context: TaskContext = new TaskContextImpl({
      activateSkill,
    } as unknown as Task);

    await expect(context.activateSkill('writing-tests')).resolves.toBe(messages);
    expect(activateSkill).toHaveBeenCalledWith('writing-tests');
  });

  it('returns null when the skill is already active', async () => {
    const activateSkill = vi.fn<Task['activateSkill']>().mockResolvedValue(null);
    const context = new TaskContextImpl({ activateSkill } as unknown as Task);

    await expect(context.activateSkill('writing-tests')).resolves.toBeNull();
  });

  it('propagates core validation and content-loading errors', async () => {
    const error = new Error("Skill 'private' cannot be invoked manually");
    const activateSkill = vi.fn<Task['activateSkill']>().mockRejectedValue(error);
    const context = new TaskContextImpl({ activateSkill } as unknown as Task);

    await expect(context.activateSkill('private')).rejects.toBe(error);
  });
});
