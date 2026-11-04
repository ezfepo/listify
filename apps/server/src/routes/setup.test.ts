import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/index.js';
import { getPlaylistBySpotifyId } from '../db/playlists.js';
import { getSetting } from '../db/settings.js';
import { getValidAccessToken } from '../spotify/auth.js';
import { getMe, getMyPlaylists, getSavedTracksTotal } from '../spotify/client.js';
import { SpotifyAuthError } from '../spotify/errors.js';
import { LIKED_SONGS_SENTINEL } from '../spotify/liked-songs.js';
import { setupRoutes } from './setup.js';
import { buildTestApp } from './test-app.js';

vi.mock('../spotify/auth.js', () => ({ getValidAccessToken: vi.fn() }));
vi.mock('../spotify/client.js', () => ({
  getMe: vi.fn(),
  getMyPlaylists: vi.fn(),
  getSavedTracksTotal: vi.fn(),
}));

let app: FastifyInstance;

beforeEach(async () => {
  vi.resetAllMocks();
  db.exec('DELETE FROM settings; DELETE FROM playlist_tracks; DELETE FROM playlists;');
  app = await buildTestApp(setupRoutes);
});

afterEach(async () => {
  await app.close();
});

function postSetup(body: unknown) {
  return app.inject({ method: 'POST', url: '/api/setup', payload: body as object });
}

describe('GET /api/playlists', () => {
  it('lists Liked Songs first, then the user playlists with normalised track counts', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValue('tok');
    vi.mocked(getMe).mockResolvedValue({ id: 'me', display_name: 'Me' });
    vi.mocked(getSavedTracksTotal).mockResolvedValue(250);
    vi.mocked(getMyPlaylists).mockResolvedValue([
      { id: 'p1', name: 'New API', owner: { id: 'o', display_name: 'Owner' }, items: { total: 5 } },
      { id: 'p2', name: 'Old API', owner: { id: 'o', display_name: null }, tracks: { total: 7 } },
      { id: 'p3', name: 'No count', owner: { id: 'o', display_name: null } },
    ]);

    const res = await app.inject('/api/playlists');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        id: LIKED_SONGS_SENTINEL,
        name: 'Liked Songs',
        ownerId: 'me',
        ownerDisplayName: 'Me',
        trackCount: 250,
      },
      { id: 'p1', name: 'New API', ownerId: 'o', ownerDisplayName: 'Owner', trackCount: 5 },
      { id: 'p2', name: 'Old API', ownerId: 'o', ownerDisplayName: null, trackCount: 7 },
      { id: 'p3', name: 'No count', ownerId: 'o', ownerDisplayName: null, trackCount: 0 },
    ]);
  });

  it('401s when not connected', async () => {
    vi.mocked(getValidAccessToken).mockRejectedValue(new SpotifyAuthError('not_connected', 'x'));

    const res = await app.inject('/api/playlists');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'not_connected' });
  });
});

describe('GET /api/setup', () => {
  it('returns nulls before anything is configured', async () => {
    const res = await app.inject('/api/setup');
    expect(res.json()).toEqual({ mainSpotifyId: null, archiveSpotifyId: null });
  });
});

describe('POST /api/setup', () => {
  it('saves Main and Archive and round-trips through GET', async () => {
    const res = await postSetup({ mainSpotifyId: 'main1', archiveSpotifyId: 'arch1' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    expect((await app.inject('/api/setup')).json()).toEqual({
      mainSpotifyId: 'main1',
      archiveSpotifyId: 'arch1',
    });
  });

  it('allows Liked Songs as Main', async () => {
    const res = await postSetup({
      mainSpotifyId: LIKED_SONGS_SENTINEL,
      archiveSpotifyId: 'arch1',
    });
    expect(res.statusCode).toBe(200);
    expect(getSetting('main_playlist_spotify_id')).toBe(LIKED_SONGS_SENTINEL);
  });

  it('refuses Liked Songs as Archive and saves nothing', async () => {
    const res = await postSetup({
      mainSpotifyId: 'main1',
      archiveSpotifyId: LIKED_SONGS_SENTINEL,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_archive');
    expect(getSetting('main_playlist_spotify_id')).toBeUndefined();
    expect(getSetting('archive_playlist_spotify_id')).toBeUndefined();
  });

  it('adopts existing Spotify playlists as local sub-playlists', async () => {
    await postSetup({
      mainSpotifyId: 'main1',
      archiveSpotifyId: 'arch1',
      adopt: [
        { spotifyId: 'sp-a', name: 'Chill' },
        { spotifyId: 'sp-b', name: 'Workout' },
      ],
    });

    expect(getPlaylistBySpotifyId('sp-a')).toMatchObject({ name: 'Chill', kind: 'sub' });
    expect(getPlaylistBySpotifyId('sp-b')).toMatchObject({ name: 'Workout', kind: 'sub' });
  });

  it('rejects a body missing required fields', async () => {
    const res = await postSetup({ mainSpotifyId: 'main1' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_body');
  });
});
