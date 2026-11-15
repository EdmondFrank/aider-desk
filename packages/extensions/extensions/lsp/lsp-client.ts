import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import treeKill from 'tree-kill';

import { CancellationTokenSource, createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';

import { DEFAULT_CONFIG } from './config';
import { withDeadline } from './async';
import { resolvePath } from './paths';

import type { MessageConnection } from 'vscode-jsonrpc/node';
import type { Diagnostic, Range } from 'vscode-languageserver-types';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { LspServerInfo, LspServerHandle, LspLogContext } from './lsp-servers';
import type { LspConfig } from './config';

export interface LspDiagnostic {
  severity: number;
  message: string;
  range: Range;
  source?: string;
  code?: string | number;
}

export interface LspClientOptions {
  serverInfo: LspServerInfo;
  handle: LspServerHandle;
  rootDir: string;
  context: LspLogContext;
  config?: LspConfig;
}

interface PublishDiagnosticsParams {
  uri: string;
  version?: number;
  diagnostics: Diagnostic[];
}

interface DiagnosticWaiter {
  version: number;
  resolve(diagnostics: LspDiagnostic[]): void;
  reject(error: Error): void;
}

export class DiagnosticTimeoutError extends Error {}

export class LspClient {
  private connection: MessageConnection | null = null;
  private process: ChildProcessWithoutNullStreams;
  private diagnostics = new Map<string, LspDiagnostic[]>();
  private openFiles = new Map<string, number>();
  private hashes = new Map<string, string>();
  private queues = new Map<string, Promise<unknown>>();
  private waiters = new Map<string, DiagnosticWaiter>();
  private serverInfo: LspServerInfo;
  private rootDir: string;
  private context: LspLogContext;
  private config: LspConfig;
  private initializationOptions?: Record<string, unknown>;
  private processGroup: boolean;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private closed = false;
  private operations = 0;
  private documentVersion = 0;
  private lastActivity = Date.now();

  constructor(options: LspClientOptions) {
    this.serverInfo = options.serverInfo;
    this.process = options.handle.process;
    this.processGroup = options.handle.processGroup ?? false;
    this.rootDir = options.rootDir;
    this.context = options.context;
    this.config = options.config ?? DEFAULT_CONFIG;
    this.initializationOptions = options.handle.initializationOptions;
    this.process.stderr.resume();
    this.process.once('exit', this.handleExit);
    this.process.once('error', this.handleExit);
  }

  private handleExit = (): void => {
    this.dispose(new Error('LSP server exited'));
  };

  async initialize(): Promise<void> {
    this.assertOpen();
    this.initPromise ??= this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    this.connection = createMessageConnection(new StreamMessageReader(this.process.stdout), new StreamMessageWriter(this.process.stdin));
    this.connection.onNotification('textDocument/publishDiagnostics', (params: PublishDiagnosticsParams) => {
      let file: string;
      try {
        file = this.absolute(fileURLToPath(params.uri));
      } catch {
        return;
      }
      const version = this.openFiles.get(file);
      if (version === undefined || (params.version !== undefined && params.version !== version)) {
        return;
      }
      const diagnostics = params.diagnostics.slice(0, this.config.maxDiagnosticsPerDocument).map((diagnostic) => ({
        severity: diagnostic.severity ?? 1,
        message: diagnostic.message.slice(0, 4000),
        range: diagnostic.range,
        source: diagnostic.source?.slice(0, 200),
        code: diagnostic.code,
      }));
      this.diagnostics.set(file, diagnostics);
      const waiter = this.waiters.get(file);
      if (waiter?.version === version) {
        waiter.resolve(diagnostics);
      }
    });
    this.connection.onRequest('window/workDoneProgress/create', () => null);
    this.connection.onRequest('workspace/configuration', (params: { items?: unknown[] }) =>
      (params.items ?? [{}]).map(() => this.initializationOptions ?? {}),
    );
    this.connection.onClose(this.handleExit);
    this.connection.listen();
    try {
      await this.request('initialize', {
        rootUri: pathToFileURL(this.rootDir).href,
        processId: process.pid,
        workspaceFolders: [
          {
            name: path.basename(this.rootDir),
            uri: pathToFileURL(this.rootDir).href,
          },
        ],
        initializationOptions: this.initializationOptions,
        capabilities: {
          window: { workDoneProgress: true },
          workspace: { configuration: true },
          textDocument: {
            synchronization: { didSave: true },
            publishDiagnostics: {
              relatedInformation: true,
              versionSupport: true,
            },
          },
        },
      });
      this.assertOpen();
      await this.notify('initialized', {});
      this.initialized = true;
    } catch (error) {
      this.dispose(new Error('LSP initialization failed'));
      await this.terminate();
      throw error;
    }
  }

  private absolute(file: string): string {
    return resolvePath(this.rootDir, file);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('LSP client is closed');
    }
  }

  private async request<T>(method: string, params: unknown, signal?: AbortSignal, timeout = this.config.requestTimeoutMs): Promise<T> {
    this.assertOpen();
    signal?.throwIfAborted();
    const token = new CancellationTokenSource();
    const abort = () => token.cancel();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      return await withDeadline(this.connection!.sendRequest<T>(method, params, token.token), timeout, signal);
    } finally {
      token.cancel();
      token.dispose();
      signal?.removeEventListener('abort', abort);
    }
  }

  private async notify(method: string, params: unknown, signal?: AbortSignal): Promise<void> {
    this.assertOpen();
    signal?.throwIfAborted();
    try {
      await withDeadline(this.connection!.sendNotification(method, params), this.config.requestTimeoutMs, signal);
    } catch (error) {
      if (!signal?.aborted) {
        this.dispose(new Error('LSP notification failed'));
        await this.terminate();
      }
      throw error;
    }
  }

  private runDocument<T>(file: string, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.assertOpen();
    signal?.throwIfAborted();
    if (this.operations >= this.config.maxPendingOperations) {
      return Promise.reject(new Error('LSP pending operation limit reached'));
    }
    this.operations++;
    this.lastActivity = Date.now();
    const previous = this.queues.get(file) ?? Promise.resolve();
    const result = (async () => {
      try {
        await withDeadline(previous, this.config.requestTimeoutMs, signal);
        this.assertOpen();
        signal?.throwIfAborted();
        await withDeadline(this.initialize(), this.config.requestTimeoutMs, signal);
        return await action();
      } finally {
        this.operations--;
        this.lastActivity = Date.now();
      }
    })();
    const tail = Promise.all([previous, result.catch(() => undefined)]).then(() => undefined);
    this.queues.set(file, tail);
    void tail.then(() => {
      if (this.queues.get(file) === tail) {
        this.queues.delete(file);
      }
    });
    return result;
  }

  private async closeDocument(file: string): Promise<void> {
    this.openFiles.delete(file);
    this.hashes.delete(file);
    this.diagnostics.delete(file);
    await this.notify('textDocument/didClose', {
      textDocument: { uri: pathToFileURL(file).href },
    });
  }

  private async makeRoom(file: string): Promise<void> {
    if (this.openFiles.has(file)) {
      return;
    }
    while (this.openFiles.size >= this.config.maxOpenDocuments) {
      const candidate = [...this.openFiles.keys()].find((key) => key !== file && !this.queues.has(key));
      if (!candidate) {
        throw new Error('LSP open document limit reached; all documents are active');
      }
      void this.closeDocument(candidate).catch(() => undefined);
    }
    this.openFiles.set(file, -1);
  }

  private async update(file: string, timeoutMs?: number, signal?: AbortSignal): Promise<LspDiagnostic[]> {
    signal?.throwIfAborted();
    const stat = await fs.stat(file);
    if (stat.size > this.config.maxFileBytes) {
      throw new Error(`LSP file exceeds ${this.config.maxFileBytes} byte limit`);
    }
    let content = '';
    let bytes = 0;
    for await (const chunk of createReadStream(file, {
      encoding: 'utf8',
      highWaterMark: 65536,
      signal,
    })) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > this.config.maxFileBytes) throw new Error(`LSP file exceeds ${this.config.maxFileBytes} byte limit`);
      content += chunk;
    }
    const hash = createHash('sha256').update(content).digest('hex');
    if (this.hashes.get(file) === hash && this.diagnostics.has(file)) {
      return this.diagnostics.get(file)!;
    }
    signal?.throwIfAborted();
    await this.makeRoom(file);
    const previousVersion = this.openFiles.get(file);
    const previous = previousVersion === -1 ? undefined : previousVersion;
    const version = ++this.documentVersion;
    this.openFiles.delete(file);
    this.openFiles.set(file, version);
    this.hashes.set(file, hash);
    this.diagnostics.delete(file);
    let waiter: Promise<LspDiagnostic[]> | undefined;
    let notified = false;
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
    }
    try {
      if (timeoutMs !== undefined) {
        waiter = this.wait(file, version, timeoutMs, controller.signal);
        void waiter.catch(() => undefined);
      }
      signal?.throwIfAborted();
      const textDocument = { uri: pathToFileURL(file).href, version };
      if (previous === undefined) {
        await this.notify(
          'textDocument/didOpen',
          {
            textDocument: {
              ...textDocument,
              languageId: this.languageId(file),
              text: content,
            },
          },
          signal,
        );
      } else {
        await this.notify(
          'textDocument/didChange',
          {
            textDocument,
            contentChanges: [{ text: content }],
          },
          signal,
        );
      }
      notified = true;
      await this.notify(
        'textDocument/didSave',
        {
          textDocument: { uri: textDocument.uri },
        },
        signal,
      );
      return waiter ? await waiter : [];
    } catch (error) {
      this.hashes.delete(file);
      if (!notified) {
        const cleanup = this.closeDocument(file).catch(() => undefined);
        if (!signal?.aborted) await cleanup;
      }
      throw error;
    } finally {
      controller.abort();
      signal?.removeEventListener('abort', abort);
    }
  }

  private languageId(file: string): string {
    const extension = path.extname(file).toLowerCase();
    if (this.serverInfo.id === 'typescript' || this.serverInfo.id === 'deno') {
      if (extension === '.tsx') return 'typescriptreact';
      if (extension === '.jsx') return 'javascriptreact';
      if (['.js', '.mjs', '.cjs'].includes(extension)) return 'javascript';
    }
    return this.serverInfo.languageId;
  }

  private wait(file: string, version: number, timeoutMs: number, signal?: AbortSignal): Promise<LspDiagnostic[]> {
    return new Promise((resolve, reject) => {
      const finish = (diagnostics?: LspDiagnostic[], error?: Error) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.waiters.delete(file);
        if (error) reject(error);
        else resolve(diagnostics ?? []);
      };
      const timer = setTimeout(() => finish(undefined, new DiagnosticTimeoutError(`No fresh LSP diagnostics within ${timeoutMs}ms`)), timeoutMs);
      const abort = () => finish(undefined, new Error('LSP diagnostics cancelled'));
      this.waiters.set(file, {
        version,
        resolve: (diagnostics) => finish(diagnostics),
        reject: (error) => finish(undefined, error),
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }

  updateAndGetDiagnostics(filePath: string, timeoutMs = this.config.diagnosticTimeoutMs, signal?: AbortSignal): Promise<LspDiagnostic[]> {
    const file = this.absolute(filePath);
    return this.runDocument(file, () => this.update(file, timeoutMs, signal), signal);
  }

  notifyFileChanged(filePath: string): Promise<void> {
    const file = this.absolute(filePath);
    return this.runDocument(file, async () => {
      await this.update(file);
    });
  }

  getDiagnostics(filePath: string): LspDiagnostic[] {
    return this.diagnostics.get(this.absolute(filePath)) ?? [];
  }

  async findReferences(filePath: string, line: number, character: number, signal?: AbortSignal): Promise<{ uri: string; range: Range }[] | null> {
    const file = this.absolute(filePath);
    return this.runDocument(
      file,
      async () => {
        await this.update(file, undefined, signal);
        return this.request(
          'textDocument/references',
          {
            textDocument: { uri: pathToFileURL(file).href },
            position: { line, character },
            context: { includeDeclaration: true },
          },
          signal,
        );
      },
      signal,
    );
  }

  private dispose(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of [...this.waiters.values()]) waiter.reject(error);
    this.connection?.dispose();
    this.connection = null;
    this.openFiles.clear();
    this.diagnostics.clear();
    this.hashes.clear();
    this.process.removeListener('exit', this.handleExit);
    this.process.removeListener('error', this.handleExit);
  }

  private async terminate(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    const pid = this.process.pid;
    if (!pid) return;
    if (this.processGroup) {
      try {
        process.kill(-pid, signal);
      } catch {
        /* The process group may already have exited. */
      }
      return;
    }
    if (this.process.exitCode !== null || this.process.signalCode !== null) return;
    try {
      await withDeadline(new Promise<void>((resolve) => treeKill(pid, signal, () => resolve())), this.config.shutdownTimeoutMs);
    } catch {
      this.process.kill(signal);
    }
  }

  shutdown(): Promise<void> {
    this.stopPromise ??= this.stop();
    return this.stopPromise;
  }

  private async stop(): Promise<void> {
    try {
      if (this.initialized && !this.closed) {
        await this.request('shutdown', null, undefined, this.config.shutdownTimeoutMs);
        await withDeadline(this.connection!.sendNotification('exit'), this.config.shutdownTimeoutMs);
      }
    } catch (error) {
      this.context.log(`LSP shutdown: ${error}`, 'debug');
    } finally {
      this.dispose(new Error('LSP client shut down'));
      await this.terminate();
      if (this.process.exitCode === null && this.process.signalCode === null) {
        try {
          await withDeadline(new Promise<void>((resolve) => this.process.once('exit', () => resolve())), this.config.shutdownTimeoutMs);
        } catch {
          await this.terminate('SIGKILL');
        }
      }
    }
  }

  get serverId(): string {
    return this.serverInfo.id;
  }
  get busy(): boolean {
    return this.operations > 0;
  }
  get alive(): boolean {
    return !this.closed;
  }
  get lastUsed(): number {
    return this.lastActivity;
  }
}
