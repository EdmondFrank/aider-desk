import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { type ChangeEvent, type KeyboardEvent } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AvailableExtension, InstalledExtension, SettingsData } from '@common/types';
import { AIDER_DESK_EXTENSIONS_REPO_URL } from '@common/extensions';

import { ExtensionsSettings } from '../ExtensionsSettings';

import { useApi } from '@/contexts/ApiContext';
import { createMockApi } from '@/__tests__/mocks/api';
import { showErrorNotification } from '@/utils/notifications';

const createMockAvailableExtension = (overrides: Partial<AvailableExtension> = {}): AvailableExtension => ({
  id: 'test-extension',
  name: 'Test Extension',
  version: '1.0.0',
  description: 'A test extension',
  author: 'Test Author',
  type: 'single',
  repositoryUrl: AIDER_DESK_EXTENSIONS_REPO_URL,
  hasDependencies: false,
  capabilities: ['tools'],
  ...overrides,
});

const createMockLoadedExtension = (overrides: Partial<InstalledExtension> = {}): InstalledExtension => ({
  id: 'test-extension',
  metadata: {
    name: 'Test Extension',
    version: '1.0.0',
    description: 'A test extension',
    author: 'Test Author',
    capabilities: ['tools'],
  },
  filePath: '/mock/path/to/extension.js',
  initialized: true,
  ...overrides,
});

interface ButtonProps {
  children?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  [key: string]: unknown;
}

interface IconButtonProps {
  icon?: React.ReactNode;
  onClick?: () => void;
  tooltip?: string;
}

interface InputProps {
  value?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  wrapperClassName?: string;
}

interface ToggleProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

// t returns the key (with name interpolation) to make assertions deterministic.
const mockT = (key: string, params?: Record<string, unknown>) => {
  if (params?.name) {
    return `${key}.${params.name}`;
  }
  return key;
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
    i18n: { changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/utils/notifications', () => ({
  showSuccessNotification: vi.fn(),
  showErrorNotification: vi.fn(),
}));

vi.mock('@/contexts/ApiContext', () => ({
  useApi: vi.fn(),
}));

vi.mock('@/components/common/Button', () => ({
  Button: ({ children, onClick, disabled, ...props }: ButtonProps) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/common/IconButton', () => ({
  IconButton: ({ icon, onClick, tooltip }: IconButtonProps) => (
    <button onClick={onClick} title={tooltip} data-testid="icon-button">
      {icon}
    </button>
  ),
}));

vi.mock('@/components/common/Input', () => ({
  Input: ({ value, onChange, placeholder, onKeyDown, wrapperClassName }: InputProps) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      onKeyDown={onKeyDown}
      className={wrapperClassName}
      data-testid={placeholder?.includes('search') ? 'search-input' : 'repository-url-input'}
    />
  ),
}));

vi.mock('@/components/common/Toggle', () => ({
  Toggle: ({ checked, onChange, disabled, 'aria-label': ariaLabel }: ToggleProps) => (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onChange && onChange(!checked)}
        disabled={disabled}
        aria-label={ariaLabel}
        data-testid="toggle"
      />
    </label>
  ),
}));

const switchToAvailableTab = () => {
  fireEvent.click(screen.getByText('settings.extensions.tabs.available'));
};

const findIconButtonByTitle = (title: string): HTMLElement | undefined =>
  screen.queryAllByTestId('icon-button').find((btn) => btn.getAttribute('title') === title);

describe('ExtensionsSettings', () => {
  let mockApi: ReturnType<typeof createMockApi>;
  let mockSettings: SettingsData;
  let mockSetSettings: (settings: SettingsData) => void;

  beforeEach(() => {
    vi.clearAllMocks();

    mockApi = createMockApi();
    mockSettings = {
      extensions: {
        customRepositories: [],
        disabled: [],
      },
    } as unknown as SettingsData;
    mockSetSettings = vi.fn();

    vi.mocked(useApi).mockReturnValue(mockApi);
  });

  describe('Extension Install/Uninstall Operations', () => {
    it('should successfully install an extension', async () => {
      const extension = createMockAvailableExtension();

      mockApi.getInstalledExtensions.mockResolvedValue([]);
      mockApi.getAvailableExtensions.mockResolvedValue([extension]);
      mockApi.installExtension.mockResolvedValue({ success: true });

      render(<ExtensionsSettings settings={mockSettings} setSettings={mockSetSettings} />);

      switchToAvailableTab();

      const installButton = await screen.findByText('settings.extensions.install');
      fireEvent.click(installButton);

      await waitFor(() => {
        expect(mockApi.installExtension).toHaveBeenCalledWith(extension.id, extension.repositoryUrl, undefined);
      });
    });

    it('should handle install failure gracefully', async () => {
      const extension = createMockAvailableExtension();

      mockApi.getInstalledExtensions.mockResolvedValue([]);
      mockApi.getAvailableExtensions.mockResolvedValue([extension]);
      mockApi.installExtension.mockResolvedValue({ success: false });

      render(<ExtensionsSettings settings={mockSettings} setSettings={mockSetSettings} />);

      switchToAvailableTab();

      const installButton = await screen.findByText('settings.extensions.install');
      fireEvent.click(installButton);

      await waitFor(() => {
        expect(mockApi.installExtension).toHaveBeenCalled();
      });

      // Should not reload installed extensions on failure
      expect(mockApi.getInstalledExtensions).toHaveBeenCalledTimes(1);
    });

    it('should show npm-not-found error when npm is not installed', async () => {
      const extension = createMockAvailableExtension();

      mockApi.getInstalledExtensions.mockResolvedValue([]);
      mockApi.getAvailableExtensions.mockResolvedValue([extension]);
      mockApi.installExtension.mockResolvedValue({ success: false, error: 'npm-not-found' });

      render(<ExtensionsSettings settings={mockSettings} setSettings={mockSetSettings} />);

      switchToAvailableTab();

      const installButton = await screen.findByText('settings.extensions.install');
      fireEvent.click(installButton);

      await waitFor(() => {
        expect(mockApi.installExtension).toHaveBeenCalled();
      });

      expect(showErrorNotification).toHaveBeenCalledWith('settings.extensions.errors.npmNotFound', false);
    });

    it('should successfully uninstall an extension from the installed list', async () => {
      const extension = createMockLoadedExtension();

      mockApi.getInstalledExtensions.mockResolvedValueOnce([extension]).mockResolvedValueOnce([]);
      mockApi.getAvailableExtensions.mockResolvedValue([]);
      mockApi.uninstallExtension.mockResolvedValue(true);

      render(<ExtensionsSettings settings={mockSettings} setSettings={mockSetSettings} />);

      await waitFor(() => {
        expect(screen.getByText('Test Extension')).toBeInTheDocument();
      });

      const uninstallButton = findIconButtonByTitle('settings.extensions.uninstall');
      expect(uninstallButton).toBeTruthy();
      fireEvent.click(uninstallButton!);

      await waitFor(() => {
        expect(mockApi.uninstallExtension).toHaveBeenCalledWith(extension.filePath, undefined);
      });
    });

    it('should handle uninstall failure gracefully', async () => {
      const extension = createMockLoadedExtension();

      mockApi.getInstalledExtensions.mockResolvedValue([extension]);
      mockApi.getAvailableExtensions.mockResolvedValue([]);
      mockApi.uninstallExtension.mockResolvedValue(false);

      render(<ExtensionsSettings settings={mockSettings} setSettings={mockSetSettings} />);

      await waitFor(() => {
        expect(screen.getByText('Test Extension')).toBeInTheDocument();
      });

      const uninstallButton = findIconButtonByTitle('settings.extensions.uninstall');
      fireEvent.click(uninstallButton!);

      await waitFor(() => {
        expect(mockApi.uninstallExtension).toHaveBeenCalled();
      });

      // Should not reload (second call) on failure
      expect(mockApi.getInstalledExtensions).toHaveBeenCalledTimes(1);
    });
  });

  describe('Source Filtering', () => {
    it('should render extensions from different sources with a source badge', async () => {
      const officialExt = createMockAvailableExtension({ id: 'official-ext', name: 'Official Ext', repositoryUrl: AIDER_DESK_EXTENSIONS_REPO_URL });
      const customExt = createMockAvailableExtension({ id: 'custom-ext', name: 'Custom Ext', repositoryUrl: 'https://github.com/custom/extensions' });

      mockApi.getInstalledExtensions.mockResolvedValue([]);
      mockApi.getAvailableExtensions.mockResolvedValue([officialExt, customExt]);

      render(<ExtensionsSettings settings={mockSettings} setSettings={mockSetSettings} />);

      switchToAvailableTab();

      await waitFor(() => {
        expect(screen.getByText('Official Ext')).toBeInTheDocument();
        expect(screen.getByText('Custom Ext')).toBeInTheDocument();
      });

      // On the "All" view, both an Official and a Custom source badge are visible.
      expect(screen.getByText('settings.extensions.source.official')).toBeInTheDocument();
      expect(screen.getByText(/settings\.extensions\.source\.custom/)).toBeInTheDocument();
    });
  });

  describe('Repository Management', () => {
    const openManageSources = async () => {
      switchToAvailableTab();
      await waitFor(() => {
        expect(findIconButtonByTitle('settings.extensions.sources.manage')).toBeTruthy();
      });
      fireEvent.click(findIconButtonByTitle('settings.extensions.sources.manage')!);
      await waitFor(() => {
        expect(screen.getByTestId('repository-url-input')).toBeInTheDocument();
      });
    };

    it('should add a new repository from the manage sources dialog', async () => {
      const newRepoUrl = 'https://github.com/new/extensions';

      mockApi.getInstalledExtensions.mockResolvedValue([]);
      mockApi.getAvailableExtensions.mockResolvedValue([]);

      render(<ExtensionsSettings settings={mockSettings} setSettings={mockSetSettings} />);

      await openManageSources();

      const input = screen.getByTestId('repository-url-input');
      fireEvent.change(input, { target: { value: newRepoUrl } });

      fireEvent.click(screen.getByText('settings.extensions.repositories.add'));

      expect(mockSetSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          extensions: expect.objectContaining({
            customRepositories: expect.arrayContaining([newRepoUrl]),
          }),
        }),
      );
    });

    it('should prevent adding duplicate repositories', async () => {
      mockApi.getInstalledExtensions.mockResolvedValue([]);
      mockApi.getAvailableExtensions.mockResolvedValue([]);

      render(<ExtensionsSettings settings={mockSettings} setSettings={mockSetSettings} />);

      await openManageSources();

      const input = screen.getByTestId('repository-url-input');
      fireEvent.change(input, { target: { value: AIDER_DESK_EXTENSIONS_REPO_URL } });

      fireEvent.click(screen.getByText('settings.extensions.repositories.add'));

      expect(mockSetSettings).not.toHaveBeenCalled();
      expect(showErrorNotification).toHaveBeenCalledWith('settings.extensions.errors.repositoryExists');
    });

    it('should remove a custom repository and format its name', async () => {
      const customRepoUrl = 'https://github.com/org-name/repo-name';

      mockSettings = {
        ...mockSettings,
        extensions: {
          customRepositories: [customRepoUrl],
          disabled: [],
        },
      } as unknown as SettingsData;

      mockApi.getInstalledExtensions.mockResolvedValue([]);
      mockApi.getAvailableExtensions.mockResolvedValue([]);

      render(<ExtensionsSettings settings={mockSettings} setSettings={mockSetSettings} />);

      await openManageSources();

      // Formatted GitHub name is shown
      expect(screen.getByText('org-name/repo-name')).toBeInTheDocument();

      const removeButton = findIconButtonByTitle('settings.extensions.repositories.remove');
      expect(removeButton).toBeTruthy();
      fireEvent.click(removeButton!);

      expect(mockSetSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          extensions: expect.objectContaining({
            customRepositories: expect.not.arrayContaining([customRepoUrl]),
          }),
        }),
      );
    });
  });

  describe('Enable/Disable Extensions', () => {
    it('should toggle extension enabled state', async () => {
      const extension = createMockLoadedExtension();

      mockApi.getInstalledExtensions.mockResolvedValue([extension]);
      mockApi.getAvailableExtensions.mockResolvedValue([]);

      render(<ExtensionsSettings settings={mockSettings} setSettings={mockSetSettings} />);

      await waitFor(() => {
        expect(screen.getByTestId('toggle')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('toggle'));

      expect(mockSetSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          extensions: expect.objectContaining({
            disabled: expect.arrayContaining([extension.filePath]),
          }),
        }),
      );
    });

    it('should re-enable a disabled extension', async () => {
      const extension = createMockLoadedExtension();

      mockSettings = {
        ...mockSettings,
        extensions: {
          customRepositories: [],
          disabled: [extension.filePath],
        },
      } as unknown as SettingsData;

      mockApi.getInstalledExtensions.mockResolvedValue([extension]);
      mockApi.getAvailableExtensions.mockResolvedValue([]);

      render(<ExtensionsSettings settings={mockSettings} setSettings={mockSetSettings} />);

      await waitFor(() => {
        expect(screen.getByTestId('toggle')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('toggle'));

      expect(mockSetSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          extensions: expect.objectContaining({
            disabled: expect.not.arrayContaining([extension.filePath]),
          }),
        }),
      );
    });
  });

  describe('Version Display', () => {
    it('should show the latest version in the version chip when an update is available', async () => {
      const installed = createMockLoadedExtension();
      const available = createMockAvailableExtension({ version: '2.0.0' });

      mockApi.getInstalledExtensions.mockResolvedValue([installed]);
      mockApi.getAvailableExtensions.mockResolvedValue([available]);

      render(<ExtensionsSettings settings={mockSettings} setSettings={mockSetSettings} />);

      await waitFor(() => {
        expect(screen.getByText('v1.0.0 → v2.0.0')).toBeInTheDocument();
      });
    });

    it('should show only the installed version when no update is available', async () => {
      const installed = createMockLoadedExtension();
      const available = createMockAvailableExtension();

      mockApi.getInstalledExtensions.mockResolvedValue([installed]);
      mockApi.getAvailableExtensions.mockResolvedValue([available]);

      render(<ExtensionsSettings settings={mockSettings} setSettings={mockSetSettings} />);

      await waitFor(() => {
        expect(screen.getByText('v1.0.0')).toBeInTheDocument();
      });
    });
  });

  describe('Extension Details Dialog', () => {
    it('should open the details dialog with the README when a row is clicked', async () => {
      const extension = createMockAvailableExtension({ readmeContent: '# Hello Readme' });

      mockApi.getInstalledExtensions.mockResolvedValue([]);
      mockApi.getAvailableExtensions.mockResolvedValue([extension]);

      render(<ExtensionsSettings settings={mockSettings} setSettings={mockSetSettings} />);

      switchToAvailableTab();

      const row = await screen.findByText('Test Extension');
      fireEvent.click(row);

      await waitFor(() => {
        expect(screen.getByText('Hello Readme')).toBeInTheDocument();
      });

      // Dialog exposes the install action in its footer
      const dialog = screen.getByText('Hello Readme').closest('[data-dialog-open="true"]');
      expect(dialog).toBeTruthy();
      expect(within(dialog as HTMLElement).getByText('settings.extensions.install')).toBeInTheDocument();
    });
  });
});
