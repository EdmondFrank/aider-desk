/**
 * Tree-Sitter Repo Map Extension
 *
 * Provides an enhanced repository map using tree-sitter parsing.
 * When enabled in agent profile (includeRepoMap: true), this extension
 * generates a comprehensive map of the codebase showing:
 * - File structure and definitions
 * - Dependencies and references
 * - Symbol rankings based on PageRank algorithm
 *
 * This replaces the default repo map functionality with a more detailed
 * tree-sitter based implementation.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { getRepoMap } from '@aiderdesk/tree-sitter-utils';

import { loadConfig, saveConfig } from './config';
import { RepositoryInitialization } from './initialization';

import type {
  Extension,
  ExtensionContext,
  AgentStartedEvent,
  CommandDefinition,
  UIComponentDefinition,
  TaskUpdatedEvent,
  TaskClosedEvent,
} from '@aiderdesk/extensions';

const INITIALIZATION_COMPONENT = 'repository-map-initialization';
const INITIALIZATION_JSX = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'InitializationBanner.jsx'), 'utf8');

const REPO_MAP_USER_PREFIX = 'Here is a map of the repository:';
const REPO_MAP_ASSISTANT_RESPONSE = 'Ok, I will use the repository map as a reference.';

const REPO_MAP_COMMAND: CommandDefinition = {
  name: 'repo-map',
  description: 'Manage repository map settings',
  arguments: [
    {
      description: 'Setting to configure',
      options: ['maxLines', 'exclude'],
      required: false,
    },
    {
      description: 'Value for the setting (comma-separated for exclude patterns)',
      required: false,
    },
  ],
  async execute(args: string[], context: ExtensionContext): Promise<void> {
    const taskContext = context.getTaskContext();
    if (!taskContext) {
      context.log('No active task context available', 'error');
      return;
    }

    const [setting, value] = args;

    if (!setting) {
      // Show current config
      const config = await loadConfig();
      taskContext.addLogMessage('info', `Current repository map settings:\n\nmaxLines: ${config.maxLines}\nexclude: ${config.exclude.join(', ')}`);
      return;
    }

    if (setting === 'maxLines') {
      if (!value) {
        // Show current maxLines
        const config = await loadConfig();
        taskContext.addLogMessage('info', `Current maxLines: ${config.maxLines}`);
        return;
      }

      // Parse and validate the value
      const maxLines = parseInt(value, 10);
      if (isNaN(maxLines) || maxLines < 100) {
        taskContext.addLogMessage('error', 'Invalid maxLines value. Must be a number >= 100.');
        return;
      }

      // Save the new value
      const config = await loadConfig();
      config.maxLines = maxLines;
      await saveConfig(config);

      taskContext.addLogMessage('info', `maxLines updated to ${maxLines}`);
    } else if (setting === 'exclude') {
      if (!value) {
        // Show current exclude patterns
        const config = await loadConfig();
        taskContext.addLogMessage('info', `Current exclude patterns: ${config.exclude.join(',')}`);
        return;
      }

      // Parse comma-separated patterns
      const excludePatterns = value
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      if (excludePatterns.length === 0) {
        taskContext.addLogMessage('error', 'Invalid exclude patterns. Provide at least one pattern.');
        return;
      }

      // Save the new value
      const config = await loadConfig();
      config.exclude = excludePatterns;
      await saveConfig(config);

      taskContext.addLogMessage('info', `exclude patterns updated to: ${excludePatterns.join(',')}`);
    } else {
      taskContext.addLogMessage(
        'error',
        `Unknown setting: ${setting}\n\nAvailable settings:\n- maxLines: Maximum number of lines in the repository map\n- exclude: Comma-separated list of patterns to exclude`,
      );
    }
  },
};

export default class TreeSitterRepoMapExtension implements Extension {
  static metadata = {
    name: 'Tree-Sitter Repo Map',
    version: '1.2.0',
    description: 'Provides enhanced repository map using tree-sitter parsing with PageRank-based symbol ranking',
    author: 'wladimiiir',
    iconUrl: 'https://raw.githubusercontent.com/magiksoft/aider-desk/refs/heads/main/packages/extensions/extensions/tree-sitter-repo-map/icon.png',
    capabilities: ['context', 'commands', 'ui'],
  };

  private unloaded = false;
  private readonly tasks = new Map<string, { key: string; context: ExtensionContext; taskId: string }>();
  private readonly initialization = new RepositoryInitialization(
    (root, excludePatterns, signal) => getRepoMap(root, { excludePatterns, signal, prepareOnly: true }),
    (key) => {
      for (const task of this.tasks.values()) {
        if (task.key === key) task.context.triggerUIDataRefresh(INITIALIZATION_COMPONENT, task.taskId);
      }
    },
    (error) => {
      for (const task of this.tasks.values()) task.context.log(`Repository map initialization failed: ${error}`, 'error');
    },
  );

  private taskKey(context: ExtensionContext): string {
    return JSON.stringify([context.getProjectDir(), context.getTaskContext()?.data.id]);
  }

  private async initializeTask(context: ExtensionContext, retry = false): Promise<string | undefined> {
    const task = context.getTaskContext();
    if (!task || this.unloaded) return;
    const profile = await task.getTaskAgentProfile();
    if (!profile?.includeRepoMap) {
      this.initialization.closeTask(this.taskKey(context));
      this.tasks.delete(this.taskKey(context));
      return;
    }
    const root = task.getTaskDir();
    if (!root) return;
    const config = await loadConfig();
    const currentProfile = await task.getTaskAgentProfile();
    if (this.unloaded || !currentProfile?.includeRepoMap) return;
    const key = this.initialization.start(task.getTaskDir(), config.exclude, retry);
    this.tasks.set(this.taskKey(context), { key, context, taskId: task.data.id });
    context.triggerUIDataRefresh(INITIALIZATION_COMPONENT, task.data.id);
    return key;
  }

  getUIComponents(): UIComponentDefinition[] {
    return [{ id: INITIALIZATION_COMPONENT, placement: 'task-input-above', jsx: INITIALIZATION_JSX, loadData: true, noDataCache: true }];
  }

  async getUIExtensionData(componentId: string, context: ExtensionContext): Promise<unknown> {
    if (componentId !== INITIALIZATION_COMPONENT) return null;
    const taskKey = this.taskKey(context);
    const task = this.tasks.get(taskKey);
    return task ? this.initialization.state(task.key, taskKey) : null;
  }

  async executeUIExtensionAction(componentId: string, action: string, args: unknown[], context: ExtensionContext): Promise<void> {
    if (componentId !== INITIALIZATION_COMPONENT) return;
    if (action === 'initialize' || action === 'retry') {
      await this.initializeTask(context, action === 'retry');
      return;
    }
    const taskKey = this.taskKey(context);
    const task = this.tasks.get(taskKey);
    if (!task || args[0] !== task.key) return;
    if (action === 'background') this.initialization.background(task.key, taskKey);
    if (action === 'cancel') this.initialization.cancel(task.key);
  }

  async onTaskUpdated(event: TaskUpdatedEvent, context: ExtensionContext): Promise<void> {
    if (event.task.id && this.tasks.has(this.taskKey(context))) await this.initializeTask(context);
  }

  async onTaskClosed(event: TaskClosedEvent, context: ExtensionContext): Promise<void> {
    if (!event.task.id) return;
    const key = this.taskKey(context);
    this.initialization.closeTask(key);
    this.tasks.delete(key);
  }

  async onUnload(): Promise<void> {
    this.unloaded = true;
    this.initialization.dispose();
    this.tasks.clear();
  }

  async onLoad(context: ExtensionContext): Promise<void> {
    this.unloaded = false;
    context.log('Tree-Sitter Repo Map Extension loaded', 'info');
  }

  getCommands(): CommandDefinition[] {
    return [REPO_MAP_COMMAND];
  }

  async onAgentStarted(event: AgentStartedEvent, context: ExtensionContext): Promise<void | Partial<AgentStartedEvent>> {
    // Only process if includeRepoMap is enabled
    if (!event.agentProfile.includeRepoMap) {
      return undefined;
    }

    const withoutMap = { agentProfile: { ...event.agentProfile, includeRepoMap: false } };
    context.log('Generating tree-sitter based repository map', 'info');

    try {
      // Get project directory
      const projectDir = context.getTaskContext()?.getTaskDir() || context.getProjectDir();
      if (!projectDir) {
        context.log('No project directory available, skipping repo map', 'warn');
        return withoutMap;
      }

      // Load config to get maxLines
      const config = await loadConfig();
      if (this.unloaded) return withoutMap;

      const taskKey = this.taskKey(context);
      const key = this.initialization.start(projectDir, config.exclude);
      const task = context.getTaskContext();
      if (task) this.tasks.set(taskKey, { key, context, taskId: task.data.id });
      const ready = await this.initialization.wait(key, taskKey, event.modelCallSettings?.abortSignal);
      if (event.modelCallSettings?.abortSignal?.aborted) return { blocked: true };
      if (!ready) return withoutMap;

      // Extract mentioned files and identifiers from context
      const mentionedFiles = new Set<string>();
      const mentionedIdents = new Set<string>();
      const chatFiles = new Set<string>();

      // Extract from context files
      for (const file of event.contextFiles) {
        if (file.path) {
          mentionedFiles.add(file.path);
          chatFiles.add(file.path);
        }
      }

      // Extract from context messages (look for file references)
      for (const message of event.contextMessages) {
        if (typeof message.content === 'string') {
          // Simple extraction of potential file paths and identifiers
          const fileMatches = message.content.match(/[\w/.-]+\.(ts|tsx|js|jsx|py|java|go|rs|c|cpp)/g) || [];
          fileMatches.forEach((f) => mentionedFiles.add(f));

          const identMatches = message.content.match(/\b[A-Z][a-zA-Z0-9_]*\b/g) || [];
          identMatches.forEach((i) => mentionedIdents.add(i));
        }
      }

      // Generate the repository map using the library
      const repoMap = await getRepoMap(projectDir, {
        excludePatterns: config.exclude,
        mentionedFiles,
        mentionedIdents,
        chatFiles,
        maxLines: config.maxLines,
        signal: event.modelCallSettings?.abortSignal,
      });

      if (!repoMap) {
        context.log('No repository map generated', 'warn');
        return withoutMap;
      }

      // Build the content message
      const content = `${REPO_MAP_USER_PREFIX}\n\n${repoMap}`;

      // Create user and assistant messages
      const repoMapUserMessage = {
        id: 'tree-sitter-repo-map-user',
        role: 'user' as const,
        content,
      };

      const repoMapAssistantMessage = {
        id: 'tree-sitter-repo-map-assistant',
        role: 'assistant' as const,
        content: REPO_MAP_ASSISTANT_RESPONSE,
      };

      // Prepend to context messages
      const modifiedContextMessages = [repoMapUserMessage, repoMapAssistantMessage, ...event.contextMessages];

      context.log(`Repository map generated and added to context (max ${config.maxLines} lines)`, 'info');

      // Return modified event with includeRepoMap set to false to prevent default
      return {
        contextMessages: modifiedContextMessages,
        agentProfile: {
          ...event.agentProfile,
          includeRepoMap: false,
        },
      };
    } catch (error) {
      if (event.modelCallSettings?.abortSignal?.aborted) {
        return { blocked: true };
      }
      context.log(`Error generating repository map: ${error}`, 'error');
      return withoutMap;
    }
  }
}
