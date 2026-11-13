import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdatedFilesDiffModal, type DiffModalGroup } from '../UpdatedFilesDiffModal';

import type { UpdatedFile } from '@common/types';

import { render } from '@/__tests__/render';

const viewport = vi.hoisted(() => ({ isMobile: false, isTablet: false, isDesktop: true }));

vi.mock('@/hooks/useResponsive', () => ({ useResponsive: () => viewport }));

vi.mock('@/contexts/ApiContext', () => ({
  useApi: () => ({ openUrlInWindow: vi.fn() }) as unknown as Record<string, never>,
}));

vi.mock('@/hooks/useUpdatedFileDiff', () => ({
  useUpdatedFileDiff: () => ({ diff: '', loading: false, isLarge: false, load: vi.fn() }),
}));

vi.mock('@/hooks/useUpdatedFileContents', () => ({
  useUpdatedFileContents: () => ({ contents: null, loading: false, load: vi.fn() }),
}));

const mkFile = (path: string): UpdatedFile => ({ path, additions: 1, deletions: 0 }) as UpdatedFile;

const files: UpdatedFile[] = [mkFile('src/a.ts'), mkFile('lib/c.ts')];
const groups: DiffModalGroup[] = [{ id: null, files }];

const openModal = () => render(<UpdatedFilesDiffModal groups={groups} initialFile={files[0]} onClose={vi.fn()} baseDir="/base" taskId="task-1" />);

// The drawer leaves with an exit animation, so disappearance has to be awaited.
const expectNoFileList = () => vi.waitFor(() => expect(screen.queryByTestId('diff-files-sidebar')).not.toBeInTheDocument());

describe('UpdatedFilesDiffModal file list layout', () => {
  beforeEach(() => {
    window.localStorage.clear();
    viewport.isMobile = false;
  });

  it('docks the file list on desktop and collapses it from the header', async () => {
    openModal();

    expect(await screen.findByTestId('diff-files-sidebar')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('toggle-file-list'));
    await expectNoFileList();

    fireEvent.click(screen.getByTestId('toggle-file-list'));
    expect(screen.getByTestId('diff-files-sidebar')).toBeInTheDocument();
  });

  it('opens the file list as a drawer on mobile so the diff keeps the width', async () => {
    viewport.isMobile = true;
    openModal();

    // Closed by default: the diff pane owns the full width.
    expect(await screen.findByTestId('toggle-file-list')).toBeInTheDocument();
    expect(screen.queryByTestId('diff-files-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('file-list-backdrop')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('toggle-file-list'));
    expect(screen.getByTestId('diff-files-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('file-list-backdrop')).toBeInTheDocument();

    // Tapping the backdrop dismisses the drawer.
    fireEvent.click(screen.getByTestId('file-list-backdrop'));
    await expectNoFileList();
  });

  it('closes the mobile drawer after picking a file', async () => {
    viewport.isMobile = true;
    openModal();

    fireEvent.click(await screen.findByTestId('toggle-file-list'));
    fireEvent.click(screen.getByText('a.ts'));

    await expectNoFileList();
  });

  it('hides the file list toggle when there is only one file', async () => {
    render(<UpdatedFilesDiffModal groups={[{ id: null, files: [files[0]] }]} initialFile={files[0]} onClose={vi.fn()} baseDir="/base" taskId="task-1" />);

    expect(await screen.findByTestId('close-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('toggle-file-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('diff-files-sidebar')).not.toBeInTheDocument();
  });
});
