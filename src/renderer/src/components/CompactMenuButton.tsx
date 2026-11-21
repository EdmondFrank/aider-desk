import { Mode, TaskData } from '@common/types';
import { MouseEvent as ReactMouseEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MdCompress } from 'react-icons/md';
import { RiChatQuoteLine, RiScissorsCutLine } from 'react-icons/ri';
import { clsx } from 'clsx';

import { useApi } from '@/contexts/ApiContext';
import { useClickOutside } from '@/hooks/useClickOutside';
import { Tooltip } from '@/components/ui/Tooltip';

type Props = {
  task: TaskData;
  mode: Mode;
};

export const CompactMenuButton = ({ task, mode }: Props) => {
  const { t } = useTranslation();
  const api = useApi();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  useClickOutside([menuRef, buttonRef], () => setIsMenuOpen(false), isMenuOpen);

  const handleToggleMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setIsMenuOpen(!isMenuOpen);
  };

  const handleCompact = () => {
    setIsMenuOpen(false);
    api.compactConversation(task.baseDir, task.id, mode);
  };

  const handleSmartCompact = () => {
    setIsMenuOpen(false);
    void api.smartCompactConversation(task.baseDir, task.id);
  };

  const menuOptions = [
    { label: t('costInfo.compact'), icon: <RiChatQuoteLine className="w-3.5 h-3.5" />, action: handleCompact },
    { label: t('costInfo.smartCompact'), icon: <RiScissorsCutLine className="w-3.5 h-3.5" />, action: handleSmartCompact },
  ];

  const renderTriggerButton = () => (
    <button
      className="p-1 hover:bg-bg-tertiary rounded-md text-text-muted hover:text-text-tertiary transition-colors"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={handleToggleMenu}
    >
      <MdCompress className="w-4 h-4" />
    </button>
  );

  return (
    <div className="relative">
      <div
        ref={buttonRef}
        className={clsx(
          'ml-0 max-w-0 opacity-0 overflow-hidden transition-all duration-300',
          isMenuOpen ? 'max-w-xs opacity-100 px-1 ml-1' : 'group-hover:max-w-xs group-hover:opacity-100 group-hover:px-1 group-hover:ml-1',
        )}
      >
        {isMenuOpen ? (
          renderTriggerButton()
        ) : (
          <Tooltip content={t('costInfo.compactConversation')} side="top">
            {renderTriggerButton()}
          </Tooltip>
        )}
      </div>
      {isMenuOpen && (
        <div ref={menuRef} className="absolute right-0 bottom-full mb-1 w-[150px] bg-bg-secondary border border-border-default-dark rounded shadow-lg z-50">
          <ul>
            {menuOptions.map((option, index) => (
              <li
                key={index}
                className="flex items-center gap-2 px-2 py-1 text-2xs text-text-primary hover:bg-bg-tertiary cursor-pointer transition-colors"
                onClick={option.action}
              >
                <span className="w-4 h-4 flex items-center justify-center">{option.icon}</span>
                <span className="whitespace-nowrap">{option.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
