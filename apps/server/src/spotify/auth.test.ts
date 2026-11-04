import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { getSetting, setSetting } from '../db/settings.js';
import {
  beginAuthorization,
  clearTokens,
  exchangeCodeForToken,
  getValidAccessToken,
  isConnected,
  storeTokens,
  takePendingAuth,
} from './auth.js';
import { SpotifyAuthError } from './errors.js';

const fetchMock = vi.fn();

function tokenJson(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      access_token: 'new-access',
      token_type: 'Bearer',
      scope: 'a b',
      expires_in: 3600,
      refresh_token: 'new-refresh',
      ...overrides,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

beforeEach(() => {
  db.exec('DELETE FROM settings;');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  config.spotifyClientId = 'test-client';
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function startFlow() {
  const url = new URL(beginAuthorization());
  return { url, state: url.searchParams.get('state') as string };
}

describe('beginAuthorization', () => {
  it('builds an Authorization Code + PKCE (S256) URL with no client secret', () => {
    const { url } = startFlow();

    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('test-client');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(config.spotifyRedirectUri);
    expect(url.searchParams.get('scope')).toContain('playlist-modify-private');
    expect(url.searchParams.has('client_secret')).toBe(false);
  });

  it('sends a code_challenge that is the base64url SHA-256 of the stored verifier', () => {
    const { url, state } = startFlow();
    const verifier = takePendingAuth(state) as string;

    const expected = createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    expect(url.searchParams.get('code_challenge')).toBe(expected);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('uses a fresh state and verifier every time', () => {
    const a = startFlow();
    const b = startFlow();
    expect(a.state).not.toBe(b.state);
    expect(takePendingAuth(a.state)).not.toBe(takePendingAuth(b.state));
  });

  it('refuses to start when SPOTIFY_CLIENT_ID is not configured', () => {
    config.spotifyClientId = '';
    expect(() => beginAuthorization()).toThrow(/SPOTIFY_CLIENT_ID/);
  });
});

describe('takePendingAuth', () => {
  it('is single-use: a state cannot be replayed', () => {
    const { state } = startFlow();
    expect(takePendingAuth(state)).toBeTypeOf('string');
    expect(takePendingAuth(state)).toBeUndefined();
  });

  it('returns undefined for a missing or unknown state', () => {
    expect(takePendingAuth(undefined)).toBeUndefined();
    expect(takePendingAuth('')).toBeUndefined();
    expect(takePendingAuth('not-a-real-state')).toBeUndefined();
  });

  it('expires a pending authorization after 10 minutes', () => {
    vi.useFakeTimers();
    const { state } = startFlow();
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(takePendingAuth(state)).toBeUndefined();
  });

  it('is still valid just inside the 10 minute window', () => {
    vi.useFakeTimers();
    const { state } = startFlow();
    vi.advanceTimersByTime(10 * 60 * 1000 - 1);
    expect(takePendingAuth(state)).toBeTypeOf('string');
  });
});

describe('exchangeCodeForToken', () => {
  it('posts the code and verifier to the token endpoint as form data', async () => {
    fetchMock.mockResolvedValue(tokenJson());

    const tokens = await exchangeCodeForToken('the-code', 'the-verifier');

    expect(tokens.access_token).toBe('new-access');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://accounts.spotify.com/api/token');
    expect(init.method).toBe('POST');
    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('code_verifier')).toBe('the-verifier');
    expect(body.get('client_id')).toBe('test-client');
    expect(body.has('client_secret')).toBe(false);
  });

  it('throws with status and body when the token endpoint rejects the code', async () => {
    fetchMock.mockResolvedValue(new Response('invalid_grant', { status: 400 }));
    await expect(exchangeCodeForToken('x', 'y')).rejects.toThrow(/returned 400: invalid_grant/);
  });
});

describe('token storage', () => {
  it('stores access/refresh tokens, scope and an absolute expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    storeTokens({
      access_token: 'a',
      token_type: 'Bearer',
      scope: 'x y',
      expires_in: 3600,
      refresh_token: 'r',
    });

    expect(getSetting('spotify_access_token')).toBe('a');
    expect(getSetting('spotify_refresh_token')).toBe('r');
    expect(getSetting('spotify_scope')).toBe('x y');
    expect(getSetting('spotify_token_expires_at')).toBe(String(1_000_000 + 3600 * 1000));
    expect(isConnected()).toBe(true);
  });

  it('keeps the existing refresh token when a refresh response omits it', () => {
    setSetting('spotify_refresh_token', 'original');
    storeTokens({ access_token: 'a2', token_type: 'Bearer', scope: 's', expires_in: 60 });
    expect(getSetting('spotify_refresh_token')).toBe('original');
    expect(getSetting('spotify_access_token')).toBe('a2');
  });

  it('clearTokens disconnects', () => {
    storeTokens({
      access_token: 'a',
      token_type: 'Bearer',
      scope: 's',
      expires_in: 60,
      refresh_token: 'r',
    });
    clearTokens();
    expect(isConnected()).toBe(false);
    expect(getSetting('spotify_access_token')).toBeUndefined();
    expect(getSetting('spotify_scope')).toBeUndefined();
  });
});

describe('getValidAccessToken', () => {
  it('throws not_connected when no refresh token is stored', async () => {
    const err = await getValidAccessToken().catch((e) => e);
    expect(err).toBeInstanceOf(SpotifyAuthError);
    expect(err.reason).toBe('not_connected');
  });

  it('returns the stored token without a network call while it is still fresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    storeTokens({
      access_token: 'fresh',
      token_type: 'Bearer',
      scope: 's',
      expires_in: 3600,
      refresh_token: 'r',
    });
    vi.setSystemTime(10 * 60 * 1000);

    await expect(getValidAccessToken()).resolves.toBe('fresh');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes ahead of expiry (60s skew) and stores the new token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    storeTokens({
      access_token: 'old',
      token_type: 'Bearer',
      scope: 's',
      expires_in: 3600,
      refresh_token: 'r',
    });
    vi.setSystemTime(3600 * 1000 - 30_000); // 30s before expiry, inside the skew window
    fetchMock.mockResolvedValue(tokenJson({ access_token: 'refreshed', refresh_token: undefined }));

    await expect(getValidAccessToken()).resolves.toBe('refreshed');

    const body = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('r');
    expect(getSetting('spotify_access_token')).toBe('refreshed');
    expect(getSetting('spotify_refresh_token')).toBe('r');
  });

  it('refreshes when the token has already expired', async () => {
    setSetting('spotify_refresh_token', 'r');
    setSetting('spotify_access_token', 'stale');
    setSetting('spotify_token_expires_at', '1');
    fetchMock.mockResolvedValue(tokenJson());

    await expect(getValidAccessToken()).resolves.toBe('new-access');
  });

  it('clears tokens and asks to reconnect when the refresh fails (e.g. expired refresh token)', async () => {
    setSetting('spotify_refresh_token', 'dead');
    setSetting('spotify_token_expires_at', '1');
    fetchMock.mockResolvedValue(new Response('invalid_grant', { status: 400 }));

    const err = await getValidAccessToken().catch((e) => e);

    expect(err).toBeInstanceOf(SpotifyAuthError);
    expect(err.reason).toBe('reconnect_required');
    expect(isConnected()).toBe(false);
  });
});
