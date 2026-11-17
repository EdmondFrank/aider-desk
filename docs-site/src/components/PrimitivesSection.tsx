import { clsx } from 'clsx';
import Link from '@docusaurus/Link';
import {
  GitBranchIcon,
  SparklesIcon,
  EyeIcon,
  ShieldIcon,
  PuzzleIcon,
  TerminalIcon,
  ArrowRightIcon,
} from './Icons';
import styles from './PrimitivesSection.module.css';

type PrimitiveItem = {
  title: string;
  description: string;
  icon: typeof GitBranchIcon;
  badge: string;
  link: string;
};

const PRIMITIVES: PrimitiveItem[] = [
  {
    title: 'Evolving Memory',
    description:
      'AiderDesk remembers your project conventions, architectural decisions, and past fixes across sessions. Agents stop repeating the same mistakes and get measurably smarter on your codebase over time.',
    icon: SparklesIcon,
    badge: 'Compounding Context',
    link: '/docs/agent-mode/memory',
  },
  {
    title: 'Parallel Git Worktree Sandboxes',
    description:
      'Every task runs on a dedicated Git branch in an isolated worktree. Let agents experiment boldly and run tests in parallel while your primary working directory and active editor stay completely untouched.',
    icon: GitBranchIcon,
    badge: 'Safe Sandboxing',
    link: '/docs/features/git-worktrees',
  },
  {
    title: 'Durable Execution',
    description:
      'Crash-proof agent runs backed by SQLite execution journals. Checkpoint tool intent and outcomes so interrupted tasks and subagents resume mid-flight after restarts—with zero duplicate side effects or wasted tokens.',
    icon: TerminalIcon,
    badge: 'Crash-Proof Journals',
    link: '/docs/features/task-recovery',
  },
  {
    title: 'Powerful Extension API',
    description:
      'Create custom TypeScript extensions, lifecycle hooks, slash commands, and procedural skills tailored specifically for your workflow—extending AiderDesk to match how you ship software.',
    icon: PuzzleIcon,
    badge: 'Developer Extensible',
    link: '/docs/extensions',
  },
  {
    title: 'Local-First & Direct API Access',
    description:
      'Your code never routes through third-party proxy servers. Connect directly to 15+ LLM providers with your own API keys, or run 100% offline with local Ollama weights for complete privacy.',
    icon: ShieldIcon,
    badge: 'Zero Markup & Privacy',
    link: '/docs/configuration/providers',
  },
  {
    title: 'Review Intent, Not Just Syntax',
    description:
      'Solve the high-throughput review bottleneck. Inspect every change in side-by-side diffs, leave inline feedback, roll back any checkpoint, and accept verified work with a single click.',
    icon: EyeIcon,
    badge: 'Total Observability',
    link: '/docs/core/reviewing-changes',
  },
];

type Props = {
  className?: string;
};

export const PrimitivesSection = ({ className }: Props) => {
  return (
    <section className={clsx(styles.section, className)}>
      <div className={styles.header}>
        <div className={styles.sectionBadge}>Core Guarantees</div>
        <h2 className={styles.heading}>Engineered for developer control & safety</h2>
        <p className={styles.subheading}>
          No black-box magic, no surprise file overwrites, and no dirty git trees. AiderDesk is built around foundational guarantees that give you total safety and transparent control.
        </p>
      </div>

      <div className={styles.grid}>
        {PRIMITIVES.map((item) => {
          const IconComponent = item.icon;
          return (
            <div key={item.title} className={styles.card}>
              <div className={styles.cardTop}>
                <div className={styles.iconBox}>
                  <IconComponent size={20} />
                </div>
                <span className={styles.badge}>{item.badge}</span>
              </div>
              <h3 className={styles.cardTitle}>{item.title}</h3>
              <p className={styles.cardText}>{item.description}</p>
              <Link to={item.link} className={styles.cardLink}>
                <span>Learn more</span>
                <ArrowRightIcon size={14} />
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
};
