// @vitest-environment jsdom

import { ComponentType, createElement, ReactNode } from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { transform } from 'sucrase';
import { afterEach, describe, expect, it } from 'vitest';

import source from '../AskQuestionToolMessage.jsx?raw';

const React = { createElement };
const componentModule: { exports?: ComponentType<Record<string, unknown>> } = {};
const compiled = transform(`module.exports = ${source}`, { transforms: ['jsx'] }).code;
new Function('React', 'module', compiled)({ createElement }, componentModule);
const ToolMessage = componentModule.exports!;

type Props = { title: ReactNode; content: ReactNode };
const ExpandableMessageBlock = ({ title, content }: Props) => (
  <section>
    <header>{title}</header>
    <div>{content}</div>
  </section>
);
const Icon = (props: Record<string, unknown>) => <span {...props} />;
const props = {
  ui: { ExpandableMessageBlock },
  icons: {
    Cg: { CgSpinner: Icon },
    Ri: { RiQuestionLine: Icon, RiCheckboxCircleFill: Icon, RiCloseCircleLine: Icon, RiErrorWarningFill: Icon },
  },
};
const renderMessage = (content = '', overrides: Record<string, unknown> = {}) =>
  render(<ToolMessage {...props} message={{ args: { question: 'Which approach?', options: ['Extend', 'Replace'] }, content, ...overrides }} />);

afterEach(cleanup);

describe('AskQuestionToolMessage', () => {
  it('shows a pending question and read-only options', () => {
    renderMessage();
    expect(screen.getByLabelText('Waiting for answer')).toBeInTheDocument();
    expect(screen.getByText('Extend')).toBeInTheDocument();
    expect(screen.getByText('Replace')).toBeInTheDocument();
    expect(screen.getByText('Waiting for your selection above the prompt field.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    JSON.stringify({ question: 'Which approach?', answer: 'Extend' }),
    JSON.stringify(JSON.stringify({ answer: 'Extend' })),
    JSON.stringify({ type: 'json', value: { answer: 'Extend' } }),
    JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ answer: 'Extend' }) }] }),
  ])('renders the selected answer from result format %s', (content) => {
    renderMessage(content);
    expect(screen.getByLabelText('Answered')).toBeInTheDocument();
    expect(screen.queryByText('Answer: Extend')).not.toBeInTheDocument();
    expect(screen.getAllByText('Which approach?')).toHaveLength(1);
    expect(screen.getByText('(Selected)').parentElement).toHaveTextContent('Extend');
    expect(screen.getAllByRole('listitem')[0]).toHaveClass('text-success');
    expect(screen.getAllByRole('listitem')[1]).not.toHaveClass('text-success');
  });

  it('shows cancellation separately from success or failure', () => {
    renderMessage(JSON.stringify({ cancelled: true, reason: 'User dismissed the question' }));
    expect(screen.getByLabelText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText('User dismissed the question')).toBeInTheDocument();
    expect(screen.queryByLabelText('Answered')).not.toBeInTheDocument();
  });

  it.each([
    'Error: Question tools are disabled',
    JSON.stringify({ type: 'error-text', value: 'Question tools are disabled' }),
    JSON.stringify({ isError: true, content: [{ type: 'text', text: 'Question tools are disabled' }] }),
  ])('renders tool errors safely: %s', (content) => {
    renderMessage(content);
    expect(screen.getByLabelText('Error')).toBeInTheDocument();
    expect(screen.getByText(/Question tools are disabled/)).toBeInTheDocument();
  });

  it('does not show an indefinite spinner for a finished message without output', () => {
    renderMessage('', { finished: true });
    expect(screen.queryByLabelText('Waiting for answer')).not.toBeInTheDocument();
    expect(screen.getByText('Question finished without an answer.')).toBeInTheDocument();
  });

  it('handles missing arguments and malformed output', () => {
    renderMessage('{broken json', { args: undefined });
    expect(screen.getByLabelText('Error')).toBeInTheDocument();
    expect(screen.getByText('{broken json')).toBeInTheDocument();
  });

  it('renders user-supplied text without interpreting HTML', () => {
    renderMessage(JSON.stringify({ answer: '<script>alert(1)</script>' }));
    expect(screen.getByText('Custom answer: <script>alert(1)</script>')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });
});
