vi.mock('@/logger');

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpOAuthStatus } from '@common/types';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';

import { McpOAuthManager } from '../mcp-oauth-manager';

const temporaryDirectories: string[] = [];

const createManager = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aider-desk-mcp-oauth-'));
  temporaryDirectories.push(directory);
  const storePath = path.join(directory, 'mcp-oauth.json');
  const manager = new McpOAuthManager(storePath);
  await manager.init();
  return { manager, storePath };
};

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('McpOAuthManager', () => {
  it('persists OAuth provider state and tokens across restarts', async () => {
    const { manager, storePath } = await createManager();
    const serverUrl = 'https://mcp.example.com/mcp';
    const provider = await manager.getProvider(serverUrl);
    const state = await provider.state?.();

    expect(state).toBeTruthy();
    await provider.saveState?.(state!);
    await provider.saveCodeVerifier('verifier');
    await provider.saveClientInformation?.({ client_id: 'client-id', client_secret: 'client-secret' });
    await provider.saveAuthorizationServerInformation?.({
      authorizationServerUrl: 'https://mcp.example.com',
      tokenEndpoint: 'https://mcp.example.com/oauth/token',
    });
    await provider.redirectToAuthorization(new URL(`https://mcp.example.com/oauth/authorize?state=${state}`));

    expect(await manager.getStatus(serverUrl)).toEqual({ status: McpOAuthStatus.AuthenticationRequired });
    expect(await manager.startAuthorization(serverUrl)).toContain('/oauth/authorize');
    expect(await manager.getStatus(serverUrl)).toEqual({ status: McpOAuthStatus.Authorizing });

    await provider.saveTokens({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_type: 'Bearer',
      expires_in: 3600,
    });

    const reloadedManager = new McpOAuthManager(storePath);
    await reloadedManager.init();
    expect(await reloadedManager.getStatus(serverUrl)).toEqual({ status: McpOAuthStatus.Authenticated });
    expect(await (await reloadedManager.getProvider(serverUrl)).tokens()).toMatchObject({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    });

    if (process.platform !== 'win32') {
      expect((await fs.stat(storePath)).mode & 0o777).toBe(0o600);
    }
  });

  it('clears credentials while remembering that authentication is required', async () => {
    const { manager } = await createManager();
    const serverUrl = 'https://mcp.example.com/mcp';
    const provider = await manager.getProvider(serverUrl);
    await provider.saveTokens({ access_token: 'access-token', token_type: 'Bearer' });

    await manager.disconnect(serverUrl);

    expect(await manager.getStatus(serverUrl)).toEqual({ status: McpOAuthStatus.AuthenticationRequired });
    expect(await (await manager.getProvider(serverUrl)).tokens()).toBeUndefined();
  });

  it('clears a pending authorization after an OAuth error', async () => {
    const { manager } = await createManager();
    const serverUrl = 'https://mcp.example.com/mcp';
    const provider = await manager.getProvider(serverUrl);
    await provider.saveState?.('expected-state');
    await provider.redirectToAuthorization(new URL('https://mcp.example.com/oauth/authorize'));
    await manager.startAuthorization(serverUrl);

    await manager.cancelAuthorization('expected-state');

    expect(await manager.getStatus(serverUrl)).toEqual({ status: McpOAuthStatus.AuthenticationRequired });
    expect(await manager.startAuthorization(serverUrl)).toBeNull();
  });

  it.each(['http://login.example.com', 'https://user:password@login.example.com', 'https://login.example.com/oauth#frag'])(
    'rejects unsafe OAuth URL %s',
    async (unsafeUrl) => {
      const { manager } = await createManager();
      const serverUrl = 'https://mcp.example.com/mcp';
      const provider = await manager.getProvider(serverUrl);
      const validatedFetch = manager.createValidatedFetch(serverUrl);

      expect(() => provider.validateAuthorizationServerURL?.(serverUrl, unsafeUrl)).toThrow('OAuth URLs must use HTTPS');
      await expect((await manager.getMcpSdkProvider(serverUrl)).redirectToAuthorization(new URL(unsafeUrl))).rejects.toThrow('OAuth URLs must use HTTPS');
      await expect(validatedFetch(unsafeUrl)).rejects.toThrow('OAuth URLs must use HTTPS');
    },
  );

  it('completes Appwrite discovery, registration, callback, and refresh from the MCP URL alone', async () => {
    const { manager, storePath } = await createManager();
    const serverUrl = 'https://mcp.appwrite.io/';
    const issuer = 'https://fra.cloud.appwrite.io/v1/oauth2/console';
    const discoveryUrl = 'https://fra.cloud.appwrite.io/.well-known/oauth-authorization-server/v1/oauth2/console';
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      switch (input.toString()) {
        case 'https://mcp.appwrite.io/.well-known/oauth-protected-resource':
          return Response.json({
            resource: serverUrl,
            authorization_servers: [issuer],
          });
        case discoveryUrl:
          return Response.json({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            registration_endpoint: `${issuer}/register`,
            response_types_supported: ['code'],
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['none'],
          });
        case `${issuer}/register`:
          return Response.json({
            ...JSON.parse(init?.body?.toString() ?? '{}'),
            client_id: 'appwrite-client',
          });
        case `${issuer}/token`:
          expect(init?.redirect).toBe('error');
          expect(new URLSearchParams(init?.body?.toString()).get('resource')).toBe(serverUrl);
          return Response.json({
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            token_type: 'Bearer',
          });
        case serverUrl:
          return new Response(null, { status: 204 });
        default:
          throw new Error(`Unexpected fetch: ${input.toString()}`);
      }
    });
    vi.stubGlobal('fetch', fetchMock);
    const validatedFetch = manager.createValidatedFetch(serverUrl, { 'X-MCP-Key': 'resource-only' });
    await validatedFetch(serverUrl);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('X-MCP-Key')).toBe('resource-only');

    const provider = await manager.getMcpSdkProvider(serverUrl);
    expect(await auth(provider, { serverUrl, fetchFn: validatedFetch })).toBe('REDIRECT');
    const authorizationUrl = new URL((await manager.startAuthorization(serverUrl))!);
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(`${issuer}/authorize`);
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl.searchParams.get('resource')).toBe(serverUrl);
    const reloaded = new McpOAuthManager(storePath);
    expect(await reloaded.completeAuthorization('test-code', authorizationUrl.searchParams.get('state')!)).toBe(serverUrl);
    expect(await reloaded.getStatus(serverUrl)).toEqual({ status: McpOAuthStatus.Authenticated });
    expect(await (await reloaded.getProvider('https://different-mcp.example.com/')).tokens()).toBeUndefined();
    const refreshFetch = reloaded.createValidatedFetch(serverUrl);
    expect(await auth(await reloaded.getMcpSdkProvider(serverUrl), { serverUrl, fetchFn: refreshFetch })).toBe('AUTHORIZED');
    const tokenRequests = fetchMock.mock.calls.filter(([url]) => url.toString() === `${issuer}/token`);
    expect(tokenRequests.map(([, init]) => new URLSearchParams(init?.body?.toString()).get('grant_type'))).toEqual(['authorization_code', 'refresh_token']);
    for (const [, init] of fetchMock.mock.calls.slice(1)) {
      expect(new Headers(init?.headers).has('X-MCP-Key')).toBe(false);
    }
  });
});
