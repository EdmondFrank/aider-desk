import { existsSync, readFileSync } from 'fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('getAppVersion', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.AIDER_DESK_VERSION;
  });

  afterEach(() => {
    delete process.env.AIDER_DESK_VERSION;
    vi.mocked(existsSync).mockReset();
    vi.mocked(readFileSync).mockReset();
  });

  it('returns the AIDER_DESK_VERSION env override when set', async () => {
    process.env.AIDER_DESK_VERSION = '9.9.9-env';
    const { getAppVersion } = await import('@/app');
    expect(getAppVersion()).toBe('9.9.9-env');
  });

  it('resolves the version from the nearest AiderDesk package.json walking up from __dirname', async () => {
    // Simulates the headless layout: bundle in out/server, AiderDesk package.json two levels up (Docker: /app/package.json)
    vi.mocked(existsSync).mockImplementation((path) => String(path) === `${process.cwd()}/package.json`);
    vi.mocked(readFileSync).mockImplementation(() => JSON.stringify({ name: 'aider-desk', version: '8.8.8-sim' }));
    const { getAppVersion } = await import('@/app');
    expect(getAppVersion()).toBe('8.8.8-sim');
  });

  it('ignores package.json files that are not AiderDesk packages', async () => {
    vi.mocked(existsSync).mockImplementation((path) => String(path) === `${process.cwd()}/package.json`);
    vi.mocked(readFileSync).mockImplementation(() => JSON.stringify({ name: 'some-other-package', version: '1.0.0' }));
    const { getAppVersion } = await import('@/app');
    expect(getAppVersion()).toBe('unknown');
  });

  it('caches the resolved version after the first call', async () => {
    process.env.AIDER_DESK_VERSION = '1.0.0-cache';
    const { getAppVersion } = await import('@/app');
    expect(getAppVersion()).toBe('1.0.0-cache');
    process.env.AIDER_DESK_VERSION = '2.0.0-changed';
    expect(getAppVersion()).toBe('1.0.0-cache');
  });
});
