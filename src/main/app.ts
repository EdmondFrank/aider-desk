import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

import type { App } from 'electron';

export const isElectron = (): boolean => {
  try {
    return process.versions.electron !== undefined;
  } catch {
    return false;
  }
};

let electronApp: App | null = null;
export const getElectronApp = (): App | null => {
  if (!isElectron()) {
    return null;
  }
  if (electronApp) {
    return electronApp;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  electronApp = require('electron').app as App;
  return electronApp;
};

export const isDev = (): boolean => {
  if (isElectron()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { is } = require('@electron-toolkit/utils');
    return is.dev;
  }
  return process.env.NODE_ENV !== 'production';
};

const AIDER_DESK_PACKAGE_NAMES = new Set(['aider-desk', '@aiderdesk/aiderdesk']);

// Walk up from the bundle location to find the AiderDesk package.json: the npm package has it
// next to out/runner.js, the Docker image at /app/package.json above out/server/runner.js.
const findPackageVersion = (): string | null => {
  try {
    let dir = __dirname;
    for (let i = 0; i < 6; i++) {
      const pkgPath = join(dir, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (AIDER_DESK_PACKAGE_NAMES.has(pkg.name) && pkg.version) {
          return pkg.version;
        }
      }
      const parentDir = dirname(dir);
      if (parentDir === dir) {
        break;
      }
      dir = parentDir;
    }
  } catch {
    // fall through
  }
  return null;
};

let cachedAppVersion: string | null = null;
export const getAppVersion = (): string => {
  if (cachedAppVersion === null) {
    cachedAppVersion = process.env.AIDER_DESK_VERSION || getElectronApp()?.getVersion() || findPackageVersion() || 'unknown';
  }
  return cachedAppVersion;
};
