import { FaInfoCircle, FaExclamationTriangle, FaExclamationCircle } from 'react-icons/fa';
import { LogMessage } from '@common/types';
import { clsx } from 'clsx';

type Props = {
  level: LogMessage['level'];
};

export const MessageMapLogIcon = ({ level }: Props) => {
  const Icon = level === 'error' ? FaExclamationCircle : level === 'warning' ? FaExclamationTriangle : FaInfoCircle;

  return (
    <Icon
      aria-hidden="true"
      className={clsx('h-2.5 w-2.5 shrink-0', {
        'text-text-muted': level === 'info',
        'text-warning': level === 'warning',
        'text-error-light': level === 'error',
      })}
    />
  );
};
