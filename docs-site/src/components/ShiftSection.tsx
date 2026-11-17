import { clsx } from 'clsx';
import styles from './ShiftSection.module.css';

type ShiftPoint = {
  step: string;
  title: string;
  description: string;
};

const SHIFT_POINTS: ShiftPoint[] = [
  {
    step: '01',
    title: 'Generation is cheap. Review is the bottleneck.',
    description:
      'Execution is separated from review via side-by-side diffs, checkpoint rollbacks, and explicit approval gates so you stay in command.',
  },
  {
    step: '02',
    title: 'One chat window is too slow.',
    description:
      'Spin up parallel background tasks in isolated Git worktrees while you stay focused on architecture and high-leverage decisions.',
  },
  {
    step: '03',
    title: 'Your workflow, your keys, your privacy.',
    description:
      'Zero proxy markup, BYOK or local Ollama weights—your code stays on your machine, never routed through middleman servers.',
  },
];

type Props = {
  className?: string;
};

export const ShiftSection = ({ className }: Props) => {
  return (
    <section className={clsx(styles.section, className)}>
      <div className={styles.header}>
        <div className={styles.sectionBadge}>The Shift</div>
        <h2 className={styles.heading}>Coding changed. Most tools didn&apos;t.</h2>
        <p className={styles.subheading}>
          The hard part isn&apos;t generating code anymore—it&apos;s reviewing, coordinating, and keeping control of your architecture.
        </p>
      </div>

      <div className={styles.grid}>
        {SHIFT_POINTS.map((point) => (
          <div key={point.step} className={styles.card}>
            <div className={styles.step}>{point.step}</div>
            <h3 className={styles.cardTitle}>{point.title}</h3>
            <p className={styles.cardText}>{point.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
};
