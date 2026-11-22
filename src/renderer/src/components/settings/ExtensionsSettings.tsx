import { AvailableExtension, InstalledExtension, ProjectData, SettingsData } from '@common/types';
import { Activity, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMount } from '@reactuses/core';
import { useTranslation } from 'react-i18next';
import { FaCog, FaFilter, FaSearch, FaSync } from 'react-icons/fa';
import { AIDER_DESK_COMMUNITY_EXTENSIONS_REPO_URLS, AIDER_DESK_EXTENSIONS_REPO_URL, getExtensionRepositories } from '@common/extensions';
import { clsx } from 'clsx';

import { useApi } from '@/contexts/ApiContext';
import { getPathBasename } from '@/utils/path-utils';
import { IconButton } from '@/components/common/IconButton';
import { ScopeSelector } from '@/components/common/ScopeSelector';
import { Input } from '@/components/common/Input';
import { showErrorNotification, showSuccessNotification } from '@/utils/notifications';
import { LoadingOverlay } from '@/components/common/LoadingOverlay';
import { Select } from '@/components/common/Select';
import { ExtensionRow } from '@/components/settings/ExtensionRow';
import { ExtensionDetailsDialog } from '@/components/settings/ExtensionDetailsDialog';
import { ManageSourcesDialog } from '@/components/settings/ManageSourcesDialog';
import { ExtensionSettingsDialog } from '@/components/settings/ExtensionSettingsDialog';
import {
  ExtensionSource,
  ExtensionSourceFilter,
  SOURCE_ACCENT_VAR,
  formatRepositoryName,
  getExtensionSource,
  matchesSourceFilter,
} from '@/utils/extension-source';

enum Tab {
  Available = 'available',
  Installed = 'installed',
}

enum ExtensionSort {
  MostInstalled = 'most-installed',
  Name = 'name',
}

type Props = {
  settings: SettingsData;
  setSettings: (settings: SettingsData) => void;
  openProjects?: ProjectData[];
  selectedProjectContext?: 'global' | string;
};

export const ExtensionsSettings = ({ settings, setSettings, openProjects = [], selectedProjectContext }: Props) => {
  const { t } = useTranslation();
  const api = useApi();

  const [activeTab, setActiveTab] = useState<Tab>(Tab.Installed);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [installedExtensions, setInstalledExtensions] = useState<InstalledExtension[]>([]);
  const [availableExtensions, setAvailableExtensions] = useState<AvailableExtension[]>([]);
  const [loadingInstalled, setLoadingInstalled] = useState(false);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [installingExtensions, setInstallingExtensions] = useState<Set<string>>(new Set());
  const [uninstallingExtensions, setUninstallingExtensions] = useState<Set<string>>(new Set());
  const [updatingExtensions, setUpdatingExtensions] = useState<Set<string>>(new Set());
  const [reloadingExtensions, setReloadingExtensions] = useState<Set<string>>(new Set());
  const [newRepositoryUrl, setNewRepositoryUrl] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCapabilities, setSelectedCapabilities] = useState<Set<string>>(new Set());
  const [showCapabilityFilters, setShowCapabilityFilters] = useState(false);
  const [availableSort, setAvailableSort] = useState<ExtensionSort>(ExtensionSort.MostInstalled);
  const [sourceFilter, setSourceFilter] = useState<ExtensionSourceFilter>(ExtensionSourceFilter.All);
  const [showManageSources, setShowManageSources] = useState(false);
  const [detailsExtension, setDetailsExtension] = useState<InstalledExtension | AvailableExtension | null>(null);
  const [settingsExtension, setSettingsExtension] = useState<InstalledExtension | null>(null);

  // Track repositories that are currently being loaded
  const [loadingRepositories, setLoadingRepositories] = useState<Set<string>>(new Set());

  // Context state for project-level extensions
  const contexts = useMemo(() => ['global', ...openProjects.map((p) => p.baseDir)], [openProjects]);
  const [profileContext, setProfileContext] = useState<'global' | string>(selectedProjectContext || 'global');

  useEffect(() => {
    if (selectedProjectContext !== undefined) {
      setProfileContext(selectedProjectContext);
    }
  }, [selectedProjectContext]);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    searchInputRef.current?.focus();
  };

  const handleContextChange = (nextContext: string) => {
    setProfileContext(nextContext);
  };

  const getContextDisplayName = () => {
    if (profileContext === 'global') {
      return 'Global';
    }
    const project = openProjects.find((p) => p.baseDir === profileContext);
    return project ? getPathBasename(project.baseDir) : profileContext;
  };

  const projectDir = profileContext !== 'global' ? profileContext : undefined;

  const handleAvailableSortChange = (value: string) => {
    setAvailableSort(value as ExtensionSort);
  };

  const handleSourceFilterChange = (value: string) => {
    setSourceFilter(value as ExtensionSourceFilter);
  };

  const loadInstalledExtensions = useCallback(async () => {
    setLoadingInstalled(true);
    try {
      const extensions = await api.getInstalledExtensions(projectDir);
      setInstalledExtensions(extensions.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name)));
    } catch {
      showErrorNotification(t('settings.extensions.errors.loadInstalled'));
    } finally {
      setLoadingInstalled(false);
    }
  }, [projectDir, api, t]);

  const loadAvailableExtensions = useCallback(
    async (forceRefresh = false, repositories?: string[]) => {
      setLoadingAvailable(true);
      try {
        const repos = repositories || getExtensionRepositories(settings);
        const extensions = await api.getAvailableExtensions(repos, forceRefresh);
        setAvailableExtensions(extensions);
      } catch {
        showErrorNotification(t('settings.extensions.errors.loadAvailable'));
      } finally {
        setLoadingAvailable(false);
      }
    },
    [settings, api, t],
  );

  const handleRefresh = async () => {
    await Promise.all([loadInstalledExtensions(), loadAvailableExtensions(true)]);
  };

  useEffect(() => {
    void loadInstalledExtensions();
  }, [loadInstalledExtensions]);

  useMount(() => {
    void loadAvailableExtensions();
  });

  // Find the installed extension matching an id within the current context.
  const findInstalledForId = useCallback(
    (id: string): InstalledExtension | undefined =>
      installedExtensions.find((inst) => {
        if (inst.id !== id) {
          return false;
        }
        if (profileContext === 'global') {
          return !inst.projectDir;
        }
        return inst.projectDir === profileContext;
      }),
    [installedExtensions, profileContext],
  );

  const handleToggleDisabled = (extensionFilePath: string, isCurrentlyDisabled: boolean) => {
    const disabled = settings.extensions?.disabled || [];
    const updatedDisabled = isCurrentlyDisabled ? disabled.filter((fp) => fp !== extensionFilePath) : [...disabled, extensionFilePath];

    setSettings({
      ...settings,
      extensions: {
        customRepositories: settings.extensions?.customRepositories || [],
        disabled: updatedDisabled,
      },
    });
  };

  const handleUninstall = async (extensionFilePath: string) => {
    setUninstallingExtensions((prev) => new Set(prev).add(extensionFilePath));
    try {
      const success = await api.uninstallExtension(extensionFilePath, projectDir);
      if (success) {
        showSuccessNotification(t('settings.extensions.success.uninstall', { name: extensionFilePath }));
        await loadInstalledExtensions();
        await loadAvailableExtensions();
      } else {
        showErrorNotification(t('settings.extensions.errors.uninstall'));
      }
    } catch {
      showErrorNotification(t('settings.extensions.errors.uninstall'));
    } finally {
      setUninstallingExtensions((prev) => {
        const next = new Set(prev);
        next.delete(extensionFilePath);
        return next;
      });
    }
  };

  const handleInstall = async (extension: AvailableExtension) => {
    setInstallingExtensions((prev) => new Set(prev).add(extension.id));
    try {
      const result = await api.installExtension(extension.id, extension.repositoryUrl, projectDir);
      if (result.success) {
        showSuccessNotification(t('settings.extensions.success.install', { name: extension.name }));
        await loadInstalledExtensions();
      } else if (result.error === 'npm-not-found') {
        showErrorNotification(t('settings.extensions.errors.npmNotFound'), false);
      } else {
        showErrorNotification(t('settings.extensions.errors.install'));
      }
    } catch {
      showErrorNotification(t('settings.extensions.errors.install'));
    } finally {
      setInstallingExtensions((prev) => {
        const next = new Set(prev);
        next.delete(extension.id);
        return next;
      });
    }
  };

  const handleUpdate = async (extension: AvailableExtension) => {
    const installedExtension = findInstalledForId(extension.id);
    if (!installedExtension) {
      return;
    }

    setUpdatingExtensions((prev) => new Set(prev).add(installedExtension.filePath));
    try {
      const result = await api.updateExtension(installedExtension.filePath, extension.repositoryUrl, projectDir);
      if (result.success) {
        showSuccessNotification(t('settings.extensions.success.update', { name: extension.name }));
        await loadInstalledExtensions();
        await loadAvailableExtensions();
      } else if (result.error === 'npm-not-found') {
        showErrorNotification(t('settings.extensions.errors.npmNotFound'), false);
      } else {
        showErrorNotification(t('settings.extensions.errors.update'));
      }
    } catch {
      showErrorNotification(t('settings.extensions.errors.update'));
    } finally {
      setUpdatingExtensions((prev) => {
        const next = new Set(prev);
        next.delete(installedExtension.filePath);
        return next;
      });
    }
  };

  const handleReload = async (extensionFilePath: string) => {
    setReloadingExtensions((prev) => new Set(prev).add(extensionFilePath));
    try {
      const success = await api.reloadExtension(extensionFilePath, projectDir);
      if (success) {
        showSuccessNotification(t('settings.extensions.success.reload', { name: extensionFilePath }));
        await loadInstalledExtensions();
      } else {
        showErrorNotification(t('settings.extensions.errors.reload'));
      }
    } catch {
      showErrorNotification(t('settings.extensions.errors.reload'));
    } finally {
      setReloadingExtensions((prev) => {
        const next = new Set(prev);
        next.delete(extensionFilePath);
        return next;
      });
    }
  };

  const handleAddRepository = async () => {
    const trimmedUrl = newRepositoryUrl.trim();
    if (!trimmedUrl) {
      return;
    }

    const currentRepositories = settings.extensions?.customRepositories || [];
    if (getExtensionRepositories(settings).includes(trimmedUrl)) {
      showErrorNotification(t('settings.extensions.errors.repositoryExists'));
      return;
    }

    setSettings({
      ...settings,
      extensions: {
        ...settings.extensions,
        customRepositories: [...currentRepositories, trimmedUrl],
        disabled: settings.extensions?.disabled || [],
      },
    });

    setNewRepositoryUrl('');

    setLoadingRepositories((prev) => new Set(prev).add(trimmedUrl));
    try {
      const newExtensions = await api.getAvailableExtensions([trimmedUrl], true, true);
      setAvailableExtensions((prev) => [...prev, ...newExtensions]);
    } catch {
      showErrorNotification(t('settings.extensions.errors.loadAvailable'));
    } finally {
      setLoadingRepositories((prev) => {
        const next = new Set(prev);
        next.delete(trimmedUrl);
        return next;
      });
    }
  };

  const handleRemoveRepository = (repositoryUrl: string) => {
    if (repositoryUrl === AIDER_DESK_EXTENSIONS_REPO_URL || AIDER_DESK_COMMUNITY_EXTENSIONS_REPO_URLS.includes(repositoryUrl)) {
      showErrorNotification(t('settings.extensions.errors.cannotRemoveDefault'));
      return;
    }

    const currentRepositories = settings.extensions?.customRepositories || [];
    const updatedRepositories = currentRepositories.filter((url) => url !== repositoryUrl);

    setSettings({
      ...settings,
      extensions: {
        ...settings.extensions,
        customRepositories: updatedRepositories,
        disabled: settings.extensions?.disabled || [],
      },
    });

    setAvailableExtensions((prev) => prev.filter((ext) => ext.repositoryUrl !== repositoryUrl));
  };

  const handleShowManageSources = () => {
    setDetailsExtension(null);
    setShowManageSources(true);
  };

  const handleToggleCapabilityFilters = () => {
    setShowCapabilityFilters((prev) => !prev);
  };

  const handleToggleCapability = (capability: string) => {
    setSelectedCapabilities((prev) => {
      const next = new Set(prev);
      if (next.has(capability)) {
        next.delete(capability);
      } else {
        next.add(capability);
      }
      return next;
    });
  };

  const disabledExtensions = settings.extensions?.disabled || [];

  const matchesCapabilities = useCallback(
    (capabilities?: string[]) => {
      if (selectedCapabilities.size === 0) {
        return true;
      }
      const extCapabilities = capabilities || [];
      return Array.from(selectedCapabilities).some((cap) => extCapabilities.includes(cap));
    },
    [selectedCapabilities],
  );

  const filteredInstalledExtensions = installedExtensions.filter((ext) => {
    if (profileContext === 'global') {
      if (ext.projectDir) {
        return false;
      }
    } else if (ext.projectDir !== profileContext) {
      return false;
    }

    const searchLower = searchQuery.toLowerCase();
    const matchesSearch =
      ext.metadata.name.toLowerCase().includes(searchLower) ||
      ext.metadata.description?.toLowerCase().includes(searchLower) ||
      ext.metadata.author?.toLowerCase().includes(searchLower);

    return matchesSearch && matchesCapabilities(ext.metadata.capabilities);
  });

  const filteredAvailableExtensions = availableExtensions.filter((ext) => {
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch =
      ext.name.toLowerCase().includes(searchLower) || ext.description?.toLowerCase().includes(searchLower) || ext.author?.toLowerCase().includes(searchLower);

    if (!matchesSearch) {
      return false;
    }

    if (!matchesSourceFilter(getExtensionSource(ext.repositoryUrl), sourceFilter)) {
      return false;
    }

    return matchesCapabilities(ext.capabilities);
  });

  const sortedAvailableExtensions = [...filteredAvailableExtensions].sort((a, b) => {
    if (availableSort === ExtensionSort.MostInstalled) {
      const diff = (b.installCount ?? 0) - (a.installCount ?? 0);
      if (diff !== 0) {
        return diff;
      }
    }
    return a.name.localeCompare(b.name);
  });

  const isLoading = loadingInstalled || loadingAvailable;

  const allCapabilities = Array.from(
    new Set([...installedExtensions.flatMap((ext) => ext.metadata.capabilities || []), ...availableExtensions.flatMap((ext) => ext.capabilities || [])]),
  ).sort();

  const repositories = getExtensionRepositories(settings);
  const extensionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    availableExtensions.forEach((ext) => {
      counts[ext.repositoryUrl] = (counts[ext.repositoryUrl] ?? 0) + 1;
    });
    return counts;
  }, [availableExtensions]);

  const renderSourceDot = (source: ExtensionSource) => (
    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: SOURCE_ACCENT_VAR[source] }} />
  );

  const sourceOptions = [
    { value: ExtensionSourceFilter.All, label: t('settings.extensions.source.allSources') },
    {
      value: ExtensionSourceFilter.Official,
      label: (
        <span className="flex items-center gap-2">
          {renderSourceDot(ExtensionSource.Official)}
          {t('settings.extensions.source.official')}
        </span>
      ),
    },
    {
      value: ExtensionSourceFilter.Community,
      label: (
        <span className="flex items-center gap-2">
          {renderSourceDot(ExtensionSource.Community)}
          {t('settings.extensions.source.community')}
        </span>
      ),
    },
    {
      value: ExtensionSourceFilter.Custom,
      label: (
        <span className="flex items-center gap-2">
          {renderSourceDot(ExtensionSource.Custom)}
          {t('settings.extensions.source.custom')}
        </span>
      ),
    },
  ];

  const renderTabButton = (tab: Tab, label: string, count: number) => (
    <button
      onClick={() => handleTabChange(tab)}
      className={clsx(
        'px-4 h-full flex items-center text-sm font-medium rounded-md transition-all duration-200',
        activeTab === tab ? 'bg-bg-tertiary text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary hover:bg-bg-tertiary',
      )}
    >
      {label}
      {count > 0 && <span className="ml-2 text-2xs px-1.5 py-0.5 rounded-full bg-bg-tertiary">{count}</span>}
    </button>
  );

  const renderInstalledRows = () => {
    if (loadingInstalled) {
      return (
        <div className="flex items-center justify-center py-12 text-2xs relative">
          <LoadingOverlay message={t('settings.extensions.loading')} spinnerSize="sm" transparent={true} />
        </div>
      );
    }

    if (filteredInstalledExtensions.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-sm text-text-muted mb-2">{t('settings.extensions.installed.empty')}</p>
          <p className="text-xs text-text-muted">{t('settings.extensions.installed.emptyHint')}</p>
        </div>
      );
    }

    return (
      <div className="rounded-lg border border-border-default-dark overflow-hidden bg-bg-secondary divide-y divide-border-default-dark">
        {filteredInstalledExtensions.map((extension) => {
          const available = availableExtensions.find((avail) => avail.id === extension.id);
          const source = available ? getExtensionSource(available.repositoryUrl) : undefined;
          const repoLabel = available ? formatRepositoryName(available.repositoryUrl) : undefined;
          const hasUpdate = available ? available.version !== extension.metadata.version : false;
          const hasConfig = extension.metadata.hasConfig ?? false;

          return (
            <ExtensionRow
              key={extension.filePath}
              extension={extension}
              latestVersion={available?.version}
              source={source}
              repoLabel={repoLabel}
              showSourceBadge={source !== undefined}
              isInstalled={true}
              isDisabled={disabledExtensions.includes(extension.filePath)}
              isUninstalling={uninstallingExtensions.has(extension.filePath)}
              isUpdating={updatingExtensions.has(extension.filePath)}
              isReloading={reloadingExtensions.has(extension.filePath)}
              hasUpdate={hasUpdate}
              hasConfig={hasConfig}
              onOpenDetails={() => setDetailsExtension(extension)}
              onToggle={() => handleToggleDisabled(extension.filePath, disabledExtensions.includes(extension.filePath))}
              onUninstall={() => handleUninstall(extension.filePath)}
              onUpdate={available ? () => handleUpdate(available) : undefined}
              onReload={() => handleReload(extension.filePath)}
              onOpenSettings={hasConfig ? () => setSettingsExtension(extension) : undefined}
            />
          );
        })}
      </div>
    );
  };

  const renderAvailableRows = () => {
    if (loadingAvailable) {
      return (
        <div className="flex items-center justify-center py-12 text-2xs relative">
          <LoadingOverlay message={t('settings.extensions.loading')} spinnerSize="sm" transparent={true} />
        </div>
      );
    }

    if (sortedAvailableExtensions.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-xs text-text-muted">{t('settings.extensions.available.empty')}</p>
        </div>
      );
    }

    const showSourceBadge = sourceFilter === ExtensionSourceFilter.All || sourceFilter === ExtensionSourceFilter.Custom;

    return (
      <div className="rounded-lg border border-border-default-dark overflow-hidden bg-bg-secondary divide-y divide-border-default-dark">
        {sortedAvailableExtensions.map((extension) => {
          const installedExtension = findInstalledForId(extension.id);
          const source = getExtensionSource(extension.repositoryUrl);
          const repoLabel = formatRepositoryName(extension.repositoryUrl);
          const isInstalled = !!installedExtension;
          const hasUpdate = installedExtension ? extension.version !== installedExtension.metadata.version : false;
          const hasConfig = installedExtension?.metadata.hasConfig ?? false;

          return (
            <ExtensionRow
              key={extension.id}
              extension={extension}
              source={source}
              repoLabel={repoLabel}
              showSourceBadge={showSourceBadge}
              isInstalled={isInstalled}
              isDisabled={installedExtension ? disabledExtensions.includes(installedExtension.filePath) : false}
              isInstalling={installingExtensions.has(extension.id)}
              isUninstalling={installedExtension ? uninstallingExtensions.has(installedExtension.filePath) : false}
              isUpdating={installedExtension ? updatingExtensions.has(installedExtension.filePath) : false}
              isReloading={installedExtension ? reloadingExtensions.has(installedExtension.filePath) : false}
              hasUpdate={hasUpdate}
              hasConfig={hasConfig}
              onOpenDetails={() => setDetailsExtension(extension)}
              onInstall={() => handleInstall(extension)}
              onToggle={
                installedExtension
                  ? () => handleToggleDisabled(installedExtension.filePath, disabledExtensions.includes(installedExtension.filePath))
                  : undefined
              }
              onUninstall={installedExtension ? () => handleUninstall(installedExtension.filePath) : undefined}
              onUpdate={installedExtension ? () => handleUpdate(extension) : undefined}
              onReload={installedExtension ? () => handleReload(installedExtension.filePath) : undefined}
              onOpenSettings={installedExtension && hasConfig ? () => setSettingsExtension(installedExtension) : undefined}
            />
          );
        })}
      </div>
    );
  };

  const renderDetailsDialog = () => {
    if (!detailsExtension) {
      return null;
    }

    const id = detailsExtension.id;
    const installed = findInstalledForId(id);
    const available = availableExtensions.find((ext) => ext.id === id);
    const repositoryUrl = available?.repositoryUrl;
    const source = repositoryUrl ? getExtensionSource(repositoryUrl) : undefined;
    const repoLabel = repositoryUrl ? formatRepositoryName(repositoryUrl) : undefined;
    const isInstalled = !!installed;
    const isDisabled = installed ? disabledExtensions.includes(installed.filePath) : false;
    const hasUpdate = installed && available ? available.version !== installed.metadata.version : false;
    const hasConfig = installed?.metadata.hasConfig ?? false;

    const handleCloseDetails = () => setDetailsExtension(null);

    return (
      <ExtensionDetailsDialog
        extension={detailsExtension}
        source={source}
        repoLabel={repoLabel}
        isInstalled={isInstalled}
        isDisabled={isDisabled}
        hasUpdate={hasUpdate}
        hasConfig={hasConfig}
        isInstalling={installingExtensions.has(id)}
        isUninstalling={installed ? uninstallingExtensions.has(installed.filePath) : false}
        isUpdating={installed ? updatingExtensions.has(installed.filePath) : false}
        onClose={handleCloseDetails}
        onInstall={available ? () => handleInstall(available) : undefined}
        onUninstall={installed ? () => handleUninstall(installed.filePath) : undefined}
        onUpdate={available && installed ? () => handleUpdate(available) : undefined}
        onToggle={installed ? () => handleToggleDisabled(installed.filePath, isDisabled) : undefined}
        onOpenSettings={
          installed && hasConfig
            ? () => {
                handleCloseDetails();
                setSettingsExtension(installed);
              }
            : undefined
        }
      />
    );
  };

  return (
    <div className="space-y-3">
      {/* Compact toolbar — primary row: tabs + scope */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 p-1 h-10 bg-bg-primary rounded-lg border border-border-default flex-shrink-0">
          {renderTabButton(Tab.Installed, t('settings.extensions.tabs.installed'), filteredInstalledExtensions.length)}
          {renderTabButton(Tab.Available, t('settings.extensions.tabs.available'), availableExtensions.length)}
        </div>

        <ScopeSelector
          contexts={contexts}
          value={profileContext}
          onChange={handleContextChange}
          getDisplayName={getContextDisplayName}
          previousTooltip={t('settings.extensions.previousContext')}
          nextTooltip={t('settings.extensions.nextContext')}
          className="ml-auto min-w-[200px] max-w-[260px]"
        />
      </div>

      {/* Secondary row — search + sort/source/manage/filters/refresh */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <FaSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
            placeholder={t('settings.extensions.search.placeholder')}
            className="pl-10"
            wrapperClassName="w-full"
          />
        </div>

        {activeTab === Tab.Available && (
          <>
            <Select
              value={availableSort}
              onChange={handleAvailableSortChange}
              options={[
                { label: t('settings.extensions.sort.mostInstalled'), value: ExtensionSort.MostInstalled },
                { label: t('settings.extensions.sort.name'), value: ExtensionSort.Name },
              ]}
              size="sm"
              className="min-w-[11rem]"
            />
            <Select value={sourceFilter} onChange={handleSourceFilterChange} options={sourceOptions} size="sm" className="min-w-[11rem]" />
            <IconButton
              icon={<FaCog className="w-3.5 h-3.5" />}
              onClick={handleShowManageSources}
              tooltip={t('settings.extensions.sources.manage')}
              className="p-2 rounded-md border border-border-default"
            />
          </>
        )}

        {allCapabilities.length > 0 && (
          <IconButton
            icon={<FaFilter className="w-3.5 h-3.5" />}
            onClick={handleToggleCapabilityFilters}
            tooltip={t('settings.extensions.filters')}
            className={clsx(
              'p-2 rounded-md border border-border-default',
              showCapabilityFilters || selectedCapabilities.size > 0 ? 'text-text-primary bg-bg-tertiary' : '',
            )}
          />
        )}
        <IconButton
          icon={<FaSync className={clsx('w-3.5 h-3.5', isLoading && 'animate-spin')} />}
          onClick={handleRefresh}
          disabled={isLoading}
          tooltip={t('common.refresh')}
          className="p-2 rounded-md border border-border-default"
        />
      </div>

      {/* Capability filters (collapsible) */}
      {showCapabilityFilters && allCapabilities.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {allCapabilities.map((capability) => {
            const isSelected = selectedCapabilities.has(capability);
            return (
              <button
                key={capability}
                onClick={() => handleToggleCapability(capability)}
                className={clsx(
                  'px-3 py-1 text-3xs font-medium rounded-full transition-colors border border-border-default',
                  isSelected ? 'bg-bg-secondary-light text-text-primary' : 'bg-bg-primary text-text-muted hover:text-text-secondary hover:bg-bg-tertiary',
                )}
              >
                {capability}
              </button>
            );
          })}
        </div>
      )}

      {/* Tab Content */}
      <Activity mode={activeTab === Tab.Installed ? 'visible' : 'hidden'}>{renderInstalledRows()}</Activity>
      <Activity mode={activeTab === Tab.Available ? 'visible' : 'hidden'}>{renderAvailableRows()}</Activity>

      {renderDetailsDialog()}

      {showManageSources && (
        <ManageSourcesDialog
          repositories={repositories}
          extensionCounts={extensionCounts}
          loadingRepositories={loadingRepositories}
          newRepositoryUrl={newRepositoryUrl}
          onNewRepositoryUrlChange={setNewRepositoryUrl}
          onAdd={handleAddRepository}
          onRemove={handleRemoveRepository}
          onClose={() => setShowManageSources(false)}
        />
      )}

      {settingsExtension && (
        <ExtensionSettingsDialog
          extensionId={settingsExtension.id}
          extensionName={settingsExtension.metadata.name}
          projectDir={settingsExtension.projectDir}
          onClose={() => setSettingsExtension(null)}
        />
      )}
    </div>
  );
};
