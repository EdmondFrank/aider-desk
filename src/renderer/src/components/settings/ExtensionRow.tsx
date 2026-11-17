import { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FaCog, FaDownload, FaSync, FaTrash } from 'react-icons/fa';
import { clsx } from 'clsx';

import type { AvailableExtension, InstalledExtension } from '@common/types';

import { ExtensionSource } from '@/utils/extension-source';
import { Button } from '@/components/common/Button';
import { IconButton } from '@/components/common/IconButton';
import { Toggle } from '@/components/common/Toggle';
import { Tooltip } from '@/components/ui/Tooltip';
import { SourceBadge } from '@/components/settings/SourceBadge';

const getRowData = (extension: InstalledExtension | AvailableExtension) => {
  const isLoaded = 'metadata' in extension;
  return {
    name: isLoaded ? extension.metadata.name : extension.name,
    version: isLoaded ? extension.metadata.version : extension.version,
    description: isLoaded ? extension.metadata.description : extension.description,
    iconUrl: isLoaded ? extension.metadata.iconUrl : extension.iconUrl,
    installCount: isLoaded ? undefined : extension.installCount,
    projectDir: isLoaded ? extension.projectDir : undefined,
  };
};

type Props = {
  extension: InstalledExtension | AvailableExtension;
  source?: ExtensionSource;
  repoLabel?: string;
  showSourceBadge?: boolean;
  isInstalled?: boolean;
  isDisabled?: boolean;
  isInstalling?: boolean;
  isUninstalling?: boolean;
  isUpdating?: boolean;
  isReloading?: boolean;
  hasUpdate?: boolean;
  hasConfig?: boolean;
  onOpenDetails: () => void;
  onInstall?: () => void;
  onToggle?: () => void;
  onUninstall?: () => void;
  onUpdate?: () => void;
  onReload?: () => void;
  onOpenSettings?: () => void;
};

export const ExtensionRow = ({
  extension,
  source,
  repoLabel,
  showSourceBadge = false,
  isInstalled = false,
  isDisabled = false,
  isInstalling = false,
  isUninstalling = false,
  isUpdating = false,
  isReloading = false,
  hasUpdate = false,
  hasConfig = false,
  onOpenDetails,
  onInstall,
  onToggle,
  onUninstall,
  onUpdate,
  onReload,
  onOpenSettings,
}: Props) => {
  const { t } = useTranslation();
  const data = getRowData(extension);

  const handleActionsClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  };

  return (
    <div
      onClick={onOpenDetails}
      className={clsx('group flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors hover:bg-bg-primary-light', isDisabled && 'opacity-60')}
    >
      {/* Icon */}
      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-text-primary font-bold text-sm flex-shrink-0 bg-bg-primary-light-strong overflow-hidden">
        {data.iconUrl ? <img src={data.iconUrl} alt={data.name} className="w-full h-full object-cover" /> : data.name.charAt(0).toUpperCase()}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={clsx('text-sm font-semibold truncate', isDisabled ? 'text-text-muted' : 'text-text-primary')}>{data.name}</span>
          <span className="text-3xs text-text-muted-light">{`v${data.version}`}</span>
          {data.installCount !== undefined && (
            <Tooltip content={t('settings.extensions.totalInstalls')}>
              <span className="text-3xs text-text-muted-light inline-flex items-center gap-1">
                <FaDownload className="w-2 h-2" />
                {data.installCount.toLocaleString()}
              </span>
            </Tooltip>
          )}
          {isInstalled && !isDisabled && (
            <span className="text-3xs px-1.5 py-0.5 rounded bg-success-subtle text-success font-semibold">{t('settings.extensions.active')}</span>
          )}
          {isInstalled && isDisabled && (
            <span className="text-3xs px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted font-semibold">{t('settings.extensions.disabled')}</span>
          )}
          {data.projectDir && (
            <span className="text-3xs px-1.5 py-0.5 rounded bg-info-subtle text-info font-semibold">{t('settings.extensions.projectSpecific')}</span>
          )}
          {showSourceBadge && source && <SourceBadge source={source} repoLabel={source === ExtensionSource.Custom ? repoLabel : undefined} />}
        </div>
        {data.description && <p className={clsx('text-xs truncate mt-0.5', isDisabled ? 'text-text-muted' : 'text-text-secondary')}>{data.description}</p>}
      </div>

      {/* Actions */}
      <div onClick={handleActionsClick} className="flex items-center gap-2 flex-shrink-0">
        {isInstalled ? (
          <>
            {hasConfig && onOpenSettings && (
              <IconButton icon={<FaCog className="w-3.5 h-3.5" />} onClick={onOpenSettings} tooltip={t('settings.extensions.openSettings')} className="p-1" />
            )}
            <IconButton
              icon={<FaSync className={clsx('w-3.5 h-3.5', isReloading && 'animate-spin')} />}
              onClick={onReload}
              disabled={isReloading}
              tooltip={isReloading ? t('settings.extensions.reloading') : t('settings.extensions.reload')}
              className="p-1"
            />
            {hasUpdate && onUpdate && (
              <Button onClick={onUpdate} disabled={isUpdating} variant="contained" size="xs">
                <FaDownload className={clsx('mr-1.5 w-3 h-3', isUpdating && 'animate-spin')} />
                {isUpdating ? t('settings.extensions.updating') : t('settings.extensions.update')}
              </Button>
            )}
            <Toggle checked={!isDisabled} onChange={() => onToggle?.()} aria-label={t('settings.extensions.enabled')} />
            <IconButton
              icon={<FaTrash className="w-3.5 h-3.5" />}
              onClick={onUninstall}
              disabled={isUninstalling}
              tooltip={isUninstalling ? t('settings.extensions.uninstalling') : t('settings.extensions.uninstall')}
              className="p-1 hover:text-error"
            />
          </>
        ) : (
          <Button onClick={onInstall} disabled={isInstalling} variant="contained" size="xs">
            <FaDownload className="mr-1.5 w-3 h-3" />
            {isInstalling ? t('settings.extensions.installing') : t('settings.extensions.install')}
          </Button>
        )}
      </div>
    </div>
  );
};
