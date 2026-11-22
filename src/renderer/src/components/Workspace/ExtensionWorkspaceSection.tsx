import { Activity, memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import { ExtensionDisplayAPI } from '@common/api';
import { UIComponentProps } from '@common/extensions';
import { ExtensionUIComponent } from '@common/types';

import { SectionHeader } from './SectionHeader';

import { ExtensionComponentRenderer } from '@/components/extensions/ExtensionComponentRenderer';

type RendererProps = {
  componentProps: UIComponentProps;
  libraries: Record<string, Record<string, unknown>>;
  api: ExtensionDisplayAPI;
  currentProjectDir?: string;
  currentTaskId?: string;
  currentActionProjectDir?: string;
  currentActionTaskId?: string;
};

type Props = RendererProps & {
  component: ExtensionUIComponent;
  isOpen: boolean;
  onToggle: () => void;
  editMode?: boolean;
  isHidden?: boolean;
  onToggleHidden?: () => void;
  showBorderTop?: boolean;
};

const ExtensionWorkspaceSectionInner = ({
  component,
  componentProps,
  libraries,
  api,
  currentProjectDir,
  currentTaskId,
  currentActionProjectDir,
  currentActionTaskId,
  isOpen,
  onToggle,
  editMode,
  isHidden,
  onToggleHidden,
  showBorderTop,
}: Props) => {
  const renderedComponent = useMemo(
    () => (
      <ExtensionComponentRenderer
        component={component}
        componentProps={componentProps}
        libraries={libraries}
        currentProjectDir={currentProjectDir}
        currentTaskId={currentTaskId}
        currentActionProjectDir={currentActionProjectDir}
        currentActionTaskId={currentActionTaskId}
        api={api}
      />
    ),
    [component, componentProps, libraries, currentProjectDir, currentTaskId, currentActionProjectDir, currentActionTaskId, api],
  );

  return (
    <motion.div
      className={clsx('flex flex-col overflow-hidden min-h-[40px]', showBorderTop && 'border-t border-border-dark-light')}
      initial={false}
      animate={editMode ? { flexGrow: 0, flexShrink: 0 } : { flexGrow: isOpen ? 1 : 0, flexShrink: isOpen ? 1 : 0 }}
      transition={{ duration: 0.3, ease: 'easeIn' }}
    >
      <SectionHeader
        section={component.componentId}
        title={component.name ?? component.componentId}
        isOpen={isOpen}
        onToggle={onToggle}
        editMode={editMode}
        isHidden={isHidden}
        onToggleHidden={onToggleHidden}
      />
      <Activity mode={isOpen ? 'visible' : 'hidden'}>
        <motion.div
          className="flex-grow w-full overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-bg-tertiary scrollbar-track-bg-primary-light scrollbar-rounded pl-1 py-1 bg-bg-primary-light-strong relative"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
        >
          {renderedComponent}
        </motion.div>
      </Activity>
    </motion.div>
  );
};

export const ExtensionWorkspaceSection = memo(ExtensionWorkspaceSectionInner);
