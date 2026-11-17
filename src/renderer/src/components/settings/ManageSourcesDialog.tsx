import { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FaPlus, FaTrash } from 'react-icons/fa';

import { ExtensionSource, SOURCE_ACCENT_VAR, formatRepositoryName, getExtensionSource } from '@/utils/extension-source';
import { BaseDialog } from '@/components/common/BaseDialog';
import { Button } from '@/components/common/Button';
import { IconButton } from '@/components/common/IconButton';
import { Input } from '@/components/common/Input';
import { SourceBadge } from '@/components/settings/SourceBadge';

type Props = {
  repositories: string[];
  extensionCounts: Record<string, number>;
  loadingRepositories: Set<string>;
  newRepositoryUrl: string;
  onNewRepositoryUrlChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (repositoryUrl: string) => void;
  onClose: () => void;
};

export const ManageSourcesDialog = ({
  repositories,
  extensionCounts,
  loadingRepositories,
  newRepositoryUrl,
  onNewRepositoryUrlChange,
  onAdd,
  onRemove,
  onClose,
}: Props) => {
  const { t } = useTranslation();

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onAdd();
    }
  };

  const renderRepositoryRow = (repositoryUrl: string) => {
    const source = getExtensionSource(repositoryUrl);
    const isCustom = source === ExtensionSource.Custom;
    const isLoading = loadingRepositories.has(repositoryUrl);
    const count = extensionCounts[repositoryUrl] ?? 0;

    return (
      <div key={repositoryUrl} className="flex items-center gap-3 px-3 py-2.5">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: SOURCE_ACCENT_VAR[source] }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-medium text-text-primary truncate" title={repositoryUrl}>
              {formatRepositoryName(repositoryUrl)}
            </span>
            <SourceBadge source={source} />
          </div>
          <p className="text-4xs text-text-muted mt-0.5 truncate">
            {isLoading ? t('settings.extensions.loading') : `${count} ${t('settings.extensions.available.extensionsCount')}`}
          </p>
        </div>
        {isCustom ? (
          <IconButton
            icon={<FaTrash className="w-3.5 h-3.5" />}
            onClick={() => onRemove(repositoryUrl)}
            tooltip={t('settings.extensions.repositories.remove')}
            className="p-1 hover:text-error flex-shrink-0"
          />
        ) : (
          <span className="text-4xs px-2 py-0.5 rounded-full border border-border-default-dark text-text-muted whitespace-nowrap flex-shrink-0">
            {t('settings.extensions.sources.locked')}
          </span>
        )}
      </div>
    );
  };

  const footer = (
    <Button onClick={onClose} variant="contained" size="sm">
      {t('common.close')}
    </Button>
  );

  return (
    <BaseDialog title={t('settings.extensions.sources.title')} onClose={onClose} width={600} footer={footer}>
      <div className="rounded-lg border border-border-default-dark overflow-hidden bg-bg-secondary divide-y divide-border-default-dark">
        {repositories.map(renderRepositoryRow)}
      </div>

      <div className="mt-5 pt-4 border-t border-border-default-dark">
        <p className="text-3xs uppercase tracking-wide text-text-muted mb-2">{t('settings.extensions.sources.addRepository')}</p>
        <div className="flex items-center gap-2">
          <Input
            value={newRepositoryUrl}
            onChange={(e) => onNewRepositoryUrlChange(e.target.value)}
            placeholder={t('settings.extensions.repositories.placeholder')}
            onKeyDown={handleKeyDown}
            size="sm"
            wrapperClassName="flex-1"
          />
          <Button onClick={onAdd} variant="contained" size="sm" disabled={!newRepositoryUrl.trim()}>
            <FaPlus className="mr-1.5 w-3 h-3" />
            {t('settings.extensions.repositories.add')}
          </Button>
        </div>
      </div>
    </BaseDialog>
  );
};
