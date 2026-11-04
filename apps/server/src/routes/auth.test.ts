import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';
import {
  beginAuthorization,
  clearTokens,
  exchangeCodeForToken,
  storeTokens,
  takePendingAuth,
} from '../spotify/auth.js';
import { authRoutes } from './auth.js';
import { buildTestApp } from './test-app.js';

vi.mock('../spotify/auth.js', () => ({
  beginAuthorization: vi.fn(),
  clearTokens: vi.fn(),
  exchangeCodeForToken: vi.fn(),
  storeTokens: vi.fn(),
  takePendingAuth: vi.fn(),
}));

const begin = vi.mocked(beginAuthorization);
const exchange = vi.mocked(exchangeCodeForToken);
const store = vi.mocked(storeTokens);
const takePending = vi.mocked(takePendingAuth);

let app: FastifyInstance;

beforeEach(async () => {
  vi.resetAllMocks();
  app = await buildTestApp(authRoutes);
});

afterEach(async () => {
  await app.close();
});

describe('GET /auth/login', () => {
  it('redirects to the Spotify authorize URL', async () => {
    begin.mockReturnValue('https://accounts.spotify.com/authorize?x=1');

    const res = await app.inject('/auth/login');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://accounts.spotify.com/authorize?x=1');
  });

  it('500s with spotify_not_configured when the client id is missing', async () => {
    begin.mockImplementation(() => {
      throw new Error('SPOTIFY_CLIENT_ID is not set');
    });

    const res = await app.inject('/auth/login');
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'spotify_not_configured' });
  });
});

describe('GET /auth/callback', () => {
  it('forwards a Spotify error (e.g. access_denied) to the web app', async () => {
    const res = await app.inject('/auth/callback?error=access_denied');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${config.webOrigin}/?auth_error=access_denied`);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('rejects an unknown or replayed state', async () => {
    takePending.mockReturnValue(undefined);

    const res = await app.inject('/auth/callback?code=abc&state=bad');
    expect(res.headers.location).toBe(`${config.webOrigin}/?auth_error=invalid_state`);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('rejects a callback without a code', async () => {
    takePending.mockReturnValue('verifier');

    const res = await app.inject('/auth/callback?state=ok');
    expect(res.headers.location).toBe(`${config.webOrigin}/?auth_error=invalid_state`);
  });

  it('exchanges the code with the stored verifier, saves tokens, and returns to the app', async () => {
    takePending.mockReturnValue('verifier');
    const tokens = {
      access_token: 'a',
      token_type: 'Bearer',
      scope: 's',
      expires_in: 3600,
      refresh_token: 'r',
    };
    exchange.mockResolvedValue(tokens);

    const res = await app.inject('/auth/callback?code=abc&state=ok');

    expect(exchange).toHaveBeenCalledWith('abc', 'verifier');
    expect(store).toHaveBeenCalledWith(tokens);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(config.webOrigin);
  });

  it('reports token_exchange_failed and stores nothing when the exchange throws', async () => {
    takePending.mockReturnValue('verifier');
    exchange.mockRejectedValue(new Error('invalid_grant'));

    const res = await app.inject('/auth/callback?code=abc&state=ok');
    expect(res.headers.location).toBe(`${config.webOrigin}/?auth_error=token_exchange_failed`);
    expect(store).not.toHaveBeenCalled();
  });

  it('url-encodes the error value it forwards', async () => {
    const res = await app.inject('/auth/callback?error=a%20b%26c');
    expect(res.headers.location).toBe(`${config.webOrigin}/?auth_error=a%20b%26c`);
  });
});

describe('POST /auth/disconnect', () => {
  it('clears the stored tokens and answers 204', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/disconnect' });
    expect(res.statusCode).toBe(204);
    expect(clearTokens).toHaveBeenCalledTimes(1);
  });
});
