import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';

import {
  auth,
  type OAuthAuthorizationServerInformation,
  type OAuthClientInformation,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
} from '@ai-sdk/mcp';
import { McpOAuthStatus, type McpOAuthStatusData } from '@common/types';
import {
  auth as mcpSdkAuth,
  type OAuthClientProvider as McpSdkOAuthClientProvider,
  type OAuthDiscoveryState as McpSdkOAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';

import { AIDER_DESK_DATA_DIR, MCP_OAUTH_CALLBACK_PATH, SERVER_PORT } from '@/constants';
import { isElectron } from '@/app';
import logger from '@/logger';

const MCP_OAUTH_STORE_VERSION = 1;
const MCP_OAUTH_STORE_FILE = path.join(AIDER_DESK_DATA_DIR, 'mcp-oauth.json');
const AUTHORIZATION_TIMEOUT_MS = 10 * 60 * 1000;

type McpOAuthRecord = {
  serverUrl: string;
  oauthRequired: boolean;
  tokens?: OAuthTokens;
  clientInformation?: OAuthClientInformation;
  authorizationServerInformation?: OAuthAuthorizationServerInformation;
  discoveryState?: McpSdkOAuthDiscoveryState;
  codeVerifier?: string;
  state?: string;
  authorizationUrl?: string;
  authorizationStartedAt?: number;
  authorizationFromMcpSdk?: boolean;
};

type PlainStoreData = {
  version: number;
  records: Record<string, McpOAuthRecord>;
};

type EncryptedStoreData = {
  version: number;
  encrypted: string;
};

type StoreData = PlainStoreData | EncryptedStoreData;

const normalizeServerUrl = (serverUrl: string): string => {
  const url = new URL(serverUrl);
  url.hash = '';
  return url.toString();
};

const isLoopbackHostname = (hostname: string): boolean => hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

const validateOAuthUrl = (candidateUrl: string | URL): void => {
  const candidate = new URL(candidateUrl);
  if (
    candidate.username ||
    candidate.password ||
    candidate.hash ||
    (candidate.protocol !== 'https:' && !(candidate.protocol === 'http:' && isLoopbackHostname(candidate.hostname)))
  ) {
    throw new Error('OAuth URLs must use HTTPS without credentials or fragments (HTTP is allowed on loopback)');
  }
};

export class McpOAuthManager {
  private records: Record<string, McpOAuthRecord> = {};
  private initPromise: Promise<void> | null = null;
  private savePromise: Promise<void> = Promise.resolve();

  constructor(private readonly storeFilePath = MCP_OAUTH_STORE_FILE) {}

  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.load();
    }
    return this.initPromise;
  }

  async getProvider(serverUrl: string): Promise<OAuthClientProvider> {
    await this.init();
    const normalizedUrl = normalizeServerUrl(serverUrl);
    this.ensureRecord(normalizedUrl);

    const clientMetadata: OAuthClientMetadata = {
      client_name: 'AiderDesk',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };

    return {
      redirectUrl: this.redirectUrl,
      clientMetadata,
      clientInformation: () => this.records[normalizedUrl]?.clientInformation,
      saveClientInformation: async (clientInformation) => {
        this.ensureRecord(normalizedUrl).clientInformation = clientInformation;
        await this.save();
      },
      tokens: () => this.records[normalizedUrl]?.tokens,
      saveTokens: async (tokens) => {
        const record = this.ensureRecord(normalizedUrl);
        record.tokens = tokens;
        record.oauthRequired = true;
        delete record.authorizationUrl;
        delete record.authorizationFromMcpSdk;
        delete record.authorizationStartedAt;
        delete record.codeVerifier;
        delete record.state;
        await this.save();
      },
      redirectToAuthorization: (authorizationUrl) => this.saveAuthorizationUrl(normalizedUrl, authorizationUrl, false),
      saveCodeVerifier: async (codeVerifier) => {
        this.ensureRecord(normalizedUrl).codeVerifier = codeVerifier;
        await this.save();
      },
      codeVerifier: () => {
        const codeVerifier = this.records[normalizedUrl]?.codeVerifier;
        if (!codeVerifier) {
          throw new Error('OAuth PKCE code verifier is missing or expired');
        }
        return codeVerifier;
      },
      state: async () => await this.createAndSaveState(normalizedUrl),
      saveState: async (state) => {
        this.ensureRecord(normalizedUrl).state = state;
        await this.save();
      },
      storedState: () => this.records[normalizedUrl]?.state,
      authorizationServerInformation: () => this.records[normalizedUrl]?.authorizationServerInformation,
      saveAuthorizationServerInformation: async (authorizationServerInformation) => {
        validateOAuthUrl(authorizationServerInformation.authorizationServerUrl);
        validateOAuthUrl(authorizationServerInformation.tokenEndpoint);
        this.ensureRecord(normalizedUrl).authorizationServerInformation = authorizationServerInformation;
        await this.save();
      },
      invalidateCredentials: async (scope) => {
        const record = this.ensureRecord(normalizedUrl);
        if (scope === 'all' || scope === 'tokens') {
          delete record.tokens;
        }
        if (scope === 'all' || scope === 'client') {
          delete record.clientInformation;
          delete record.authorizationServerInformation;
          delete record.discoveryState;
        }
        if (scope === 'all' || scope === 'verifier') {
          delete record.codeVerifier;
          delete record.state;
          delete record.authorizationUrl;
          delete record.authorizationFromMcpSdk;
          delete record.authorizationStartedAt;
        }
        await this.save();
      },
      validateAuthorizationServerURL: (_registeredServerUrl, authorizationServerUrl) => {
        validateOAuthUrl(authorizationServerUrl);
      },
    };
  }

  async getMcpSdkProvider(serverUrl: string): Promise<McpSdkOAuthClientProvider> {
    const provider = await this.getProvider(serverUrl);
    const normalizedUrl = normalizeServerUrl(serverUrl);

    return {
      redirectUrl: provider.redirectUrl,
      clientMetadata: provider.clientMetadata,
      clientInformation: provider.clientInformation,
      saveClientInformation: provider.saveClientInformation,
      tokens: provider.tokens,
      saveTokens: provider.saveTokens,
      redirectToAuthorization: (authorizationUrl) => this.saveAuthorizationUrl(normalizedUrl, authorizationUrl, true),
      saveCodeVerifier: provider.saveCodeVerifier,
      codeVerifier: provider.codeVerifier,
      state: async () => await this.createAndSaveState(normalizedUrl),
      invalidateCredentials: async (scope) => {
        if (scope === 'discovery') {
          const record = this.ensureRecord(normalizedUrl);
          delete record.discoveryState;
          delete record.authorizationServerInformation;
          await this.save();
          return;
        }
        await provider.invalidateCredentials?.(scope);
      },
      saveDiscoveryState: async (discoveryState) => {
        validateOAuthUrl(discoveryState.authorizationServerUrl);
        if (discoveryState.resourceMetadataUrl) {
          validateOAuthUrl(discoveryState.resourceMetadataUrl);
        }
        const metadata = discoveryState.authorizationServerMetadata;
        for (const endpoint of [metadata?.authorization_endpoint, metadata?.token_endpoint, metadata?.registration_endpoint]) {
          if (endpoint) {
            validateOAuthUrl(endpoint);
          }
        }
        const record = this.ensureRecord(normalizedUrl);
        record.discoveryState = discoveryState;
        if (metadata?.token_endpoint) {
          record.authorizationServerInformation = {
            authorizationServerUrl: discoveryState.authorizationServerUrl,
            issuer: metadata.issuer,
            tokenEndpoint: metadata.token_endpoint,
          };
        }
        await this.save();
      },
      discoveryState: () => this.records[normalizedUrl]?.discoveryState,
      validateResourceURL: provider.validateResourceURL,
    };
  }

  createValidatedFetch(serverUrl: string, resourceHeaders?: Readonly<Record<string, string>>): typeof fetch {
    const server = new URL(normalizeServerUrl(serverUrl));

    return async (input, init) => {
      const requestUrl = new URL(input instanceof Request ? input.url : input.toString());
      const isMcpEndpoint = requestUrl.origin === server.origin && requestUrl.pathname === server.pathname;
      if (!isMcpEndpoint) {
        validateOAuthUrl(requestUrl);
      }
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (isMcpEndpoint && resourceHeaders) {
        for (const [name, value] of Object.entries(resourceHeaders)) {
          headers.set(name, value);
        }
      }
      return await fetch(input, {
        ...init,
        headers,
        redirect: isMcpEndpoint && init?.redirect === 'manual' ? 'manual' : 'error',
      });
    };
  }

  async getStatus(serverUrl: string): Promise<McpOAuthStatusData> {
    await this.init();
    const record = this.records[normalizeServerUrl(serverUrl)];
    if (!record?.oauthRequired) {
      return { status: McpOAuthStatus.NotRequired };
    }
    if (record.tokens?.access_token) {
      return { status: McpOAuthStatus.Authenticated };
    }
    if (record.authorizationStartedAt && Date.now() - record.authorizationStartedAt < AUTHORIZATION_TIMEOUT_MS) {
      return { status: McpOAuthStatus.Authorizing };
    }
    return { status: McpOAuthStatus.AuthenticationRequired };
  }

  async getPendingAuthorizationUrl(serverUrl: string): Promise<string | null> {
    await this.init();
    const record = this.records[normalizeServerUrl(serverUrl)];
    if (!record?.authorizationStartedAt || Date.now() - record.authorizationStartedAt >= AUTHORIZATION_TIMEOUT_MS) {
      return null;
    }
    return record.authorizationUrl ?? null;
  }

  async resetClientRegistration(serverUrl: string): Promise<void> {
    await this.init();
    const record = this.records[normalizeServerUrl(serverUrl)];
    if (record) {
      delete record.clientInformation;
      delete record.tokens;
      await this.clearPendingAuthorization(serverUrl);
    }
  }

  async startAuthorization(serverUrl: string): Promise<string | null> {
    await this.init();
    const record = this.records[normalizeServerUrl(serverUrl)];
    if (!record?.authorizationUrl) {
      return null;
    }
    record.authorizationStartedAt = Date.now();
    await this.save();
    return record.authorizationUrl;
  }

  async completeAuthorization(code: string, state: string): Promise<string> {
    await this.init();
    const record = Object.values(this.records).find((candidate) => candidate.state === state && candidate.authorizationUrl);
    if (!record?.authorizationStartedAt) {
      throw new Error('OAuth authorization request is invalid or expired');
    }
    if (Date.now() - record.authorizationStartedAt >= AUTHORIZATION_TIMEOUT_MS) {
      await this.clearPendingAuthorization(record.serverUrl);
      throw new Error('OAuth authorization request has expired');
    }

    try {
      const fetchFn = this.createValidatedFetch(record.serverUrl);
      const options = { serverUrl: record.serverUrl, authorizationCode: code, fetchFn };
      const issuer = record.authorizationServerInformation?.authorizationServerUrl;
      // Use the same SDK for a cross-origin exchange so it sends the same resource indicator as the authorize request.
      const result =
        record.authorizationFromMcpSdk && issuer && new URL(issuer).origin !== new URL(record.serverUrl).origin
          ? await mcpSdkAuth(await this.getMcpSdkProvider(record.serverUrl), options)
          : await auth(await this.getProvider(record.serverUrl), { ...options, callbackState: state });
      if (result !== 'AUTHORIZED') {
        throw new Error('OAuth authorization did not complete');
      }
      return record.serverUrl;
    } catch (error) {
      await this.clearPendingAuthorization(record.serverUrl);
      throw error;
    }
  }

  async cancelAuthorization(state: string): Promise<void> {
    await this.init();
    const record = Object.values(this.records).find((candidate) => candidate.state === state);
    if (record) {
      await this.clearPendingAuthorization(record.serverUrl);
    }
  }

  async disconnect(serverUrl: string): Promise<void> {
    await this.init();
    const normalizedUrl = normalizeServerUrl(serverUrl);
    this.records[normalizedUrl] = {
      serverUrl: normalizedUrl,
      oauthRequired: true,
    };
    await this.save();
  }

  async clearPendingAuthorization(serverUrl: string): Promise<void> {
    await this.init();
    const record = this.records[normalizeServerUrl(serverUrl)];
    if (!record) {
      return;
    }
    delete record.authorizationUrl;
    delete record.authorizationFromMcpSdk;
    delete record.authorizationStartedAt;
    delete record.codeVerifier;
    delete record.state;
    await this.save();
  }

  private async createAndSaveState(serverUrl: string): Promise<string> {
    const state = randomBytes(32).toString('hex');
    this.ensureRecord(serverUrl).state = state;
    await this.save();
    return state;
  }

  private async saveAuthorizationUrl(serverUrl: string, url: URL, fromMcpSdk: boolean): Promise<void> {
    validateOAuthUrl(url);
    const record = this.ensureRecord(serverUrl);
    record.oauthRequired = true;
    record.authorizationUrl = url.toString();
    record.authorizationFromMcpSdk = fromMcpSdk;
    delete record.authorizationStartedAt;
    await this.save();
  }

  private get redirectUrl(): string {
    return `http://localhost:${SERVER_PORT}${MCP_OAUTH_CALLBACK_PATH}`;
  }

  private ensureRecord(serverUrl: string): McpOAuthRecord {
    const normalizedUrl = normalizeServerUrl(serverUrl);
    const existing = this.records[normalizedUrl];
    if (existing) {
      return existing;
    }
    const record: McpOAuthRecord = {
      serverUrl: normalizedUrl,
      oauthRequired: false,
    };
    this.records[normalizedUrl] = record;
    return record;
  }

  private async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.storeFilePath, 'utf8');
      const store = JSON.parse(content) as StoreData;
      if (store.version !== MCP_OAUTH_STORE_VERSION) {
        logger.warn('Ignoring unsupported MCP OAuth credential store version');
        return;
      }
      if ('encrypted' in store) {
        const safeStorage = await this.getSafeStorage();
        if (!safeStorage) {
          throw new Error('Electron secure storage is unavailable');
        }
        const decrypted = safeStorage.decryptString(Buffer.from(store.encrypted, 'base64'));
        this.records = (JSON.parse(decrypted) as PlainStoreData).records;
      } else {
        this.records = store.records;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error('Failed to load MCP OAuth credentials:', error);
      }
      this.records = {};
    }
  }

  private save(): Promise<void> {
    this.savePromise = this.savePromise
      .catch(() => undefined)
      .then(async () => {
        const plainStore: PlainStoreData = {
          version: MCP_OAUTH_STORE_VERSION,
          records: this.records,
        };
        const safeStorage = await this.getSafeStorage();
        const store: StoreData = safeStorage
          ? {
              version: MCP_OAUTH_STORE_VERSION,
              encrypted: safeStorage.encryptString(JSON.stringify(plainStore)).toString('base64'),
            }
          : plainStore;
        const temporaryPath = `${this.storeFilePath}.${process.pid}.tmp`;
        await fs.mkdir(path.dirname(this.storeFilePath), { recursive: true });
        await fs.writeFile(temporaryPath, JSON.stringify(store), { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temporaryPath, this.storeFilePath);
        if (process.platform !== 'win32') {
          await fs.chmod(this.storeFilePath, 0o600);
        }
      });
    return this.savePromise;
  }

  private async getSafeStorage() {
    if (!isElectron()) {
      return null;
    }
    try {
      const { safeStorage } = await import('electron');
      return safeStorage.isEncryptionAvailable() ? safeStorage : null;
    } catch {
      return null;
    }
  }
}
