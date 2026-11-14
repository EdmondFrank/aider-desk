// @vitest-environment jsdom

import { runInNewContext } from 'vm';
import { createElement, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CgSpinner } from 'react-icons/cg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { transpileJsxString } from '../../../../common/src/jsx-transpiler';
import template from '../InitializationBanner.jsx?raw';

const factory = runInNewContext(transpileJsxString(template).replace('export default', ''), { setTimeout, clearTimeout, Date }) as (
  react: object,
) => ComponentType<Record<string, unknown>>;
const Banner = factory({ createElement, useEffect, useState });

const setup = () => ({
  task: { id: 'task' },
  agentProfile: { id: 'profile', includeRepoMap: true },
  data: { key: 'checkout', status: 'initializing', waiting: false, background: false },
  executeExtensionAction: vi.fn(async () => undefined),
  ui: { Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => createElement('button', { onClick }, children) },
  icons: { Cg: { CgSpinner } },
});

afterEach(cleanup);

describe('repository initialization banner', () => {
  it('starts initialization on mount and shows the cancel action', async () => {
    const props = setup();
    render(createElement(Banner, props));
    await waitFor(() => expect(props.executeExtensionAction).toHaveBeenCalledWith('initialize'));
    expect(screen.getByText('Initializing repository map…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel initialization' }));
    expect(props.executeExtensionAction).toHaveBeenCalledWith('cancel', 'checkout');
  });

  it('offers continuing without a map only while the agent is waiting', async () => {
    const props = setup();
    render(createElement(Banner, { ...props, data: { ...props.data, waiting: true } }));
    expect(screen.getByText('Agent is waiting for the repository map…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue without map' }));
    await waitFor(() => expect(props.executeExtensionAction).toHaveBeenCalledWith('background', 'checkout'));
  });

  it('hides for disabled profiles and rechecks when the selected profile changes', async () => {
    const props = setup();
    const view = render(createElement(Banner, { ...props, agentProfile: { id: 'disabled', includeRepoMap: false } }));
    expect(screen.queryByRole('status')).toBeNull();
    await waitFor(() => expect(props.executeExtensionAction).toHaveBeenCalledTimes(1));
    view.rerender(createElement(Banner, props));
    await waitFor(() => expect(props.executeExtensionAction).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('shows background progress without another continue button', () => {
    const props = setup();
    render(createElement(Banner, { ...props, data: { ...props.data, background: true } }));
    expect(screen.getByText('Initialization continues in the background. This run will not include a repository map.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue without map' })).toBeNull();
  });

  it('offers explicit retry after cancellation and hides old ready messages', () => {
    const props = setup();
    const view = render(createElement(Banner, { ...props, data: { ...props.data, status: 'cancelled' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry initialization' }));
    expect(props.executeExtensionAction).toHaveBeenCalledWith('retry', 'checkout');
    view.rerender(createElement(Banner, { ...props, data: { ...props.data, status: 'ready', completedAt: Date.now() - 4000 } }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
