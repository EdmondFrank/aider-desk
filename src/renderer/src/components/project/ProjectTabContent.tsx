import { MouseEvent } from 'react';
import { CgSpinner } from 'react-icons/cg';
import { MdClose } from 'react-icons/md';
import { clsx } from 'clsx';

export const getProjectTabClassName = (selected: boolean, isProcessing = false): string =>
  clsx(
    'group text-sm pl-3 h-9 py-2 pr-3 border-r border-border-dark-light transition-all duration-200 ease-in-out flex items-center gap-3 relative whitespace-nowrap focus:outline-none',
    !isProcessing && 'hover:pr-1',
    selected
      ? 'bg-gradient-to-b from-bg-secondary-light to-bg-secondary-light text-text-primary font-medium'
      : 'bg-gradient-to-b from-bg-primary to-bg-primary-light text-text-muted hover:bg-bg-secondary-light-strongest hover:text-text-tertiary',
  );

type Props = {
  baseDir: string;
  isActive: boolean;
  isProcessing?: boolean;
  onClose?: () => void;
};

export const ProjectTabContent = ({ baseDir, isActive, isProcessing = false, onClose }: Props) => {
  const handleClose = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onClose?.();
  };

  return (
    <>
      {baseDir.split(/[\\/]/).pop()}
      {onClose &&
        (isProcessing ? (
          <div className="flex items-center justify-center rounded-full p-1 z-10 cursor-default">
            <CgSpinner className="h-3.5 w-3.5 animate-spin text-text-primary" />
          </div>
        ) : (
          <div className="overflow-hidden w-0 opacity-0 -ml-3 transition-all duration-200 ease-in-out group-hover:w-[22px] group-hover:opacity-100 group-hover:ml-0">
            <div
              className={clsx(
                'flex items-center justify-center rounded-full p-1 transition-colors duration-200 z-10',
                isActive ? 'hover:bg-bg-fourth' : 'hover:bg-bg-tertiary-strong',
              )}
              onClick={handleClose}
            >
              <MdClose className="h-3.5 w-3.5 opacity-60 hover:opacity-100 transition-opacity duration-200" />
            </div>
          </div>
        ))}
    </>
  );
};
