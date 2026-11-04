import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfig() {
  vi.resetModules();
  return import('./config.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('SPOTIFY_SCOPES', () => {
  it('is a space-separated list with every scope the app needs and no duplicates', async () => {
    const { SPOTIFY_SCOPES } = await loadConfig();
    const scopes = SPOTIFY_SCOPES.split(' ');

    expect(scopes).toEqual(
      expect.arrayContaining([
        'playlist-read-private',
        'playlist-read-collaborative',
        'playlist-modify-private',
        'playlist-modify-public',
        'user-read-playback-state',
        'user-modify-playback-state',
        // Liked Songs as Main
        'user-library-read',
        'user-library-modify',
      ]),
    );
    expect(new Set(scopes).size).toBe(scopes.length);
  });
});

describe('config', () => {
  it('reads values from the environment', async () => {
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'client-123');
    vi.stubEnv('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:9999/cb');
    vi.stubEnv('LISTIFY_WEB_ORIGIN', 'http://127.0.0.1:4000');
    vi.stubEnv('LASTFM_API_KEY', 'lfm-key');

    const { config } = await loadConfig();
    expect(config).toEqual({
      spotifyClientId: 'client-123',
      spotifyRedirectUri: 'http://127.0.0.1:9999/cb',
      webOrigin: 'http://127.0.0.1:4000',
      lastfmApiKey: 'lfm-key',
    });
  });

  it('uses loopback (127.0.0.1) defaults for the redirect URI and web origin', async () => {
    const { config } = await loadConfig();
    // Spotify rejects non-loopback http redirect URIs, so the defaults must stay on 127.0.0.1.
    expect(config.spotifyRedirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
    expect(config.webOrigin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
