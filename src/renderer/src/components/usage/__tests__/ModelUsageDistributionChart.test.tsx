import { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UsageDataRow } from '@common/types';

import { ModelDistributionMetric, ModelUsageDistributionChart } from '../ModelUsageDistributionChart';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
  PieChart: ({ children }: { children: ReactNode }) => children,
  Pie: ({ data, dataKey, children }: { data: unknown[]; dataKey: string; children: ReactNode }) => (
    <div>
      <pre data-testid="pie-data">{JSON.stringify(data)}</pre>
      <span data-testid="pie-metric">{dataKey}</span>
      {children}
    </div>
  ),
  Cell: ({ fill }: { fill: string }) => <span data-testid="slice-color">{fill}</span>,
  Tooltip: () => null,
  Legend: () => null,
}));

const createRow = (overrides: Partial<UsageDataRow> = {}): UsageDataRow => ({
  timestamp: '2026-11-14T12:00:00Z',
  project: '/project',
  model: 'cheap-model',
  input_tokens: 600,
  output_tokens: 400,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  cost: 1,
  ...overrides,
});

const data = [
  createRow(),
  createRow({ project: '/other-project' }),
  createRow({ model: 'expensive-model', input_tokens: 100, output_tokens: 100, cost: 6 }),
  createRow({ model: 'free-model', cost: 0 }),
];

describe('ModelUsageDistributionChart', () => {
  it('aggregates and sorts models by cost, excluding zero-cost models', () => {
    render(<ModelUsageDistributionChart data={data} metric={ModelDistributionMetric.Cost} />);

    expect(screen.getByRole('heading')).toHaveTextContent('usageDashboard.charts.modelCostDistribution');
    expect(screen.getByTestId('pie-metric')).toHaveTextContent('cost');
    expect(JSON.parse(screen.getByTestId('pie-data').textContent!)).toEqual([
      { model: 'expensive-model', totalTokens: 200, cost: 6, percentage: 75 },
      { model: 'cheap-model', totalTokens: 2000, cost: 2, percentage: 25 },
    ]);
  });

  it('preserves token-based distribution by default, including free models', () => {
    render(<ModelUsageDistributionChart data={data} />);

    expect(screen.getByRole('heading')).toHaveTextContent('usageDashboard.charts.modelUsageDistribution');
    expect(screen.getByTestId('pie-metric')).toHaveTextContent('totalTokens');
    expect(JSON.parse(screen.getByTestId('pie-data').textContent!)).toEqual([
      { model: 'cheap-model', totalTokens: 2000, cost: 2, percentage: 62.5 },
      { model: 'free-model', totalTokens: 1000, cost: 0, percentage: 31.25 },
      { model: 'expensive-model', totalTokens: 200, cost: 6, percentage: 6.25 },
    ]);
  });

  it.each([{ rows: [] }, { rows: [createRow({ cost: 0 })] }])('shows a titled empty state when no positive costs exist: $rows', ({ rows }) => {
    render(<ModelUsageDistributionChart data={rows} metric={ModelDistributionMetric.Cost} />);

    expect(screen.getByRole('heading')).toHaveTextContent('usageDashboard.charts.modelCostDistribution');
    expect(screen.getByText('usageDashboard.charts.noData')).toBeInTheDocument();
    expect(screen.queryByTestId('pie-data')).not.toBeInTheDocument();
  });

  it('includes recorded costs even when token counts are zero', () => {
    render(<ModelUsageDistributionChart data={[createRow({ input_tokens: 0, output_tokens: 0, cost: 0.000001 })]} metric={ModelDistributionMetric.Cost} />);

    expect(JSON.parse(screen.getByTestId('pie-data').textContent!)).toEqual([{ model: 'cheap-model', totalTokens: 0, cost: 0.000001, percentage: 100 }]);
  });

  it('updates the distribution when filtered data changes', () => {
    const { rerender } = render(<ModelUsageDistributionChart data={data} metric={ModelDistributionMetric.Cost} />);

    rerender(<ModelUsageDistributionChart data={[data[0]]} metric={ModelDistributionMetric.Cost} />);

    expect(JSON.parse(screen.getByTestId('pie-data').textContent!)).toEqual([{ model: 'cheap-model', totalTokens: 1000, cost: 1, percentage: 100 }]);
  });

  it('keeps model colors consistent when switching metrics', () => {
    const paidData = data.filter((row) => row.cost > 0);
    const { rerender } = render(<ModelUsageDistributionChart data={paidData} />);
    const tokenColors = screen.getAllByTestId('slice-color').map((element) => element.textContent);

    rerender(<ModelUsageDistributionChart data={paidData} metric={ModelDistributionMetric.Cost} />);

    expect(screen.getAllByTestId('slice-color').map((element) => element.textContent)).toEqual(tokenColors.toReversed());
  });
});
