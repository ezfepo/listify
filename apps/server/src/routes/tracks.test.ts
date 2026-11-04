import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/index.js';
import {
  assignTrackToPlaylist,
  createSubPlaylist,
  listPlaylistIdsForTrack,
  upsertPlaylist,
} from '../db/playlists.js';
import { getTrackStatus, upsertTrack } from '../db/tracks.js';
import { getValidAccessToken } from '../spotify/auth.js';
import { playTrack } from '../spotify/client.js';
import { SpotifyAuthError, SpotifyHttpError } from '../spotify/errors.js';
import { buildTestApp } from './test-app.js';
import { trackRoutes } from './tracks.js';

vi.mock('../spotify/auth.js', () => ({ getValidAccessToken: vi.fn() }));
vi.mock('../spotify/client.js', () => ({ playTrack: vi.fn() }));

const URI = 'spotify:track:1';
const enc = encodeURIComponent;

let app: FastifyInstance;

function addTrack(uri: string, name = 'Song') {
  upsertTrack(
    {
      uri,
      name,
      artists: 'Artist',
      album: null,
      imageUrl: null,
      durationMs: null,
      addedAt: null,
      isLocal: false,
      isrc: null,
    },
    'inbox',
  );
}

function post(url: string, payload?: object) {
  return app.inject({ method: 'POST', url, payload });
}

beforeEach(async () => {
  vi.resetAllMocks();
  db.exec(
    'DELETE FROM playlist_tracks; DELETE FROM playlists; DELETE FROM tracks; DELETE FROM track_tags; DELETE FROM track_features;',
  );
  app = await buildTestApp(trackRoutes);
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/tracks', () => {
  it('lists tracks with total and applies limit/offset', async () => {
    for (const n of [1, 2, 3]) addTrack(`spotify:track:${n}`, `Song ${n}`);

    const res = await app.inject('/api/tracks?limit=2&offset=0');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(2);
  });

  it('filters by status and by search text', async () => {
    addTrack('spotify:track:1', 'Blue Monday');
    addTrack('spotify:track:2', 'Red Alert');
    await post(`/api/tracks/${enc('spotify:track:2')}/status`, { status: 'skipped' });

    const skipped = (await app.inject('/api/tracks?status=skipped')).json();
    expect(skipped.items.map((t: { uri: string }) => t.uri)).toEqual(['spotify:track:2']);

    const search = (await app.inject('/api/tracks?q=blue')).json();
    expect(search.items.map((t: { uri: string }) => t.uri)).toEqual(['spotify:track:1']);
  });

  it('rejects invalid query params', async () => {
    for (const q of ['limit=0', 'limit=5001', 'offset=-1', 'status=weird', 'q=']) {
      const res = await app.inject(`/api/tracks?${q}`);
      expect(res.statusCode, q).toBe(400);
      expect(res.json().error).toBe('invalid_query');
    }
  });
});

describe('GET /api/tracks/:uri', () => {
  it('returns one track by percent-encoded URI', async () => {
    addTrack(URI, 'Only One');
    const res = await app.inject(`/api/tracks/${enc(URI)}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ uri: URI, name: 'Only One' });
  });

  it('404s for an unknown track', async () => {
    const res = await app.inject(`/api/tracks/${enc('spotify:track:nope')}`);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'track_not_found' });
  });
});

describe('GET /api/tracks/:uri/suggestions', () => {
  it('returns suggestions for an existing track', async () => {
    addTrack(URI);
    createSubPlaylist({ name: 'P' });
    const res = await app.inject(`/api/tracks/${enc(URI)}/suggestions`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('404s for an unknown track', async () => {
    expect((await app.inject(`/api/tracks/${enc('x')}/suggestions`)).statusCode).toBe(404);
  });
});

describe('POST /api/tracks/:uri/assign and /unassign', () => {
  it('assigning organizes the track; unassigning the last playlist returns it to inbox', async () => {
    addTrack(URI);
    const playlist = createSubPlaylist({ name: 'P' });

    expect(
      (await post(`/api/tracks/${enc(URI)}/assign`, { playlistId: playlist.id })).statusCode,
    ).toBe(204);
    expect(getTrackStatus(URI)).toBe('organized');
    expect(listPlaylistIdsForTrack(URI)).toEqual([playlist.id]);

    expect(
      (await post(`/api/tracks/${enc(URI)}/unassign`, { playlistId: playlist.id })).statusCode,
    ).toBe(204);
    expect(getTrackStatus(URI)).toBe('inbox');
  });

  it('stays organized while the track is still in another playlist', async () => {
    addTrack(URI);
    const a = createSubPlaylist({ name: 'A' });
    const b = createSubPlaylist({ name: 'B' });
    await post(`/api/tracks/${enc(URI)}/assign`, { playlistId: a.id });
    await post(`/api/tracks/${enc(URI)}/assign`, { playlistId: b.id });

    await post(`/api/tracks/${enc(URI)}/unassign`, { playlistId: a.id });
    expect(getTrackStatus(URI)).toBe('organized');
  });

  it('404s for unknown track or playlist, and 400s for a bad body', async () => {
    addTrack(URI);
    const playlist = createSubPlaylist({ name: 'P' });

    expect(
      (await post(`/api/tracks/${enc('nope')}/assign`, { playlistId: playlist.id })).statusCode,
    ).toBe(404);
    expect((await post(`/api/tracks/${enc(URI)}/assign`, { playlistId: 999 })).statusCode).toBe(
      404,
    );
    expect((await post(`/api/tracks/${enc(URI)}/assign`, { playlistId: 'x' })).statusCode).toBe(
      400,
    );
    expect((await post(`/api/tracks/${enc(URI)}/unassign`, {})).statusCode).toBe(400);
    expect((await post(`/api/tracks/${enc('nope')}/unassign`, { playlistId: 1 })).statusCode).toBe(
      404,
    );
  });
});

describe('POST /api/tracks/:uri/status', () => {
  it('skipping removes the track from its playlists and reports which, for undo', async () => {
    addTrack(URI);
    const a = createSubPlaylist({ name: 'A' });
    const b = createSubPlaylist({ name: 'B' });
    assignTrackToPlaylist(a.id, URI);
    assignTrackToPlaylist(b.id, URI);

    const res = await post(`/api/tracks/${enc(URI)}/status`, { status: 'skipped' });

    expect(res.statusCode).toBe(200);
    expect(res.json().removedFromPlaylistIds.sort()).toEqual([a.id, b.id].sort());
    expect(getTrackStatus(URI)).toBe('skipped');
    expect(listPlaylistIdsForTrack(URI)).toEqual([]);
  });

  it('other statuses just set the status (204)', async () => {
    addTrack(URI);
    const res = await post(`/api/tracks/${enc(URI)}/status`, { status: 'organized' });
    expect(res.statusCode).toBe(204);
    expect(getTrackStatus(URI)).toBe('organized');
  });

  it('rejects an invalid status and an unknown track', async () => {
    addTrack(URI);
    expect((await post(`/api/tracks/${enc(URI)}/status`, { status: 'weird' })).statusCode).toBe(
      400,
    );
    expect((await post(`/api/tracks/${enc('nope')}/status`, { status: 'inbox' })).statusCode).toBe(
      404,
    );
  });
});

describe('POST /api/tracks/bulk/assign and /unassign', () => {
  it('assigns every known track and silently skips unknown URIs', async () => {
    addTrack('spotify:track:1');
    addTrack('spotify:track:2');
    const playlist = createSubPlaylist({ name: 'P' });

    const res = await post('/api/tracks/bulk/assign', {
      uris: ['spotify:track:1', 'spotify:track:ghost', 'spotify:track:2'],
      playlistId: playlist.id,
    });

    expect(res.statusCode).toBe(204);
    expect(getTrackStatus('spotify:track:1')).toBe('organized');
    expect(getTrackStatus('spotify:track:2')).toBe('organized');
    expect(getTrackStatus('spotify:track:ghost')).toBeUndefined();
  });

  it('bulk unassign returns tracks to inbox', async () => {
    addTrack('spotify:track:1');
    const playlist = createSubPlaylist({ name: 'P' });
    await post('/api/tracks/bulk/assign', { uris: ['spotify:track:1'], playlistId: playlist.id });

    const res = await post('/api/tracks/bulk/unassign', {
      uris: ['spotify:track:1'],
      playlistId: playlist.id,
    });

    expect(res.statusCode).toBe(204);
    expect(getTrackStatus('spotify:track:1')).toBe('inbox');
  });

  it('validates the body: at least one uri, a positive playlist id, and the playlist must exist', async () => {
    const playlist = createSubPlaylist({ name: 'P' });
    expect(
      (await post('/api/tracks/bulk/assign', { uris: [], playlistId: playlist.id })).statusCode,
    ).toBe(400);
    expect((await post('/api/tracks/bulk/assign', { uris: ['a'], playlistId: 0 })).statusCode).toBe(
      400,
    );
    expect(
      (await post('/api/tracks/bulk/assign', { uris: ['a'], playlistId: 999 })).statusCode,
    ).toBe(404);
    expect((await post('/api/tracks/bulk/unassign', { uris: [] })).statusCode).toBe(400);
  });

  it('can assign into a playlist adopted from Spotify too', async () => {
    addTrack('spotify:track:1');
    const adopted = upsertPlaylist('sp-1', 'Adopted', 'sub');
    const res = await post('/api/tracks/bulk/assign', {
      uris: ['spotify:track:1'],
      playlistId: adopted.id,
    });
    expect(res.statusCode).toBe(204);
  });
});

describe('POST /api/tracks/:uri/play', () => {
  it('plays on the active device', async () => {
    addTrack(URI);
    vi.mocked(getValidAccessToken).mockResolvedValue('tok');

    const res = await post(`/api/tracks/${enc(URI)}/play`);

    expect(res.statusCode).toBe(204);
    expect(playTrack).toHaveBeenCalledWith('tok', URI);
  });

  it('404s for an unknown track without touching Spotify', async () => {
    const res = await post(`/api/tracks/${enc('nope')}/play`);
    expect(res.statusCode).toBe(404);
    expect(getValidAccessToken).not.toHaveBeenCalled();
  });

  it('401s when not connected', async () => {
    addTrack(URI);
    vi.mocked(getValidAccessToken).mockRejectedValue(new SpotifyAuthError('not_connected', 'x'));

    const res = await post(`/api/tracks/${enc(URI)}/play`);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'not_connected' });
  });

  it('passes the Spotify status through (e.g. 404 when there is no active device)', async () => {
    addTrack(URI);
    vi.mocked(getValidAccessToken).mockResolvedValue('tok');
    vi.mocked(playTrack).mockRejectedValue(new SpotifyHttpError(404, 'no active device'));

    const res = await post(`/api/tracks/${enc(URI)}/play`);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('playback_failed');
  });
});
