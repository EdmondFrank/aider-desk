import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DefaultTaskState, TaskData } from '@common/types';

import { TaskMenuButton } from '../TaskMenuButton';

vi.mock('@/contexts/ExtensionsContext', () => ({
  useTaskStates: () => [{ id: DefaultTaskState.Todo, name: 'Todo', color: '#ffffff', priority: 10 }],
}));

const task: TaskData = {
  id: 'task-1',
  baseDir: '/project',
  name: 'Task',
  createdAt: '2026-01-01T00:00:00Z',
  state: DefaultTaskState.Todo,
  aiderTotalCost: 0,
  agentTotalCost: 0,
  mainModel: '',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TaskMenuButton positioning', () => {
  it.each(['scroll', 'resize'])('keeps the menu and submenu anchored on %s', (event) => {
    const { container } = render(
      <div data-testid="sidebar">
        <TaskMenuButton task={task} onEdit={vi.fn()} />
      </div>,
    );
    const button = screen.getByRole('button');
    const anchor = button.parentElement!;
    const anchorRect = vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 300, 28, 28));

    fireEvent.click(button);
    const menu = screen.getByText('taskSidebar.rename').closest('ul')!.parentElement!;
    expect(container).not.toContainElement(menu);
    expect(menu).toHaveStyle({ top: '332px', left: '58px' });

    const submenuItem = screen.getByText('taskSidebar.changeState').closest('li')!;
    vi.spyOn(submenuItem, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(Number.parseFloat(menu.style.left), Number.parseFloat(menu.style.top) + 30, 170, 24),
    );
    fireEvent.click(submenuItem);
    const submenu = document.body.querySelector('div.w-\\[180px\\]')!;
    expect(submenu).toHaveStyle({ top: '362px', left: '232px' });

    anchorRect.mockReturnValue(new DOMRect(180, 200, 28, 28));
    if (event === 'scroll') {
      fireEvent.scroll(screen.getByTestId('sidebar'), { bubbles: false });
    } else {
      fireEvent.resize(window);
    }

    expect(menu).toHaveStyle({ top: '232px', left: '38px' });
    expect(submenu).toHaveStyle({ top: '262px', left: '212px' });
  });

  it('removes positioning listeners when closed or unmounted', () => {
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<TaskMenuButton task={task} onEdit={vi.fn()} />);
    const button = screen.getByRole('button');

    fireEvent.click(button);
    fireEvent.click(button);
    expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function), true);
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));

    removeListener.mockClear();
    fireEvent.click(button);
    unmount();
    expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function), true);
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});
