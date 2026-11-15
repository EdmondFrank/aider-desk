import path from 'node:path';

import { LspClient } from './lsp-client';
import { findWorkspaceRoot, getServersForExtension, SERVERS } from './lsp-servers';
import { DEFAULT_CONFIG } from './config';
import { withDeadline } from './async';
import { resolvePath } from './paths';

import type { LspLogContext, LspServerInfo } from './lsp-servers';
import type { LspConfig } from './config';

enum DiscoveryFailure {
  NotApplicable = 'not-applicable',
  MissingExecutable = 'missing-executable',
  StartupFailed = 'startup-failed',
}

interface WorkspaceState {
  closed: boolean;
  controller: AbortController;
}

interface ClientEntry {
  client: LspClient;
  workspace: string;
  leases: number;
}

export class LspManager {
  private clients = new Map<string, ClientEntry>();
  private pending = new Map<string, Promise<LspClient | null>>();
  private failures = new Map<string, { expires: number; reason: DiscoveryFailure; message?: string }>();
  private acquiring = new Map<string, number>();
  private roots = new Map<string, { root: string; expires: number }>();
  private closed = false;
  private starting = 0;
  private slots = new Set<() => void>();
  private initializing = new Map<LspClient, string>();
  private capacity = Promise.resolve();
  private idleTimer: ReturnType<typeof setInterval>;
  private stopPromise?: Promise<void>;
  private workspaces = new Map<string, WorkspaceState>();

  constructor(
    private context: LspLogContext,
    private config: LspConfig = DEFAULT_CONFIG,
  ) {
    this.idleTimer = setInterval(
      () => {
        void this.evictIdle().catch((error) => this.context.log(`LSP idle cleanup: ${error}`, 'debug'));
      },
      Math.min(config.idleTimeoutMs, 30000),
    );
    this.idleTimer.unref();
  }

  private async rootFor(file: string, workspace: string, server: LspServerInfo, signal?: AbortSignal): Promise<string> {
    const override = this.config.workspaceRoots[workspace];
    if (override) return path.resolve(workspace, override);
    const key = JSON.stringify([workspace, path.dirname(file), server.id]);
    const cached = this.roots.get(key);
    if (cached && cached.expires > Date.now()) return cached.root;
    const root = await withDeadline(findWorkspaceRoot(file, workspace, server), this.config.requestTimeoutMs, signal);
    if (this.roots.size >= 256) this.roots.delete(this.roots.keys().next().value!);
    this.roots.set(key, {
      root,
      expires: Date.now() + this.config.discoveryRetryMs,
    });
    return root;
  }

  async getClient(filePath: string, projectDir: string, signal?: AbortSignal): Promise<LspClient | null> {
    signal?.throwIfAborted();
    if (this.closed) return null;
    const workspace = resolvePath(projectDir);
    let state = this.workspaces.get(workspace);
    if (!state) {
      state = { closed: false, controller: new AbortController() };
      this.workspaces.set(workspace, state);
    }
    if (state.closed) return null;
    signal = signal ? AbortSignal.any([signal, state.controller.signal]) : state.controller.signal;
    const file = resolvePath(workspace, filePath);
    let candidates = getServersForExtension(path.extname(file));
    const deno = candidates.find((server) => server.id === 'deno');
    if (deno) {
      const root = await this.rootFor(file, workspace, deno, signal);
      const matches = await withDeadline(deno.matches?.(root) ?? Promise.resolve(false), this.config.requestTimeoutMs, signal);
      candidates = this.config.servers.deno || matches ? [deno] : candidates.filter((server) => server !== deno);
    }
    for (const server of candidates) {
      const root = await this.rootFor(file, workspace, server, signal);
      if (this.closed || state.closed) return null;
      const key = JSON.stringify([workspace, root, server.id]);
      const entry = this.clients.get(key);
      if (entry?.client.alive) return entry.client;
      if (entry) {
        this.clients.delete(key);
        await entry.client.shutdown();
      }
      if ((this.failures.get(key)?.expires ?? 0) > Date.now()) continue;
      let pending = this.pending.get(key);
      if (!pending) {
        if (this.pending.size >= this.config.maxPendingOperations) return null;
        pending = this.start(server, root, workspace, key, state).finally(() => this.pending.delete(key));
        this.pending.set(key, pending);
      }
      const client = await withDeadline(pending, this.config.installTimeoutMs + this.config.requestTimeoutMs * 2 + 10000, signal);
      if (client) return client;
    }
    return null;
  }

  async withClient<T>(file: string, workspace: string, action: (client: LspClient) => Promise<T>, signal?: AbortSignal): Promise<T | undefined> {
    workspace = resolvePath(workspace);
    this.acquiring.set(workspace, (this.acquiring.get(workspace) ?? 0) + 1);
    let client: LspClient | null;
    try {
      client = await this.getClient(file, workspace, signal);
    } finally {
      const remaining = (this.acquiring.get(workspace) ?? 1) - 1;
      if (remaining) this.acquiring.set(workspace, remaining);
      else this.acquiring.delete(workspace);
    }
    if (!client?.alive) {
      const candidates = new Set(getServersForExtension(path.extname(file)).map((server) => server.id));
      const failures = [...this.failures].filter(([key]) => {
        const [failedWorkspace, , serverId] = JSON.parse(key) as string[];
        return failedWorkspace === workspace && candidates.has(serverId);
      });
      const reason = failures
        .map(([, failure]) => failure.message)
        .filter(Boolean)
        .join('; ');
      throw new Error(reason || 'No usable language server is available (server missing, stopped, or capacity exhausted).');
    }
    const entry = [...this.clients.values()].find((value) => value.client === client);
    if (!entry) return undefined;
    entry.leases++;
    try {
      return await action(client);
    } finally {
      entry.leases--;
    }
  }

  private reserve(): Promise<boolean> {
    const result = this.capacity.then(async () => {
      if (this.closed) return false;
      while (this.starting >= this.config.maxConcurrentStarts && !this.closed) {
        await new Promise<void>((resolve) => this.slots.add(resolve));
      }
      if (this.closed) return false;
      if (this.clients.size + this.starting >= this.config.maxServers) {
        const victim = [...this.clients.entries()]
          .filter(([key, entry]) => !this.pending.has(key) && !this.acquiring.has(entry.workspace) && !entry.leases && !entry.client.busy)
          .sort((a, b) => a[1].client.lastUsed - b[1].client.lastUsed)[0];
        if (!victim) return false;
        this.clients.delete(victim[0]);
        await victim[1].client.shutdown();
      }
      if (this.closed) return false;
      this.starting++;
      return true;
    });
    this.capacity = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async start(server: LspServerInfo, root: string, workspace: string, key: string, state: WorkspaceState): Promise<LspClient | null> {
    try {
      if (this.closed || state.closed) return null;
      if (
        !this.config.servers[server.id] &&
        server.matches &&
        !(await withDeadline(server.matches(root), this.config.requestTimeoutMs, state.controller.signal))
      ) {
        this.rememberFailure(key, DiscoveryFailure.NotApplicable);
        return null;
      }
      await withDeadline(
        server.prepare?.(root, this.context, this.config) ?? Promise.resolve(),
        this.config.installTimeoutMs + 1000,
        state.controller.signal,
      );
    } catch (error) {
      this.rememberFailure(key, DiscoveryFailure.StartupFailed, `${server.id}: ${error instanceof Error ? error.message : String(error)}`);
      this.context.log(`LSP ${server.id} setup failed: ${error}`, 'warn');
      return null;
    }
    if (!(await this.reserve())) {
      this.context.log('LSP server/startup capacity reached; skipping this request', 'debug');
      return null;
    }
    let client: LspClient | undefined;
    try {
      if (this.closed || state.closed) return null;
      if (
        !this.config.servers[server.id] &&
        server.matches &&
        !(await withDeadline(server.matches(root), this.config.requestTimeoutMs, state.controller.signal))
      ) {
        this.rememberFailure(key, DiscoveryFailure.NotApplicable);
        return null;
      }
      const spawning = server.spawn(root, this.context, this.config);
      let handle;
      try {
        handle = await withDeadline(spawning, this.config.requestTimeoutMs, state.controller.signal);
      } catch (error) {
        void spawning
          .then(async (lateHandle) => {
            if (lateHandle) {
              const orphan = new LspClient({ serverInfo: server, handle: lateHandle, rootDir: root, context: this.context, config: this.config });
              await orphan.shutdown();
            }
          })
          .catch((cleanupError) => this.context.log(`LSP late startup cleanup: ${cleanupError}`, 'debug'));
        throw error;
      }
      if (!handle) {
        this.rememberFailure(key, DiscoveryFailure.MissingExecutable);
        return null;
      }
      client = new LspClient({
        serverInfo: server,
        handle,
        rootDir: root,
        context: this.context,
        config: this.config,
      });
      this.initializing.set(client, workspace);
      if (this.closed || state.closed) {
        await client.shutdown();
        return null;
      }
      await client.initialize();
      if (this.closed || state.closed) {
        await client.shutdown();
        return null;
      }
      this.clients.set(key, { client, workspace, leases: 0 });
      this.failures.delete(key);
      return client;
    } catch (error) {
      await client?.shutdown();
      this.rememberFailure(key, DiscoveryFailure.StartupFailed, `${server.id}: ${error instanceof Error ? error.message : String(error)}`);
      this.context.log(`LSP ${server.id} startup failed: ${error}`, 'debug');
      return null;
    } finally {
      if (client) this.initializing.delete(client);
      this.starting--;
      for (const release of this.slots) release();
      this.slots.clear();
    }
  }

  private rememberFailure(key: string, reason: DiscoveryFailure, message?: string): void {
    if (this.failures.size >= 256) this.failures.delete(this.failures.keys().next().value!);
    this.failures.set(key, {
      expires: Date.now() + this.config.discoveryRetryMs,
      reason,
      message,
    });
  }

  private evictIdle(): Promise<void> {
    const eviction = this.capacity.then(async () => {
      if (this.closed) return;
      for (const [key, entry] of this.clients) {
        if (
          entry.leases ||
          entry.client.busy ||
          this.acquiring.has(entry.workspace) ||
          Date.now() - entry.client.lastUsed < this.config.idleTimeoutMs
        )
          continue;
        this.clients.delete(key);
        await entry.client.shutdown();
      }
    });
    this.capacity = eviction.catch(() => undefined);
    return eviction;
  }

  getSupportedExtensions(): string[] {
    return [...new Set(SERVERS.flatMap((server) => server.extensions))];
  }
  isExtensionSupported(extension: string): boolean {
    return getServersForExtension(extension).length > 0;
  }

  async shutdownProject(projectDir: string): Promise<void> {
    const workspace = resolvePath(projectDir);
    const state = this.workspaces.get(workspace);
    if (state) {
      state.closed = true;
      state.controller.abort();
    }
    const entries = [...this.clients.entries()].filter(([, entry]) => entry.workspace === workspace);
    for (const [key] of entries) this.clients.delete(key);
    await Promise.all([
      ...entries.map(([, entry]) => entry.client.shutdown()),
      ...[...this.initializing].filter(([, root]) => root === workspace).map(([client]) => client.shutdown()),
    ]);
    await Promise.all([...this.pending.entries()].filter(([key]) => JSON.parse(key)[0] === workspace).map(([, pending]) => pending));
    this.roots.clear();
    this.failures.clear();
    if (this.workspaces.get(workspace) === state) this.workspaces.delete(workspace);
  }

  shutdown(): Promise<void> {
    this.stopPromise ??= this.stop();
    return this.stopPromise;
  }

  private async stop(): Promise<void> {
    this.closed = true;
    for (const state of this.workspaces.values()) {
      state.closed = true;
      state.controller.abort();
    }
    clearInterval(this.idleTimer);
    for (const release of this.slots) release();
    this.slots.clear();
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.all([
      ...clients.map((entry) => entry.client.shutdown()),
      ...[...this.initializing.keys()].map((client) => client.shutdown()),
      ...this.pending.values(),
    ]);
    this.failures.clear();
    this.roots.clear();
    for (const state of this.workspaces.values()) state.closed = true;
    this.workspaces.clear();
  }
}
