import { createHash, randomBytes } from 'node:crypto';
import { config, SPOTIFY_SCOPES } from '../config.js';
import { deleteSetting, getSetting, setSetting } from '../db/settings.js';
import { SpotifyAuthError } from './errors.js';
import { tokenResponseSchema, type SpotifyTokenResponse } from './schemas.js';

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Refresh a bit before actual expiry to avoid racing a request against a token
// that expires mid-flight.
const REFRESH_SKEW_MS = 60_000;
const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;

const SETTINGS_KEYS = {
  accessToken: 'spotify_access_token',
  refreshToken: 'spotify_refresh_token',
  expiresAt: 'spotify_token_expires_at',
  scope: 'spotify_scope',
} as const;

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function generateCodeVerifier(): string {
  return base64url(randomBytes(64));
}

function generateCodeChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

type PendingAuth = { codeVerifier: string; createdAt: number };
const pendingAuth = new Map<string, PendingAuth>();

function cleanupPendingAuth(): void {
  const now = Date.now();
  for (const [state, entry] of pendingAuth) {
    if (now - entry.createdAt > PENDING_AUTH_TTL_MS) {
      pendingAuth.delete(state);
    }
  }
}

/** Starts a PKCE flow: generates verifier/challenge/state and returns the Spotify authorize URL. */
export function beginAuthorization(): string {
  if (!config.spotifyClientId) {
    throw new Error('SPOTIFY_CLIENT_ID is not set (see .env)');
  }

  cleanupPendingAuth();

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString('hex');
  pendingAuth.set(state, { codeVerifier, createdAt: Date.now() });

  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.spotifyClientId,
    scope: SPOTIFY_SCOPES,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    redirect_uri: config.spotifyRedirectUri,
    state,
  }).toString();

  return url.toString();
}

/** Consumes and returns the pending code_verifier for a state, if it exists and hasn't expired. */
export function takePendingAuth(state: string | undefined): string | undefined {
  if (!state) return undefined;
  const entry = pendingAuth.get(state);
  pendingAuth.delete(state);
  if (!entry || Date.now() - entry.createdAt > PENDING_AUTH_TTL_MS) {
    return undefined;
  }
  return entry.codeVerifier;
}

async function requestToken(body: URLSearchParams): Promise<SpotifyTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify token endpoint returned ${res.status}: ${text}`);
  }

  return tokenResponseSchema.parse(await res.json());
}

export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
): Promise<SpotifyTokenResponse> {
  return requestToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.spotifyRedirectUri,
      client_id: config.spotifyClientId,
      code_verifier: codeVerifier,
    }),
  );
}

async function refreshAccessToken(refreshToken: string): Promise<SpotifyTokenResponse> {
  return requestToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.spotifyClientId,
    }),
  );
}

export function storeTokens(tokens: SpotifyTokenResponse): void {
  setSetting(SETTINGS_KEYS.accessToken, tokens.access_token);
  // A refresh response doesn't always include a new refresh token; keep the existing one.
  if (tokens.refresh_token) {
    setSetting(SETTINGS_KEYS.refreshToken, tokens.refresh_token);
  }
  setSetting(SETTINGS_KEYS.expiresAt, String(Date.now() + tokens.expires_in * 1000));
  setSetting(SETTINGS_KEYS.scope, tokens.scope);
}

export function clearTokens(): void {
  deleteSetting(SETTINGS_KEYS.accessToken);
  deleteSetting(SETTINGS_KEYS.refreshToken);
  deleteSetting(SETTINGS_KEYS.expiresAt);
  deleteSetting(SETTINGS_KEYS.scope);
}

export function isConnected(): boolean {
  return Boolean(getSetting(SETTINGS_KEYS.refreshToken));
}

/** Returns a valid access token, refreshing it first if it's expired or about to expire. */
export async function getValidAccessToken(): Promise<string> {
  const refreshToken = getSetting(SETTINGS_KEYS.refreshToken);
  if (!refreshToken) {
    throw new SpotifyAuthError('not_connected', 'no Spotify account connected');
  }

  const accessToken = getSetting(SETTINGS_KEYS.accessToken);
  const expiresAt = Number(getSetting(SETTINGS_KEYS.expiresAt) ?? 0);
  if (accessToken && Date.now() < expiresAt - REFRESH_SKEW_MS) {
    return accessToken;
  }

  try {
    const tokens = await refreshAccessToken(refreshToken);
    storeTokens(tokens);
    return tokens.access_token;
  } catch {
    clearTokens();
    throw new SpotifyAuthError('reconnect_required', 'Spotify token refresh failed');
  }
}
