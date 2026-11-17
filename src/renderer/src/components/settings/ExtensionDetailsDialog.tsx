import ReactMarkdown from 'react-markdown';
import { useTranslation } from 'react-i18next';
import { FaCog, FaDownload } from 'react-icons/fa';

import type { AvailableExtension, InstalledExtension } from '@common/types';

import { ExtensionSource } from '@/utils/extension-source';
import { BaseDialog } from '@/components/common/BaseDialog';
import { Button } from '@/components/common/Button';
import { Toggle } from '@/components/common/Toggle';
import { SourceBadge } from '@/components/settings/SourceBadge';
import { MARKDOWN_COMPONENTS, REMARK_PLUGINS, REHYPE_PLUGINS } from '@/components/message/utils';

const getDetailsData = (extension: InstalledExtension | AvailableExtension) => {
  const isLoaded = 'metadata' in extension;
  return {
    name: isLoaded ? extension.metadata.name : extension.name,
    version: isLoaded ? extension.metadata.version : extension.version,
    author: isLoaded ? extension.metadata.author : extension.author,
    iconUrl: isLoaded ? extension.metadata.iconUrl : extension.iconUrl,
    installCount: isLoaded ? undefined : extension.installCount,
    readmeContent: extension.readmeContent,
  };
};

type Props = {
  extension: InstalledExtension | AvailableExtension;
  source?: ExtensionSource;
  repoLabel?: string;
  isInstalled: boolean;
  isDisabled: boolean;
  hasUpdate: boolean;
  hasConfig: boolean;
  isInstalling: boolean;
  isUninstalling: boolean;
  isUpdating: boolean;
  onClose: () => void;
  onInstall?: () => void;
  onUninstall?: () => void;
  onUpdate?: () => void;
  onToggle?: () => void;
  onOpenSettings?: () => void;
};

export const ExtensionDetailsDialog = ({
  extension,
  source,
  repoLabel,
  isInstalled,
  isDisabled,
  hasUpdate,
  hasConfig,
  isInstalling,
  isUninstalling,
  isUpdating,
  onClose,
  onInstall,
  onUninstall,
  onUpdate,
  onToggle,
  onOpenSettings,
}: Props) => {
  const { t } = useTranslation();
  const data = getDetailsData(extension);
  const hasReadme = data.readmeContent && data.readmeContent.trim().length > 0;

  const footer = (
    <div className="flex items-center justify-between w-full gap-3">
      <div className="flex items-center gap-3">
        {isInstalled && (
          <Toggle checked={!isDisabled} onChange={() => onToggle?.()} label={t('settings.extensions.enabled')} aria-label={t('settings.extensions.enabled')} />
        )}
        {isInstalled && hasConfig && onOpenSettings && (
          <Button onClick={onOpenSettings} variant="text" size="sm">
            <FaCog className="mr-1.5 w-3 h-3" />
            {t('settings.extensions.openSettings')}
          </Button>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={onClose} variant="outline" color="tertiary" size="sm">
          {t('common.close')}
        </Button>
        {isInstalled ? (
          <>
            {hasUpdate && onUpdate && (
              <Button onClick={onUpdate} disabled={isUpdating} variant="contained" size="sm">
                <FaDownload className={`mr-1.5 w-3 h-3 ${isUpdating ? 'animate-spin' : ''}`} />
                {isUpdating ? t('settings.extensions.updating') : t('settings.extensions.update')}
              </Button>
            )}
            <Button onClick={onUninstall} disabled={isUninstalling} variant="outline" size="sm" color="danger">
              {isUninstalling ? t('settings.extensions.uninstalling') : t('settings.extensions.uninstall')}
            </Button>
          </>
        ) : (
          <Button onClick={onInstall} disabled={isInstalling} variant="contained" size="sm">
            <FaDownload className="mr-1.5 w-3 h-3" />
            {isInstalling ? t('settings.extensions.installing') : t('settings.extensions.install')}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <BaseDialog title={data.name} onClose={onClose} width={880} footer={footer} contentClass="p-0">
      <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center text-text-primary font-bold text-xl flex-shrink-0 bg-bg-primary-light-strong overflow-hidden">
            {data.iconUrl ? <img src={data.iconUrl} alt={data.name} className="w-full h-full object-cover" /> : data.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-text-primary">{data.name}</h3>
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              {source && <SourceBadge source={source} repoLabel={source === ExtensionSource.Custom ? repoLabel : undefined} />}
              <span className="text-3xs px-2 py-0.5 rounded bg-bg-tertiary text-text-tertiary font-medium">{`v${data.version}`}</span>
              {data.installCount !== undefined && (
                <span className="text-3xs px-2 py-0.5 rounded bg-bg-tertiary text-text-tertiary font-medium inline-flex items-center gap-1">
                  <FaDownload className="w-2 h-2" />
                  {data.installCount.toLocaleString()}
                </span>
              )}
            </div>
            {data.author && (
              <p className="text-3xs text-text-muted mt-2">
                {t('settings.extensions.by')} {data.author}
              </p>
            )}
          </div>
        </div>

        {/* README */}
        {hasReadme ? (
          <div className="text-4xs text-text-primary max-w-none max-h-[50vh] overflow-y-auto bg-bg-primary-light rounded-md p-4 scrollbar-thin scrollbar-track-bg-secondary scrollbar-thumb-bg-tertiary hover:scrollbar-thumb-bg-fourth">
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={MARKDOWN_COMPONENTS}>
              {data.readmeContent!}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="text-xs text-text-muted py-4 text-center">{t('settings.extensions.noReadme')}</p>
        )}
      </div>
    </BaseDialog>
  );
};
