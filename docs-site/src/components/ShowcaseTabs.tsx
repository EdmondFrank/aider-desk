import { useState } from 'react';
import { clsx } from 'clsx';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {
  FolderIcon,
  GitBranchIcon,
  LayersIcon,
  TerminalIcon,
  PuzzleIcon,
  EyeIcon,
  CheckIcon,
  ArrowRightIcon,
  SparklesIcon,
} from './Icons';
import styles from './ShowcaseTabs.module.css';

export enum ShowcaseTab {
  Projects = 'projects',
  Worktrees = 'worktrees',
  Memory = 'memory',
  Subtasks = 'subtasks',
  DiffReview = 'diff-review',
  Aider = 'aider',
  Extensions = 'extensions',
}

type TabConfig = {
  id: ShowcaseTab;
  tabLabel: string;
  tabBadge: string;
  icon: typeof FolderIcon;
  tag: string;
  title: string;
  description: string;
  bullets: string[];
  docLink: string;
  docLinkText: string;
  imageSrc: string;
  imageAlt: string;
  imageCaption: string;
};

const TABS: TabConfig[] = [
  {
    id: ShowcaseTab.Projects,
    tabLabel: 'Projects',
    tabBadge: 'Workspace',
    icon: FolderIcon,
    tag: 'Workspace Management',
    title: 'Multi-Project & Task Workspaces',
    description:
      'Manage multiple code repositories simultaneously with tabbed project workspaces, independent context files, and persistent task state tracking. Switch between active workstreams instantly without losing context.',
    bullets: [
      'Concurrent repository tabs with per-project settings and model preferences',
      'Task lifecycle management with state filters (TODO, In Progress, Review, Done)',
      'Instant context switching between active workstreams with zero restart time',
      'Global command palette (Ctrl+Shift+P) for fast repository and file navigation',
    ],
    docLink: '/docs/getting-started/managing-projects',
    docLinkText: 'Explore Project & Task Management',
    imageSrc: '/img/features/gs-project-tabs-switching.png',
    imageAlt: 'AiderDesk Multi-Project Tab Interface',
    imageCaption: 'Project Tabs & Task Workspace',
  },
  {
    id: ShowcaseTab.Worktrees,
    tabLabel: 'Worktrees',
    tabBadge: 'Git Isolation',
    icon: GitBranchIcon,
    tag: 'Filesystem Sandboxing',
    title: 'Parallel Git Worktrees (Zero Branch Pollution)',
    description:
      'Every task runs in an isolated Git worktree on its own branch. Run speculative refactors, parallel experiments, or long-running tasks simultaneously without dirtying your main branch or active IDE checkout.',
    bullets: [
      'True filesystem isolation: your active branch and uncommitted files remain untouched',
      'One-click worktree creation directly when launching any new task',
      'Visual merge dialog with squash, rebase, and fast-forward strategies',
      'Safe branch cleanup and instant discard if you reject the AI output',
    ],
    docLink: '/docs/features/git-worktrees',
    docLinkText: 'Read Git Worktrees Guide',
    imageSrc: '/img/features/worktree-merge-options.png',
    imageAlt: 'AiderDesk Git Worktree Options and Merge Dialog',
    imageCaption: 'Worktree Branch Isolation & Merging',
  },
  {
    id: ShowcaseTab.Memory,
    tabLabel: 'Memory',
    tabBadge: 'Evolving Context',
    icon: SparklesIcon,
    tag: 'Project Knowledge',
    title: 'Evolving Project Memory',
    description:
      'AiderDesk remembers your project conventions, architectural decisions, and past fixes across sessions—so agents stop repeating the same mistakes and get smarter on your codebase over time. All stored locally with vector search.',
    bullets: [
      'Durable project knowledge: preferences, architectural decisions, and recurring patterns',
      'Agents retrieve relevant context automatically at the start of every task',
      '100% local vector database (LanceDB) with local embedding models',
      'Full memory management in Settings: browse, filter, and delete what the agent has learned',
    ],
    docLink: '/docs/agent-mode/memory',
    docLinkText: 'Read the Memory Guide',
    imageSrc: '/img/features/agent-memory-tools.gif',
    imageAlt: 'Enabling Memory Tools in AiderDesk Agent Settings',
    imageCaption: 'Project Memory: Store & Retrieve Knowledge',
  },
  {
    id: ShowcaseTab.Subtasks,
    tabLabel: 'Subtasks',
    tabBadge: 'Delegation',
    icon: LayersIcon,
    tag: 'Autonomous Delegation',
    title: 'Autonomous Subtasks & Background Work',
    description:
      'Give the agent complex features or multi-step refactors. It automatically breaks requirements into subtasks, coordinates work in background worktrees, and updates progress on a visual task board without blocking your editor.',
    bullets: [
      'Automatic task decomposition into parent-child subtask hierarchies',
      'Background execution so you can keep working while the agent codes',
      'Granular approval modes: fully autonomous, guided with tool pauses, or manual',
      'Semantic search across past task conversations, decisions, and files',
    ],
    docLink: '/docs/agent-mode/task-management',
    docLinkText: 'Learn About Subtasks & Agents',
    imageSrc: '/img/features/subtasks-tree.png',
    imageAlt: 'AiderDesk Subtasks Tree and Task Hierarchy',
    imageCaption: 'Subtask Hierarchy & Background Orchestration',
  },
  {
    id: ShowcaseTab.DiffReview,
    tabLabel: 'Diff Viewer',
    tabBadge: 'Observability',
    icon: EyeIcon,
    tag: 'Total Control',
    title: 'Visual Side-by-Side Diff Review & Undo',
    description:
      'Review code changes with confidence. Side-by-side split diffs, syntax highlighting, line-by-line acceptance, inline feedback prompts, and instant recovery if an agent takes a wrong turn.',
    bullets: [
      'Side-by-side and unified diff views with syntax highlighting',
      'Inline comments that send targeted instructions back to the agent',
      'Granular accept, reject, or edit changes before saving',
      'Full undo/redo checkpoint history with git commit rollback',
    ],
    docLink: '/docs/core/reviewing-changes',
    docLinkText: 'Learn About Diff Reviewing',
    imageSrc: '/img/features/diff-viewer-modes.gif',
    imageAlt: 'AiderDesk Side-by-side and Unified Diff Reviewer',
    imageCaption: 'Side-by-Side Diff Review & Rollback',
  },
  {
    id: ShowcaseTab.Aider,
    tabLabel: 'Aider Mode',
    tabBadge: 'Surgical',
    icon: TerminalIcon,
    tag: 'Surgical Editing',
    title: 'Native Aider Modes for Fast, Targeted Edits',
    description:
      'Not every coding problem needs an open-ended autonomous agent loop. When you have a focused bugfix or precise modification, switch to native Aider chat modes (/code, /architect, /ask) for instant, token-efficient surgical changes powered by Aider’s battle-tested diff-patch engine.',
    bullets: [
      'Pinpoint surgical edits with /code mode — direct, fast, and zero prompt bloat',
      'Architect mode (/architect) pairs high-reasoning architect models with fast editor models',
      'Aider’s diff-patch formats prevent hallucinations and preserve formatting and comments',
      'Switch seamlessly between autonomous Agent Mode and surgical Aider Mode on any turn',
    ],
    docLink: '/docs/core/chat-modes',
    docLinkText: 'Read About Aider Chat Modes',
    imageSrc: '/img/features/core-chat-modes-selector.png',
    imageAlt: 'AiderDesk Chat Mode Selector with Aider Modes',
    imageCaption: 'Aider Modes: Code, Architect, Ask & Agent',
  },
  {
    id: ShowcaseTab.Extensions,
    tabLabel: 'Extensions',
    tabBadge: 'Developer SDK',
    icon: PuzzleIcon,
    tag: 'Ecosystem & SDK',
    title: 'Extensions & Community Gallery',
    description:
      'Customize and expand AiderDesk with custom extensions and procedural skills tailored to your workflow. Hook into lifecycle events, register custom slash commands, install community extensions from the built-in gallery, or build custom UI tools.',
    bullets: [
      'In-app Extension Gallery with one-click install, enable, and update',
      'Extension API with access to tools, commands, and app events',
      'Reusable procedural Skills (SKILL.md) for domain-specific agent knowledge',
      'Headless REST and WebSocket APIs for external CI/CD integrations',
    ],
    docLink: '/docs/extensions',
    docLinkText: 'Discover Extensions & Gallery',
    imageSrc: '/img/features/extensions.gif',
    imageAlt: 'AiderDesk Extensions Gallery and Settings',
    imageCaption: 'In-App Extension Gallery & Configuration',
  },
];

type Props = {
  className?: string;
};

export const ShowcaseTabs = ({ className }: Props) => {
  const [activeTabId, setActiveTabId] = useState<ShowcaseTab>(ShowcaseTab.Projects);

  const currentTab = TABS.find((t) => t.id === activeTabId) || TABS[0];

  return (
    <div className={clsx(styles.showcaseWrapper, className)}>
      <div className={styles.tabNav} role="tablist">
        {TABS.map((tab) => {
          const IconComponent = tab.icon;
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={clsx(styles.tabButton, isActive && styles.tabButtonActive)}
              onClick={() => setActiveTabId(tab.id)}
            >
              <IconComponent className={styles.tabIcon} size={16} />
              <div className={styles.tabTextCol}>
                <span className={styles.tabTitle}>{tab.tabLabel}</span>
                <span className={styles.tabSubtitle}>{tab.tabBadge}</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className={styles.tabContent}>
        <div className={styles.infoCol}>
          <div className={styles.featureTag}>{currentTab.tag}</div>
          <h3 className={styles.featureTitle}>{currentTab.title}</h3>
          <p className={styles.featureDescription}>{currentTab.description}</p>

          <ul className={styles.bulletList}>
            {currentTab.bullets.map((bullet) => (
              <li key={bullet} className={styles.bulletItem}>
                <div className={styles.checkIconWrapper}>
                  <CheckIcon size={14} />
                </div>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>

          <div className={styles.docLinkWrapper}>
            <Link to={currentTab.docLink} className={styles.docLink}>
              <span>{currentTab.docLinkText}</span>
              <ArrowRightIcon size={14} />
            </Link>
          </div>
        </div>

        <div className={styles.previewCol}>
          <div className={styles.windowFrame}>
            <div className={styles.windowChrome}>
              <div className={styles.dots}>
                <span className={clsx(styles.dot, styles.dotRed)} />
                <span className={clsx(styles.dot, styles.dotYellow)} />
                <span className={clsx(styles.dot, styles.dotGreen)} />
              </div>
              <span className={styles.windowTitle}>{currentTab.imageCaption}</span>
              <div className={styles.windowStatus}>
                <span className={styles.statusLive}>AiderDesk UI</span>
              </div>
            </div>
            <div className={styles.imageContent}>
              <img
                src={useBaseUrl(currentTab.imageSrc)}
                alt={currentTab.imageAlt}
                className={styles.realScreenshot}
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
