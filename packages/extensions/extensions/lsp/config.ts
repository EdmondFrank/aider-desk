import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const serverOverrideSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  initializationOptions: z.record(z.string(), z.unknown()).optional(),
});

export const configSchema = z.object({
  autoInstall: z.boolean().default(true),
  installTimeoutMs: z.number().int().min(100).max(900000).default(180000),
  serverCacheDir: z.string().default(''),
  diagnosticTimeoutMs: z.number().int().min(1).max(60000).default(3000),
  requestTimeoutMs: z.number().int().min(1).max(120000).default(30000),
  shutdownTimeoutMs: z.number().int().min(1).max(10000).default(1000),
  maxServers: z.number().int().min(1).max(64).default(4),
  maxConcurrentStarts: z.number().int().min(1).max(8).default(2),
  maxOpenDocuments: z.number().int().min(1).max(1000).default(32),
  maxDiagnosticsPerDocument: z.number().int().min(1).max(10000).default(200),
  maxFileBytes: z.number().int().min(1).max(100000000).default(2000000),
  maxPendingOperations: z.number().int().min(1).max(10000).default(128),
  idleTimeoutMs: z.number().int().min(100).max(3600000).default(300000),
  discoveryRetryMs: z.number().int().min(100).max(300000).default(30000),
  workspaceRoots: z.record(z.string(), z.string()).default({}),
  servers: z.record(z.string(), serverOverrideSchema).default({}),
});

export type LspConfig = z.infer<typeof configSchema>;
export const DEFAULT_CONFIG: LspConfig = configSchema.parse({});
const configFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config.json');

export const loadConfig = async (): Promise<LspConfig> => {
  try {
    return configSchema.parse(JSON.parse(await fs.readFile(configFile, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return configSchema.parse({});
    }
    throw error;
  }
};

export const saveConfig = async (value: unknown): Promise<LspConfig> => {
  const config = configSchema.parse(value);
  await fs.writeFile(configFile, JSON.stringify(config, null, 2), 'utf8');
  return config;
};
