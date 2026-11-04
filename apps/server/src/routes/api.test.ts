import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getValidAccessToken } from '../spotify/auth.js';
import { getMe } from '../spotify/client.js';
import { SpotifyAuthError, SpotifyHttpError } from '../spotify/errors.js';
import { apiRoutes } from './api.js';
import { buildTestApp } from './test-app.js';

vi.mock('../spotify/auth.js', () => ({ getValidAccessToken: vi.fn() }));
vi.mock('../spotify/client.js', () => ({ getMe: vi.fn() }));

const token = vi.mocked(getValidAccessToken);
const me = vi.mocked(getMe);

let app: FastifyInstance;

beforeEach(async () => {
  token.mockReset();
  me.mockReset();
  app = await buildTestApp(apiRoutes);
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/health', () => {
  it('reports ok', async () => {
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /api/me', () => {
  it('returns the profile with a camelCased display name', async () => {
    token.mockResolvedValue('tok');
    me.mockResolvedValue({ id: 'u1', display_name: 'Ada' });

    const res = await app.inject('/api/me');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 'u1', displayName: 'Ada' });
    expect(me).toHaveBeenCalledWith('tok');
  });

  it('401s with the auth reason when not connected', async () => {
    token.mockRejectedValue(new SpotifyAuthError('not_connected', 'no account'));

    const res = await app.inject('/api/me');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'not_connected' });
  });

  it('401s with reconnect_required when the token refresh failed', async () => {
    token.mockRejectedValue(new SpotifyAuthError('reconnect_required', 'expired'));

    const res = await app.inject('/api/me');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'reconnect_required' });
  });

  it('401s with reconnect_required when Spotify itself answers 401', async () => {
    token.mockResolvedValue('tok');
    me.mockRejectedValue(new SpotifyHttpError(401, 'unauthorized'));

    const res = await app.inject('/api/me');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'reconnect_required' });
  });

  it('502s on other Spotify HTTP errors without leaking details', async () => {
    token.mockResolvedValue('tok');
    me.mockRejectedValue(new SpotifyHttpError(500, 'internal secret detail'));

    const res = await app.inject('/api/me');
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'spotify_error' });
  });

  it('lets unexpected errors surface as a 500', async () => {
    token.mockRejectedValue(new Error('boom'));
    const res = await app.inject('/api/me');
    expect(res.statusCode).toBe(500);
  });
});
