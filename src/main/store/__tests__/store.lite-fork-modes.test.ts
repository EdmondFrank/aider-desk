/**
 * Tests for the lite fork's read-time mode fallback.
 *
 * The lite profile has no Python/Aider connector, so the fork used to rewrite the user's saved
 * settings on startup. These tests pin the replacement behaviour: any mode that points at Aider
 * is mapped to `agent` when it is read, and the stored value is never changed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProjectData, ProjectSettings } from '@common/types';

const confData = vi.hoisted(() => new Map<string, unknown>());
const confGet = vi.hoisted(() => vi.fn((key: string) => confData.get(key)));
const confSet = vi.hoisted(() =>
  vi.fn((key: string, value: unknown) => {
    confData.set(key, value);
  }),
);

vi.mock('conf', () => ({
  default: class {
    get = confGet;
    set = confSet;
  },
}));

vi.mock('@/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { Store } from '../store';

const baseDir = '/test/project';

const makeProject = (currentMode: string): ProjectData =>
  ({
    active: true,
    baseDir,
    settings: { currentMode } as ProjectSettings,
  }) as ProjectData;

describe('Store lite-fork mode fallback', () => {
  let store: Store;
  const originalLiteEnv = process.env.AIDER_DESK_LITE;

  beforeEach(async () => {
    confData.clear();
    store = new Store();
    await store.init();
  });

  afterEach(() => {
    if (originalLiteEnv === undefined) {
      delete process.env.AIDER_DESK_LITE;
    } else {
      process.env.AIDER_DESK_LITE = originalLiteEnv;
    }
  });

  describe('getSettings', () => {
    beforeEach(() => {
      confData.set('settings', { taskSettings: { defaultTaskMode: 'code', defaultProjectMode: 'architect' } });
    });

    it('maps aider-backed default modes to `agent` in the lite profile', () => {
      process.env.AIDER_DESK_LITE = 'true';

      expect(store.getSettings().taskSettings).toMatchObject({ defaultTaskMode: 'agent', defaultProjectMode: 'agent' });
    });

    it('leaves the stored settings untouched, so the full build still sees the user choice', () => {
      process.env.AIDER_DESK_LITE = 'true';

      store.getSettings();

      expect(confData.get('settings')).toEqual({ taskSettings: { defaultTaskMode: 'code', defaultProjectMode: 'architect' } });
      expect(confSet).not.toHaveBeenCalled();
    });

    it('keeps `last` and non-aider modes as they are', () => {
      process.env.AIDER_DESK_LITE = 'true';
      confData.set('settings', { taskSettings: { defaultTaskMode: 'last', defaultProjectMode: 'agent' } });

      expect(store.getSettings().taskSettings).toMatchObject({ defaultTaskMode: 'last', defaultProjectMode: 'agent' });
    });

    it('does not touch modes outside the lite profile', () => {
      process.env.AIDER_DESK_LITE = 'false';

      expect(store.getSettings().taskSettings).toMatchObject({ defaultTaskMode: 'code', defaultProjectMode: 'architect' });
    });
  });

  describe('getProjectSettings', () => {
    beforeEach(() => {
      confData.set('openProjects', [makeProject('code')]);
    });

    it('maps an aider project mode to `agent` in the lite profile without persisting it', () => {
      process.env.AIDER_DESK_LITE = 'true';

      expect(store.getProjectSettings(baseDir).currentMode).toBe('agent');
      expect(confData.get('openProjects')).toEqual([makeProject('code')]);
      expect(confSet).not.toHaveBeenCalled();
    });

    it('returns the stored project mode outside the lite profile', () => {
      process.env.AIDER_DESK_LITE = 'false';

      expect(store.getProjectSettings(baseDir).currentMode).toBe('code');
    });

    it('keeps a non-aider project mode', () => {
      process.env.AIDER_DESK_LITE = 'true';
      confData.set('openProjects', [makeProject('agent')]);

      expect(store.getProjectSettings(baseDir).currentMode).toBe('agent');
    });
  });
});
