import type { RenderProcessGoneDetails } from 'electron';

import logger from '@/logger';

type RecoveryOptions = {
  reload: () => void;
  isUnavailable: () => boolean;
};

export const createRendererRecoveryHandler = ({ reload, isUnavailable }: RecoveryOptions) => {
  const maxConsecutiveCrashes = 5;
  const crashLoopResetMs = 30_000;
  let consecutiveCrashes = 0;
  let lastCrashTimestamp = 0;

  const onProcessGone = (details: RenderProcessGoneDetails) => {
    if (isUnavailable() || details.reason === 'clean-exit') {
      return;
    }
    const now = Date.now();
    consecutiveCrashes = now - lastCrashTimestamp < crashLoopResetMs ? consecutiveCrashes + 1 : 1;
    lastCrashTimestamp = now;
    if (consecutiveCrashes > maxConsecutiveCrashes) {
      logger.error(
        `Renderer process crashed ${consecutiveCrashes} times in quick succession (reason: ${details.reason}, exit code: ${details.exitCode}); giving up auto-reload`,
      );
      return;
    }
    logger.warn(
      `Renderer process gone (reason: ${details.reason}, exit code: ${details.exitCode}), reloading window (consecutive crash ${consecutiveCrashes}/${maxConsecutiveCrashes})`,
    );
    setTimeout(() => {
      if (!isUnavailable()) {
        reload();
      }
    }, 1000);
  };

  const onUnresponsive = () => {
    if (isUnavailable()) {
      return;
    }
    logger.warn('Renderer process became unresponsive, reloading window');
    reload();
  };

  return { onProcessGone, onUnresponsive };
};
