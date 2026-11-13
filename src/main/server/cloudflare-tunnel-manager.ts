import { CloudflareTunnelStatus } from '@common/types';

import { CLOUDFLARED_BINARY_PATH, SERVER_PORT } from '@/constants';
import logger from '@/logger';
import { isDev } from '@/app';

// Minimal shape of the parts of `cloudflared` we use. Typed locally so the package can stay
// uninstalled in the lite fork (see docs/lite-fork.md) without breaking the build.
type TunnelProcess = {
  once(event: 'url' | 'connected', listener: (value: string) => void): void;
  on(event: 'exit', listener: (code: number | null) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  stop(): void;
};

type CloudflaredModule = {
  Tunnel: { quick: (url: string) => TunnelProcess };
  use: (binaryPath: string) => void;
};

// Resolved at runtime only: the lite fork does not install `cloudflared` and never starts a tunnel.
const CLOUDFLARED_MODULE = 'cloudflared';

export class CloudflareTunnelManager {
  private tunnel?: TunnelProcess;
  private tunnelUrl?: string;

  async start(): Promise<void> {
    if (this.tunnel) {
      throw new Error('Tunnel is already running');
    }

    let cloudflared: CloudflaredModule;
    try {
      cloudflared = (await import(/* @vite-ignore */ CLOUDFLARED_MODULE)) as CloudflaredModule;
    } catch {
      throw new Error('Cloudflare tunnel is unavailable: the `cloudflared` package is not installed in this build');
    }

    const { Tunnel, use: setCloudflaredBinary } = cloudflared;

    if (!isDev()) {
      // set cloudflared binary path only in production app
      setCloudflaredBinary(CLOUDFLARED_BINARY_PATH);
    }

    const port = isDev() ? 5173 : SERVER_PORT;
    logger.info('Starting tunnel...', { port });
    this.tunnel = Tunnel.quick(`http://localhost:${port}`);

    try {
      // Wait for URL
      const url = new Promise<string>((resolve) => this.tunnel!.once('url', resolve));
      this.tunnelUrl = await url;
      logger.info('Tunnel URL extracted:', { url: this.tunnelUrl });

      // Wait for connection
      const conn = new Promise((resolve) => this.tunnel!.once('connected', resolve));
      await conn;
      logger.info('Tunnel connected');
    } catch (error) {
      logger.error('Failed to start tunnel:', error);
      this.tunnel = undefined;
      this.tunnelUrl = undefined;
      throw error;
    }

    // Keep listeners for ongoing events
    this.tunnel.on('exit', (code: number | null) => {
      logger.info('Tunnel exited with code:', code);
      this.tunnel = undefined;
      this.tunnelUrl = undefined;
    });

    this.tunnel.on('error', (err: Error) => {
      logger.error('Tunnel error:', err);
      this.tunnel = undefined;
      this.tunnelUrl = undefined;
    });
  }

  stop(): void {
    if (this.tunnel) {
      this.tunnel.stop();
      this.tunnel = undefined;
      this.tunnelUrl = undefined;
    }
  }

  getStatus(): CloudflareTunnelStatus {
    return {
      isRunning: !!this.tunnel,
      url: this.tunnelUrl,
    };
  }
}
