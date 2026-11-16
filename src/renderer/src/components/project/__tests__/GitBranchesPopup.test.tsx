import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BranchInfo } from '@common/types';

import { GitBranchesPopup } from '../GitBranchesPopup';

import { useApi } from '@/contexts/ApiContext';
import { createMockApi } from '@/__tests__/mocks/api';

vi.mock('@/contexts/ApiContext', () => ({
  useApi: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const makeBranch = (overrides: Partial<BranchInfo> = {}): BranchInfo => ({
  name: 'feature-x',
  isCurrent: false,
  hasWorktree: false,
  ...overrides,
});

const defaultProps = {
  branches: [makeBranch()],
  currentBranch: 'main',
  loading: false,
  recentBranches: [],
  onSelect: vi.fn(),
  onNewBranchFrom: vi.fn(),
  onMergeIntoCurrent: vi.fn(),
  onRebaseOnto: vi.fn(),
  onDelete: vi.fn(),
};

type PopupProps = typeof defaultProps & {
  worktreeMode?: boolean;
  onRebaseWorktreeOnto?: (branch: BranchInfo) => void;
  onUpdateBranch?: (branch: BranchInfo) => void;
  onRequestClose?: () => void;
};

const openSubmenuFor = (branchName: string) => {
  fireEvent.click(screen.getByText(branchName));
};

const pressKey = (key: string, target?: Node | null) => {
  fireEvent.keyDown(target ?? window, { key });
};

const getSearchInput = () => screen.getByPlaceholderText('git.searchBranches');

describe('GitBranchesPopup', () => {
  const api = createMockApi();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApi).mockReturnValue(api);
  });

  const renderPopup = (props: Partial<PopupProps> = {}) => render(<GitBranchesPopup {...defaultProps} {...props} />);

  it.each([false, true])('copies the full branch name in worktree mode %s', (worktreeMode) => {
    renderPopup({ worktreeMode, branches: [makeBranch({ name: 'origin/feature-x', isRemote: true })] });
    fireEvent.change(getSearchInput(), { target: { value: 'feature-x' } });
    openSubmenuFor('feature-x');

    fireEvent.click(screen.getByText('git.copyBranchName'));

    expect(api.writeToClipboard).toHaveBeenCalledWith('origin/feature-x');
    expect(screen.queryByText('git.copyBranchName')).not.toBeInTheDocument();
  });

  it('keeps cached branches visible without a loading indicator beside search', () => {
    const { rerender } = renderPopup({ loading: true });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('feature-x')).toBeInTheDocument();

    rerender(<GitBranchesPopup {...defaultProps} loading={false} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('feature-x')).toBeInTheDocument();
  });

  it('shows the initial loading state instead of the empty branch message', () => {
    renderPopup({ loading: true, branches: [] });

    expect(screen.getByRole('status')).toHaveTextContent('common.loading');
    expect(screen.queryByText('git.noBranchesFound')).not.toBeInTheDocument();
  });

  describe('submenu positioning', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it.each([
      { viewportWidth: 800, viewportHeight: 600, rowLeft: 100, rowRight: 300, rowTop: 100, menuWidth: 240, menuHeight: 180, left: 302, top: 97 },
      { viewportWidth: 600, viewportHeight: 400, rowLeft: 300, rowRight: 580, rowTop: 350, menuWidth: 240, menuHeight: 180, left: 54, top: 212 },
      { viewportWidth: 320, viewportHeight: 240, rowLeft: 10, rowRight: 310, rowTop: 200, menuWidth: 240, menuHeight: 180, left: 8, top: 52 },
      { viewportWidth: 200, viewportHeight: 120, rowLeft: 0, rowRight: 200, rowTop: 100, menuWidth: 184, menuHeight: 104, left: 8, top: 8 },
    ])(
      'keeps the submenu in a $viewportWidth × $viewportHeight viewport',
      ({ viewportWidth, viewportHeight, rowLeft, rowRight, rowTop, menuWidth, menuHeight, left, top }) => {
        vi.stubGlobal('innerWidth', viewportWidth);
        vi.stubGlobal('innerHeight', viewportHeight);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
          return this.classList.contains('fixed') ? new DOMRect(0, 0, menuWidth, menuHeight) : new DOMRect(rowLeft, rowTop, rowRight - rowLeft, 22);
        });

        renderPopup();
        openSubmenuFor('feature-x');

        const menu = screen.getByText('git.checkoutBranch').closest('button')?.parentElement;
        expect(menu).toHaveStyle({ left: `${left}px`, top: `${top}px` });
        expect(menu).toHaveClass('overflow-y-auto', 'max-w-[calc(100vw-16px)]', 'max-h-[calc(100dvh-16px)]');

        vi.stubGlobal('innerHeight', viewportHeight + 200);
        fireEvent(window, new Event('resize'));
        expect(menu).toHaveStyle({ top: `${Math.max(8, Math.min(rowTop - 3, viewportHeight + 200 - menuHeight - 8))}px` });
      },
    );
  });

  describe('local mode', () => {
    it('shows checkout actions in the branch submenu', () => {
      renderPopup();
      openSubmenuFor('feature-x');

      expect(screen.getByText('git.checkoutBranch')).toBeInTheDocument();
      expect(screen.getByText('git.newBranchFrom').closest('button')).toBeInTheDocument();
      expect(screen.getByText('git.rebaseOnto')).toBeInTheDocument();
      expect(screen.getByText('git.mergeBranchInto')).toBeInTheDocument();
    });

    it('calls onSelect when checkout is clicked', () => {
      const onSelect = vi.fn();
      renderPopup({ onSelect });
      openSubmenuFor('feature-x');

      fireEvent.click(screen.getByText('git.checkoutBranch'));

      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'feature-x' }));
    });
  });

  describe('worktree mode', () => {
    it('replaces checkout with worktree rebase in the branch submenu', () => {
      renderPopup({ worktreeMode: true, onRebaseWorktreeOnto: vi.fn() });
      openSubmenuFor('feature-x');

      expect(screen.getByText('git.rebaseWorktreeOnto')).toBeInTheDocument();
      expect(screen.queryByText('git.checkoutBranch')).not.toBeInTheDocument();
      expect(screen.queryByText('git.newBranchFrom')).not.toBeInTheDocument();
      expect(screen.queryByText('git.rebaseOnto')).not.toBeInTheDocument();
    });

    it('removes merge into current and keeps delete action in worktree mode', () => {
      renderPopup({ worktreeMode: true, onRebaseWorktreeOnto: vi.fn() });
      openSubmenuFor('feature-x');

      expect(screen.queryByText('git.mergeBranchInto')).not.toBeInTheDocument();
      expect(screen.getByText('git.deleteBranchName')).toBeInTheDocument();
    });

    it('shows update from remote when branch has upstream', () => {
      const onUpdateBranch = vi.fn();
      renderPopup({
        worktreeMode: true,
        onRebaseWorktreeOnto: vi.fn(),
        onUpdateBranch,
        branches: [makeBranch({ upstream: 'origin/feature-x' })],
      });
      openSubmenuFor('feature-x');

      expect(screen.getByText('git.updateFromRemote').closest('button')).toBeInTheDocument();

      fireEvent.click(screen.getByText('git.updateFromRemote').closest('button')!);
      expect(onUpdateBranch).toHaveBeenCalledWith(expect.objectContaining({ name: 'feature-x' }));
    });

    it('calls onRebaseWorktreeOnto with the branch when clicked', () => {
      const onRebaseWorktreeOnto = vi.fn();
      renderPopup({ worktreeMode: true, onRebaseWorktreeOnto });
      openSubmenuFor('feature-x');

      fireEvent.click(screen.getByText('git.rebaseWorktreeOnto'));

      expect(onRebaseWorktreeOnto).toHaveBeenCalledWith(expect.objectContaining({ name: 'feature-x' }));
    });

    it('disables the rebase action for the current branch', () => {
      renderPopup({
        worktreeMode: true,
        onRebaseWorktreeOnto: vi.fn(),
        branches: [makeBranch({ isCurrent: true })],
        currentBranch: 'feature-x',
      });
      openSubmenuFor('feature-x');

      expect(screen.getByText('git.rebaseWorktreeOnto').closest('button')).toBeDisabled();
    });

    it('hides delete for branches checked out in another worktree', () => {
      renderPopup({
        worktreeMode: true,
        onRebaseWorktreeOnto: vi.fn(),
        branches: [makeBranch({ hasWorktree: true })],
      });
      openSubmenuFor('feature-x');

      expect(screen.queryByText('git.deleteBranchName')).not.toBeInTheDocument();
    });
  });

  describe('keyboard navigation', () => {
    it('filters branches from the search field and opens the submenu with Enter', () => {
      renderPopup({ branches: [makeBranch({ name: 'feature-x' }), makeBranch({ name: 'main' })] });

      const input = getSearchInput();
      fireEvent.change(input, { target: { value: 'main' } });

      pressKey('ArrowDown', input);
      pressKey('Enter', input);

      expect(screen.getByText('git.checkoutBranch')).toBeInTheDocument();
    });

    it('clears the highlight when the filter changes', () => {
      renderPopup({ branches: [makeBranch({ name: 'feature-a' }), makeBranch({ name: 'feature-b' })] });

      const input = getSearchInput();
      pressKey('ArrowDown', input);
      expect(screen.getByText('feature-a').closest('div[class*="cursor-pointer"]')).toHaveClass('bg-bg-tertiary');

      fireEvent.change(input, { value: 'a', target: { value: 'a' } });
      expect(screen.getByText('feature-a').closest('div[class*="cursor-pointer"]')).not.toHaveClass('bg-bg-tertiary');
    });

    it('navigates the submenu with arrows and invokes the action with Enter', () => {
      const onSelect = vi.fn();
      renderPopup({ onSelect, branches: [makeBranch({ name: 'main' }), makeBranch({ name: 'feat' })] });

      const input = getSearchInput();
      fireEvent.change(input, { target: { value: 'feat' } });
      pressKey('ArrowDown', input);
      pressKey('Enter', input);
      expect(screen.getByText('git.checkoutBranch').closest('button')).toHaveClass('bg-bg-tertiary');
      pressKey('ArrowDown');
      expect(screen.getByText('git.newBranchFrom').closest('button')).toHaveClass('bg-bg-tertiary');

      pressKey('ArrowUp');
      expect(screen.getByText('git.checkoutBranch').closest('button')).toHaveClass('bg-bg-tertiary');

      pressKey('Enter');

      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'feat' }));
      expect(screen.queryByText('git.newBranchFrom')).not.toBeInTheDocument();
    });

    it('skips disabled submenu items when navigating', () => {
      renderPopup({
        branches: [makeBranch({ name: 'feature-x', upstream: 'origin/feature-x' })],
        currentBranch: 'feature-x',
        onUpdateBranch: vi.fn(),
      });

      const input = getSearchInput();
      pressKey('ArrowDown', input);
      pressKey('Enter', input);

      // checkout is disabled (current branch), so the highlight starts on the first enabled item
      expect(screen.getByText('git.newBranchFrom').closest('button')).toHaveClass('bg-bg-tertiary');
      pressKey('ArrowDown');
      expect(screen.getByText('git.updateFromRemote').closest('button')).toHaveClass('bg-bg-tertiary');
    });

    it('closes the submenu with Escape and the dropdown with another Escape', () => {
      const onRequestClose = vi.fn();
      renderPopup({ onRequestClose, branches: [makeBranch({ name: 'main' })] });

      const input = getSearchInput();
      pressKey('ArrowDown', input);
      pressKey('Enter', input);
      expect(screen.getByText('git.checkoutBranch')).toBeInTheDocument();

      pressKey('Escape');
      expect(screen.queryByText('git.checkoutBranch')).not.toBeInTheDocument();

      pressKey('Escape');
      expect(onRequestClose).toHaveBeenCalledTimes(1);
    });

    it('moves the highlight with arrow keys and back', () => {
      renderPopup({ branches: [makeBranch({ name: 'feature-a' }), makeBranch({ name: 'feature-b' })] });

      const input = getSearchInput();
      pressKey('ArrowDown', input);
      expect(screen.getByText('feature-a').closest('div[class*="cursor-pointer"]')).toHaveClass('bg-bg-tertiary');

      pressKey('ArrowDown');
      expect(screen.getByText('feature-b').closest('div[class*="cursor-pointer"]')).toHaveClass('bg-bg-tertiary');
      expect(screen.getByText('feature-a').closest('div[class*="cursor-pointer"]')).not.toHaveClass('bg-bg-tertiary');

      pressKey('ArrowUp');
      expect(screen.getByText('feature-a').closest('div[class*="cursor-pointer"]')).toHaveClass('bg-bg-tertiary');
    });
  });
});
