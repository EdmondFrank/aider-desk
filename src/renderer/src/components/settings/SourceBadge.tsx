import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';

import { ExtensionSource, SOURCE_ACCENT_VAR } from '@/utils/extension-source';

type Props = {
  source: ExtensionSource;
  repoLabel?: string;
  className?: string;
};

export const SourceBadge = ({ source, repoLabel, className }: Props) => {
  const { t } = useTranslation();
  const label = t(`settings.extensions.source.${source}`);

  return (
    <span
      className={clsx(
        'text-3xs px-2 py-0.5 rounded bg-bg-tertiary text-text-tertiary font-medium inline-flex items-center gap-1 whitespace-nowrap flex-shrink-0',
        className,
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: SOURCE_ACCENT_VAR[source] }} />
      {repoLabel ? `${label} · ${repoLabel}` : label}
    </span>
  );
};
