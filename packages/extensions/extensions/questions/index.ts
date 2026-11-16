/**
 * Questions Extension
 *
 * Registers a '/questions' command that extracts questions from the last message
 * and displays them as an interactive questionnaire above the prompt field.
 *
 * Usage:
 * /questions
 *
 * Features:
 * - Extracts questions from the last message using AI
 * - Displays questions with navigation (left/right chevrons)
 * - Allows answering questions via text area
 * - Records answers and auto-switches to next question
 */

import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { z } from 'zod';

import type {
  Extension,
  ExtensionContext,
  CommandDefinition,
  UIComponentDefinition,
  ToolDefinition,
  TaskClosedEvent,
  TaskDeletedEvent,
} from '@aiderdesk/extensions';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface QuestionsConfig {
  customModelId: string;
  toolsEnabled: boolean;
}

const DEFAULT_CONFIG: QuestionsConfig = {
  customModelId: '',
  toolsEnabled: true,
};

interface Question {
  id: string;
  text: string;
}

interface QuestionsState {
  questions: Question[];
  currentIndex: number;
  isActive: boolean;
}

const askQuestionSchema = z.object({
  question: z.string().trim().min(1).describe('The question to ask the user.'),
  options: z
    .array(z.string().trim().min(1))
    .min(2)
    .refine((options) => new Set(options).size === options.length, {
      message: 'Options must be unique',
    })
    .describe('The available answers. The user selects one option.'),
});

type QuestionResult = { question: string; answer: string } | { cancelled: true; reason: string };

type PendingQuestion = z.infer<typeof askQuestionSchema> & {
  id: string;
  finish: (result: QuestionResult) => void;
};

const configComponentJsx = readFileSync(join(__dirname, 'ConfigComponent.jsx'), 'utf-8');

export default class QuestionsExtension implements Extension {
  static metadata = {
    name: 'Questions',
    version: '1.2.0',
    description: 'Ask multiple-choice questions and extract free-form questionnaires from messages',
    author: 'wladimiiir',
    iconUrl: 'https://raw.githubusercontent.com/magiksoft/aider-desk/refs/heads/main/packages/extensions/extensions/questions/icon.png',
    capabilities: ['commands', 'tools', 'ui-elements'],
  };

  private taskStates: Map<string, QuestionsState> = new Map();
  private configPath: string;
  private pendingQuestions = new Map<string, PendingQuestion>();

  constructor() {
    this.configPath = join(__dirname, 'config.json');
  }

  private loadConfig(): QuestionsConfig {
    try {
      if (existsSync(this.configPath)) {
        const data = readFileSync(this.configPath, 'utf-8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
      }
    } catch {
      // Ignore errors, return defaults
    }
    return { ...DEFAULT_CONFIG };
  }

  async onLoad(context: ExtensionContext): Promise<void> {
    context.log('Questions Extension loaded', 'info');
  }

  async onUnload(): Promise<void> {
    for (const pending of this.pendingQuestions.values()) {
      pending.finish({ cancelled: true, reason: 'Extension unloaded' });
    }
    this.taskStates.clear();
  }

  getConfigComponent(): string {
    return configComponentJsx;
  }

  async getConfigData(): Promise<QuestionsConfig> {
    return this.loadConfig();
  }

  async saveConfigData(configData: unknown): Promise<unknown> {
    const config = configData as Partial<QuestionsConfig>;
    const merged = { ...this.loadConfig(), ...config };
    writeFileSync(this.configPath, JSON.stringify(merged, null, 2), 'utf-8');
    if (!merged.toolsEnabled) {
      for (const pending of this.pendingQuestions.values()) {
        pending.finish({ cancelled: true, reason: 'Question tools disabled' });
      }
    }
    return merged;
  }

  private getTaskKey(context: ExtensionContext, taskId: string): string {
    return JSON.stringify([context.getProjectDir(), taskId]);
  }

  private clearTask(taskId: string, context: ExtensionContext): void {
    const key = this.getTaskKey(context, taskId);
    this.pendingQuestions.get(key)?.finish({ cancelled: true, reason: 'Task closed or deleted' });
    this.taskStates.delete(key);
  }

  async onTaskClosed(event: TaskClosedEvent, context: ExtensionContext): Promise<void> {
    this.clearTask(event.task.id, context);
  }

  async onTaskDeleted(event: TaskDeletedEvent, context: ExtensionContext): Promise<void> {
    if (!event.blocked) {
      this.clearTask(event.task.id, context);
    }
  }

  getTools(): ToolDefinition<typeof askQuestionSchema>[] {
    if (!this.loadConfig().toolsEnabled) {
      return [];
    }

    return [
      {
        name: 'ask_question',
        description:
          'Ask the user a question with selectable options above the prompt field. Waits for one selected answer. Ask one question at a time; do not use this tool for approvals or secrets.',
        inputSchema: askQuestionSchema,
        execute: async (input, signal, context) => {
          if (!this.loadConfig().toolsEnabled) {
            throw new Error('Question tools are disabled');
          }
          const task = context.getTaskContext();
          if (!task) {
            throw new Error('No active task context available');
          }
          signal?.throwIfAborted();
          const parsed = askQuestionSchema.parse(input);
          const key = this.getTaskKey(context, task.data.id);
          if (this.pendingQuestions.has(key) || this.taskStates.get(key)?.isActive) {
            throw new Error('A questionnaire is already active for this task. Wait for it to finish before asking another question.');
          }

          return new Promise<QuestionResult>((resolve) => {
            let settled = false;
            const handleAbort = () => finish({ cancelled: true, reason: 'Agent cancelled' });
            const finish = (result: QuestionResult) => {
              if (settled) {
                return;
              }
              settled = true;
              signal?.removeEventListener('abort', handleAbort);
              this.pendingQuestions.delete(key);
              context.triggerUIDataRefresh('questions-ask-question', task.data.id);
              resolve(result);
            };
            this.pendingQuestions.set(key, {
              ...parsed,
              id: randomUUID(),
              finish,
            });
            signal?.addEventListener('abort', handleAbort, { once: true });
            context.triggerUIDataRefresh('questions-ask-question', task.data.id);
          });
        },
      },
    ];
  }

  getCommands(): CommandDefinition[] {
    return [
      {
        name: 'questions',
        description: 'Extract questions from the last message and display as questionnaire',
        arguments: [],
        execute: async (_args: string[], context: ExtensionContext): Promise<void> => {
          const taskContext = context.getTaskContext();
          if (!taskContext) {
            context.log('No active task context available', 'error');
            return;
          }

          const key = this.getTaskKey(context, taskContext.data.id);
          if (this.pendingQuestions.has(key)) {
            taskContext.addLogMessage('warning', 'Answer or dismiss the active question first');
            return;
          }

          const messages = await taskContext.getContextMessages();
          if (messages.length === 0) {
            taskContext.addLogMessage('warning', 'No messages found to extract questions from');
            return;
          }

          const lastMessage = messages[messages.length - 1];

          let messageText = '';
          if (typeof lastMessage.content === 'string') {
            messageText = lastMessage.content;
          } else if (Array.isArray(lastMessage.content)) {
            const textParts = lastMessage.content.filter((part) => part.type === 'text');
            messageText = textParts.map((part) => (part as { type: 'text'; text: string }).text).join('\n');
          }

          if (!messageText.trim()) {
            taskContext.addLogMessage('warning', 'Last message has no text content to extract questions from');
            return;
          }

          taskContext.addLoadingMessage('Extracting questions from the last message...');

          const extensionConfig = this.loadConfig();

          let modelId: string;
          if (extensionConfig.customModelId) {
            modelId = extensionConfig.customModelId;
          } else {
            const agentProfile = await taskContext.getTaskAgentProfile();
            if (!agentProfile) {
              taskContext.addLogMessage('error', 'No agent profile available');
              return;
            }
            modelId = `${agentProfile.provider}/${agentProfile.model}`;
          }

          const systemPrompt = `You are a question extraction assistant. Your task is to identify and extract all questions from the given text.

Rules:
1. Extract only actual questions (sentences ending with "?")
2. Preserve the original wording of each question
3. Return the questions in JSON format as an array of strings
4. If no questions are found, return an empty array
5. Return ONLY the JSON array, no additional text or explanation

Example input: "What is the purpose of this function? How does it handle errors? This is not a question."
Example output: ["What is the purpose of this function?", "How does it handle errors?"]`;

          const prompt = `Extract all questions from the following text:

${messageText}`;

          try {
            const result = await taskContext.generateText(modelId, systemPrompt, prompt);

            if (!result) {
              taskContext.addLogMessage('error', 'Failed to generate questions');
              return;
            }

            let questions: string[] = [];
            try {
              const cleanedResult = result
                .trim()
                .replace(/^```json\s*/i, '')
                .replace(/\s*```$/, '');
              questions = JSON.parse(cleanedResult);

              if (!Array.isArray(questions)) {
                throw new Error('Result is not an array');
              }
            } catch {
              context.log(`Failed to parse questions JSON: ${result}`, 'error');
              taskContext.addLogMessage('error', 'Failed to parse extracted questions');
              return;
            }

            if (questions.length === 0) {
              taskContext.addLogMessage('warning', 'No questions found in the last message');
              return;
            }

            const questionObjects: Question[] = questions.map((q, index) => ({
              id: `q-${Date.now()}-${index}`,
              text: q,
            }));

            if (this.pendingQuestions.has(key)) {
              taskContext.addLogMessage('warning', 'Answer or dismiss the active question first');
              return;
            }
            this.setQuestions(key, questionObjects);

            taskContext.addLoadingMessage('Extracting questions from the last message...', true);

            context.triggerUIDataRefresh('questions-questionnaire', taskContext.data.id);
          } catch (error) {
            context.log(`Error extracting questions: ${error}`, 'error');
            taskContext.addLogMessage('error', 'Failed to extract questions');
          }
        },
      },
    ];
  }

  getUIComponents(): UIComponentDefinition[] {
    const jsx = readFileSync(join(__dirname, 'Questions.jsx'), 'utf-8');

    return [
      {
        id: 'questions-ask-question-tool-message',
        placement: 'task-message',
        jsx: readFileSync(join(__dirname, 'AskQuestionToolMessage.jsx'), 'utf-8'),
        messageFilter: {
          types: ['tool'],
          serverName: 'extensions',
          toolName: 'ask_question',
        },
      },
      {
        id: 'questions-ask-question',
        placement: 'task-input-above',
        jsx: readFileSync(join(__dirname, 'AskQuestion.jsx'), 'utf-8'),
        loadData: true,
        noDataCache: true,
      },
      {
        id: 'questions-questionnaire',
        placement: 'task-input-above',
        jsx,
        loadData: true,
        noDataCache: true,
      },
    ];
  }

  async getUIExtensionData(componentId: string, context: ExtensionContext): Promise<unknown> {
    if (componentId === 'questions-ask-question') {
      const task = context.getTaskContext();
      const pending = task && this.pendingQuestions.get(this.getTaskKey(context, task.data.id));
      return pending
        ? {
            id: pending.id,
            question: pending.question,
            options: pending.options,
          }
        : null;
    }
    if (componentId === 'questions-questionnaire') {
      const taskContext = context.getTaskContext();
      if (!taskContext) {
        return { isActive: false, questions: [], currentIndex: 0 };
      }

      const state = this.taskStates.get(this.getTaskKey(context, taskContext.data.id));
      if (!state) {
        return { isActive: false, questions: [], currentIndex: 0 };
      }

      return {
        isActive: state.isActive,
        questions: state.questions,
        currentIndex: state.currentIndex,
        totalQuestions: state.questions.length,
      };
    }
    return undefined;
  }

  async executeUIExtensionAction(componentId: string, action: string, args: unknown[], context: ExtensionContext): Promise<unknown> {
    if (componentId === 'questions-ask-question') {
      const task = context.getTaskContext();
      const pending = task && this.pendingQuestions.get(this.getTaskKey(context, task.data.id));
      if (!pending || args[0] !== pending.id) {
        return { success: false, error: 'Question is no longer active' };
      }
      if (action === 'cancel') {
        pending.finish({
          cancelled: true,
          reason: 'User dismissed the question',
        });
        return { success: true };
      }
      if (action === 'answer' && typeof args[1] === 'string' && pending.options.includes(args[1])) {
        pending.finish({ question: pending.question, answer: args[1] });
        return { success: true };
      }
      return { success: false, error: 'Invalid action or option' };
    }
    if (componentId === 'questions-questionnaire') {
      const taskContext = context.getTaskContext();
      if (!taskContext) {
        return { success: false, error: 'No task context' };
      }

      const taskId = taskContext.data.id;
      const key = this.getTaskKey(context, taskId);
      const state = this.taskStates.get(key);

      if (!state) {
        return { success: false, error: 'No questions state' };
      }

      if (action === 'navigate') {
        const direction = args[0] as 'prev' | 'next';
        if (direction === 'prev' && state.currentIndex > 0) {
          state.currentIndex--;
        } else if (direction === 'next' && state.currentIndex < state.questions.length - 1) {
          state.currentIndex++;
        }
        context.triggerUIDataRefresh('questions-questionnaire', taskId);
        return { success: true };
      }

      if (action === 'close') {
        state.isActive = false;
        context.triggerUIDataRefresh('questions-questionnaire', taskId);
        return { success: true };
      }

      if (action === 'submit-answers') {
        const answersArray = args[0] as Array<{
          id: string;
          text: string;
          answer: string;
        }>;

        if (!answersArray || answersArray.length === 0) {
          taskContext.addLogMessage('warning', 'No answers provided');
          return { success: false, error: 'No answers' };
        }

        const answeredQuestions = answersArray.filter((q) => q.answer && q.answer.trim());
        if (answeredQuestions.length === 0) {
          taskContext.addLogMessage('warning', 'No questions have been answered');
          return { success: false, error: 'No answers' };
        }

        const answersText = answersArray
          .map((q, index) => {
            if (q.answer && q.answer.trim()) {
              return `Q${index + 1}: ${q.text}\nA${index + 1}: ${q.answer}`;
            }
            return null;
          })
          .filter(Boolean)
          .join('\n\n');

        const prompt = `Here are the answers to the questions:\n\n${answersText}`;

        void taskContext.runPrompt(prompt, 'agent');

        state.isActive = false;
        this.taskStates.delete(key);

        context.triggerUIDataRefresh('questions-questionnaire', taskId);

        return { success: true };
      }
    }
    return { success: false, error: 'Unknown action' };
  }

  private setQuestions(key: string, questions: Question[]): void {
    this.taskStates.set(key, {
      questions,
      currentIndex: 0,
      isActive: true,
    });
  }
}
