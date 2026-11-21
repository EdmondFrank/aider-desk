import { fireEvent, screen } from '@testing-library/react';
import { TaskData } from '@common/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompactMenuButton } from '../CompactMenuButton';

import { render } from '@/__tests__/render';
import { createMockApi } from '@/__tests__/mocks/api';
import { useApi } from '@/contexts/ApiContext';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/contexts/ApiContext', () => ({
  useApi: vi.fn(),
}));

const mockTask = { id: 'task-1', baseDir: '/project' } as unknown as TaskData;

describe('CompactMenuButton', () => {
  const mockApi = createMockApi();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApi).mockReturnValue(mockApi);
  });

  it('opens the menu with compact options on click', () => {
    render(<CompactMenuButton task={mockTask} mode="agent" />);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('costInfo.compact')).toBeInTheDocument();
    expect(screen.getByText('costInfo.smartCompact')).toBeInTheDocument();
  });

  it('triggers LLM compaction via the Compact option', () => {
    render(<CompactMenuButton task={mockTask} mode="agent" />);

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('costInfo.compact'));

    expect(mockApi.compactConversation).toHaveBeenCalledWith('/project', 'task-1', 'agent');
    expect(screen.queryByText('costInfo.compact')).not.toBeInTheDocument();
  });

  it('triggers smart compaction via the Smart compact option', () => {
    render(<CompactMenuButton task={mockTask} mode="agent" />);

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('costInfo.smartCompact'));

    expect(mockApi.smartCompactConversation).toHaveBeenCalledWith('/project', 'task-1');
    expect(screen.queryByText('costInfo.compact')).not.toBeInTheDocument();
  });
});
