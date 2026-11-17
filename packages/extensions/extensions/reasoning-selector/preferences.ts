import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const REASONING_OPTIONS = [
  { value: '', label: 'Use default' },
  { value: 'none', label: 'None' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'xHigh' },
];

type Preferences = {
  version: 1;
  preferences: Record<string, Record<string, string>>;
};

const pendingWrites = new Map<string, Promise<void>>();

export const isReasoningEffort = (value: unknown): value is string => typeof value === 'string' && REASONING_OPTIONS.some((option) => option.value === value);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const getPreferencesPath = (projectDir: string): string => join(projectDir, '.aider-desk', 'reasoning-selector.json');

const readPreferences = async (path: string): Promise<Preferences> => {
  let contents: string;
  try {
    contents = await readFile(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, preferences: {} };
    }
    throw error;
  }

  const data: unknown = JSON.parse(contents);
  if (
    !isRecord(data) ||
    data.version !== 1 ||
    !isRecord(data.preferences) ||
    !Object.values(data.preferences).every((models) => isRecord(models) && Object.values(models).every(isReasoningEffort))
  ) {
    throw new Error(`Invalid reasoning preferences in ${path}`);
  }
  return data as Preferences;
};

export const getReasoningPreference = async (projectDir: string, provider: string, model: string): Promise<string> => {
  const path = getPreferencesPath(projectDir);
  await pendingWrites.get(path);
  const data = await readPreferences(path);
  const models = Object.hasOwn(data.preferences, provider) ? data.preferences[provider] : undefined;
  return models && Object.hasOwn(models, model) ? models[model] : '';
};

export const saveReasoningPreference = async (projectDir: string, provider: string, model: string, value: string): Promise<void> => {
  const path = getPreferencesPath(projectDir);
  const previousWrite = pendingWrites.get(path);
  const write = (async () => {
    await previousWrite?.catch(() => undefined);
    const data = await readPreferences(path);
    const models = Object.hasOwn(data.preferences, provider) ? data.preferences[provider] : {};
    data.preferences = {
      ...data.preferences,
      [provider]: { ...models, [model]: value },
    };
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(data, null, 2), 'utf-8');
      await rename(temporaryPath, path);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  })();
  pendingWrites.set(path, write);
  try {
    await write;
  } finally {
    if (pendingWrites.get(path) === write) {
      pendingWrites.delete(path);
    }
  }
};
