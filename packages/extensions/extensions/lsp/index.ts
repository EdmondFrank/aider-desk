import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { LspManager } from './lsp-manager';
import { DiagnosticTimeoutError } from './lsp-client';
import { cancelInstallations } from './installation';
import { DEFAULT_CONFIG, loadConfig, saveConfig } from './config';

import type { Extension, ExtensionContext, ToolDefinition, ToolFinishedEvent, ProjectStoppedEvent, TaskClosedEvent } from '@aiderdesk/extensions';
import type { LspDiagnostic } from './lsp-client';
import type { LspConfig } from './config';

interface FilePositionInput {
  filePath: string;
  line: number;
  character: number;
}

const metadata = {
  name: 'LSP Integration',
  version: '1.1.0',
  description: 'Language Server Protocol integration for code intelligence and error detection',
  author: 'wladimiiir',
  iconUrl: 'https://raw.githubusercontent.com/magiksoft/aider-desk/refs/heads/main/packages/extensions/extensions/lsp/icon.png',
  capabilities: ['tools', 'code-intelligence'],
};

export default class LspExtension implements Extension {
  static metadata = metadata;
  private config: LspConfig = DEFAULT_CONFIG;
  private manager?: LspManager;
  private log?: ExtensionContext['log'];
  private owners = new Map<string, { workspace: string; project: string }>();

  async onLoad(context: ExtensionContext): Promise<void> {
    this.log = context.log.bind(context);
    try {
      this.config = await loadConfig();
    } catch (error) {
      context.log(`Invalid LSP configuration; using defaults: ${error}`, 'warn');
    }
  }

  async onUnload(): Promise<void> {
    cancelInstallations();
    await this.manager?.shutdown();
    this.manager = undefined;
    this.owners.clear();
  }

  async getConfigData(): Promise<LspConfig> {
    return this.config;
  }

  async saveConfigData(value: unknown): Promise<LspConfig> {
    this.config = await saveConfig(value);
    await this.onUnload();
    return this.config;
  }

  private getWorkspace(context: ExtensionContext): string {
    const workspace = path.resolve(context.getTaskContext()?.getTaskDir() ?? context.getProjectDir());
    const owner = context.getTaskContext()?.data.id ?? `project:${context.getProjectDir()}`;
    this.owners.set(owner, { workspace, project: context.getProjectDir() });
    return workspace;
  }

  private getManager(context: ExtensionContext): LspManager {
    const log = this.log ?? context.log.bind(context);
    this.manager ??= new LspManager({ log: (message, level) => log(message, level) }, this.config);
    return this.manager;
  }

  async onTaskClosed(event: TaskClosedEvent): Promise<void> {
    const owner = this.owners.get(event.task.id);
    this.owners.delete(event.task.id);
    if (owner && ![...this.owners.values()].some((value) => value.workspace === owner.workspace)) {
      await this.manager?.shutdownProject(owner.workspace);
    }
  }

  async onProjectStopped(event: ProjectStoppedEvent): Promise<void> {
    const workspaces = new Set<string>();
    for (const [key, owner] of this.owners) {
      if (owner.project === event.baseDir) {
        this.owners.delete(key);
        workspaces.add(owner.workspace);
      }
    }
    await Promise.all(
      [...workspaces]
        .filter((workspace) => ![...this.owners.values()].some((owner) => owner.workspace === workspace))
        .map((workspace) => this.manager?.shutdownProject(workspace)),
    );
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'lsp-find-references',
        description:
          'Find references to a symbol at a zero-based line and character position. Paths are resolved against the task working directory.',
        inputSchema: z.object({
          filePath: z.string(),
          line: z.number().int().min(0),
          character: z.number().int().min(0),
        }),
        execute: async (input, signal, context) => {
          const params = input as unknown as FilePositionInput;
          const workspace = this.getWorkspace(context);
          const references = await this.getManager(context).withClient(
            params.filePath,
            workspace,
            (client) => client.findReferences(path.resolve(workspace, params.filePath), params.line, params.character, signal),
            signal,
          );
          if (references === undefined) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'No LSP server available. Check installed servers, workspace configuration, and capacity limits.',
                },
              ],
              isError: true,
            };
          }
          const formatted = (references ?? [])
            .slice(0, 1000)
            .map((reference) => {
              let file = reference.uri;
              try {
                file = fileURLToPath(file);
              } catch {
                /* Non-file locations retain their URI. */
              }
              return `${file}:${reference.range.start.line + 1}:${reference.range.start.character + 1}`;
            })
            .join('\n');
          return {
            content: [
              {
                type: 'text',
                text: formatted ? `Found ${references?.length} reference(s):\n${formatted}` : 'No references found.',
              },
            ],
          };
        },
      },
    ];
  }

  async onToolFinished(event: ToolFinishedEvent, context: ExtensionContext): Promise<void | Partial<ToolFinishedEvent>> {
    if (event.toolName !== 'power---file_edit' && event.toolName !== 'power---file_write') return;
    const file = event.input?.filePath;
    if (typeof file !== 'string' || !file) return;
    const manager = this.getManager(context);
    if (!manager.isExtensionSupported(path.extname(file))) return;
    const workspace = this.getWorkspace(context);
    const start = performance.now();
    try {
      const diagnostics = await manager.withClient(
        file,
        workspace,
        (client) => client.updateAndGetDiagnostics(path.resolve(workspace, file), this.config.diagnosticTimeoutMs, event.abortSignal),
        event.abortSignal,
      );
      if (!diagnostics) return;
      const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 1);
      if (!errors.length) return;
      return {
        output: this.appendOutput(event.output, this.formatDiagnostics(file, errors)),
      };
    } catch (error) {
      if (event.abortSignal?.aborted) return;
      if (error instanceof DiagnosticTimeoutError) {
        return {
          output: this.appendOutput(event.output, 'LSP diagnostics timed out; this edit has not been verified.'),
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      context.log(`LSP diagnostics unavailable for ${file}: ${message}`, 'warn');
      return { output: this.appendOutput(event.output, `LSP diagnostics unavailable; this edit has not been verified. ${message.slice(0, 2000)}`) };
    } finally {
      context.log(`LSP edit diagnostics: ${Math.round(performance.now() - start)}ms`, 'debug');
    }
  }

  private appendOutput(output: unknown, diagnostics: string): unknown {
    return typeof output === 'string' ? `${output}\n\n${diagnostics}` : { result: output, lspDiagnostics: diagnostics };
  }

  private formatDiagnostics(file: string, diagnostics: LspDiagnostic[]): string {
    const lines = diagnostics.map(
      (diagnostic) =>
        `error${diagnostic.source ? ` [${diagnostic.source}]` : ''} [${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}] ${diagnostic.message}`,
    );
    return `⚠️ ${path.basename(file)} has ${diagnostics.length} error(s):\n<file_diagnostics>\n${lines.join('\n').slice(0, 20000)}\n</file_diagnostics>`;
  }
}
