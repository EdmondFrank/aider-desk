import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getReasoningPreference, isReasoningEffort, REASONING_OPTIONS, saveReasoningPreference } from './preferences';

import type {
  Extension,
  ExtensionContext,
  UIComponentDefinition,
  AgentStartedEvent,
  Reasoning,
  TaskCreatedEvent,
  TaskPreparedEvent,
  TaskUpdatedEvent,
} from '@aiderdesk/extensions';

const METADATA_KEY = 'reasoningEffort';
const MODEL_METADATA_KEY = 'reasoningSelectorModel';

const AIDER_MODES = ['code', 'ask', 'architect', 'context'];

const selectorJsx = readFileSync(join(__dirname, './ReasoningSelector.jsx'), 'utf-8');

const getTaskModel = (task: TaskCreatedEvent['task'], context: ExtensionContext) => {
  if (task.provider && task.model) {
    return { provider: task.provider, model: task.model };
  }
  const projectContext = context.getProjectContext();
  const profileId = task.agentProfileId || projectContext.getProjectSettings().agentProfileId;
  const profile = projectContext.getAgentProfiles().find((agentProfile) => agentProfile.id === profileId);
  return profile?.provider && profile.model ? { provider: profile.provider, model: profile.model } : undefined;
};

const getModelKey = (model: ReturnType<typeof getTaskModel>): string => (model ? JSON.stringify([model.provider, model.model]) : '');

export default class ReasoningSelectorExtension implements Extension {
  static metadata = {
    name: 'Reasoning Selector',
    version: '1.2.1',
    description: 'Adds a reasoning effort selector dropdown next to the model selector in agent mode',
    author: 'wladimiiir',
    iconUrl: 'https://raw.githubusercontent.com/magiksoft/aider-desk/refs/heads/main/packages/extensions/extensions/reasoning-selector/icon.png',
    capabilities: ['ui'],
  };

  private readonly observedModels = new WeakMap<TaskCreatedEvent['task'], string>();

  async onLoad(context: ExtensionContext): Promise<void> {
    context.log('Reasoning Selector extension loaded', 'info');
  }

  async onUnload(): Promise<void> {}

  private async getPreference(model: ReturnType<typeof getTaskModel>, context: ExtensionContext): Promise<string> {
    if (!model) {
      return '';
    }
    try {
      return await getReasoningPreference(context.getProjectContext().baseDir, model.provider, model.model);
    } catch (error) {
      context.log(`Reasoning Selector: could not read preferences: ${error}`, 'warn');
      return '';
    }
  }

  async onTaskCreated(event: TaskCreatedEvent, context: ExtensionContext): Promise<void | Partial<TaskCreatedEvent>> {
    const metadata = { ...event.task.metadata };
    const model = getTaskModel(event.task, context);
    if (!(METADATA_KEY in metadata)) {
      const reasoningEffort = await this.getPreference(model, context);
      if (reasoningEffort) {
        metadata[METADATA_KEY] = reasoningEffort;
      }
    }
    metadata[MODEL_METADATA_KEY] = getModelKey(model);
    return { task: { ...event.task, metadata } };
  }

  async onTaskPrepared(event: TaskPreparedEvent, context: ExtensionContext): Promise<void | Partial<TaskPreparedEvent>> {
    return this.onTaskUpdated(event, context);
  }

  async onTaskUpdated(event: TaskUpdatedEvent, context: ExtensionContext): Promise<void | Partial<TaskUpdatedEvent>> {
    const metadata = { ...event.task.metadata };
    const model = getTaskModel(event.task, context);
    const modelKey = getModelKey(model);
    const previousModelKey = metadata[MODEL_METADATA_KEY] ?? this.observedModels.get(event.task);
    if (metadata[MODEL_METADATA_KEY] === modelKey) {
      return undefined;
    }

    if (previousModelKey !== undefined && previousModelKey !== modelKey) {
      const reasoningEffort = await this.getPreference(model, context);
      if (reasoningEffort) {
        metadata[METADATA_KEY] = reasoningEffort;
      } else {
        delete metadata[METADATA_KEY];
      }
    }
    metadata[MODEL_METADATA_KEY] = modelKey;
    context.triggerUIDataRefresh('reasoning-selector', event.task.id);
    return { task: { ...event.task, metadata } };
  }

  getUIComponents(): UIComponentDefinition[] {
    return [
      {
        id: 'reasoning-selector',
        placement: 'task-top-bar-left',
        jsx: selectorJsx,
        loadData: true,
      },
    ];
  }

  async getUIExtensionData(componentId: string, context: ExtensionContext): Promise<unknown> {
    if (componentId !== 'reasoning-selector') {
      return undefined;
    }

    const taskContext = context.getTaskContext();
    if (!taskContext) {
      return {
        reasoningEffort: '',
        options: REASONING_OPTIONS,
        isAgentMode: false,
      };
    }

    if (!this.observedModels.has(taskContext.data)) {
      this.observedModels.set(taskContext.data, getModelKey(getTaskModel(taskContext.data, context)));
    }
    const mode = taskContext.data.currentMode;
    const isAgentMode = !!mode && !AIDER_MODES.includes(mode);
    const value = taskContext.data.metadata?.[METADATA_KEY];
    const reasoningEffort = isReasoningEffort(value) ? value : '';

    return { reasoningEffort, options: REASONING_OPTIONS, isAgentMode };
  }

  async executeUIExtensionAction(componentId: string, action: string, args: unknown[], context: ExtensionContext): Promise<unknown> {
    if (componentId !== 'reasoning-selector' || action !== 'set-reasoning') {
      return undefined;
    }
    const value = args[0];
    if (!isReasoningEffort(value)) {
      throw new Error('Invalid reasoning effort');
    }
    const taskContext = context.getTaskContext();
    if (!taskContext) {
      return undefined;
    }
    const model = getTaskModel(taskContext.data, context);
    if (!model) {
      throw new Error('Select a model before setting reasoning effort');
    }

    await saveReasoningPreference(context.getProjectContext().baseDir, model.provider, model.model, value);
    const existingMetadata: Record<string, unknown> = {
      ...taskContext.data.metadata,
      [MODEL_METADATA_KEY]: getModelKey(model),
    };
    if (value) {
      existingMetadata[METADATA_KEY] = value;
    } else {
      delete existingMetadata[METADATA_KEY];
    }

    await taskContext.updateTask({ metadata: existingMetadata });
    context.triggerUIDataRefresh('reasoning-selector', taskContext.data.id);
    return undefined;
  }

  async onAgentStarted(event: AgentStartedEvent, context: ExtensionContext): Promise<void | Partial<AgentStartedEvent>> {
    const taskContext = context.getTaskContext();
    if (!taskContext) {
      return undefined;
    }

    const reasoningEffort = taskContext.data.metadata?.[METADATA_KEY];
    if (!isReasoningEffort(reasoningEffort) || !reasoningEffort) {
      return undefined;
    }

    context.log(`Reasoning Selector: overriding reasoning to '${reasoningEffort}'`, 'info');

    return {
      modelCallSettings: {
        ...event.modelCallSettings,
        reasoning: reasoningEffort as Reasoning,
      },
    };
  }
}
