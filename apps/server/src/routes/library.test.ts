import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/index.js';
import { createSubPlaylist, getPlaylistById, upsertPlaylist } from '../db/playlists.js';
import { upsertTrack } from '../db/tracks.js';
import { libraryRoutes } from './library.js';
import { buildTestApp } from './test-app.js';

let app: FastifyInstance;

beforeEach(async () => {
  db.exec('DELETE FROM playlist_tracks; DELETE FROM playlists; DELETE FROM tracks;');
  app = await buildTestApp(libraryRoutes);
});

afterEach(async () => {
  await app.close();
});

const json = (payload: object) => ({ payload });

describe('GET /api/library', () => {
  it('returns playlists with counts and zeroed status counts when empty', async () => {
    const res = await app.inject('/api/library');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      playlists: [],
      statusCounts: { inbox: 0, organized: 0, skipped: 0 },
    });
  });

  it('reflects tracks and playlists', async () => {
    createSubPlaylist({ name: 'Chill' });
    upsertTrack(
      {
        uri: 'spotify:track:1',
        name: 'S',
        artists: 'A',
        album: null,
        imageUrl: null,
        durationMs: null,
        addedAt: null,
        isLocal: false,
        isrc: null,
      },
      'inbox',
    );

    const body = (await app.inject('/api/library')).json();
    expect(body.playlists).toHaveLength(1);
    expect(body.playlists[0]).toMatchObject({ name: 'Chill', kind: 'sub', trackCount: 0 });
    expect(body.statusCounts.inbox).toBe(1);
  });
});

describe('POST /api/playlists', () => {
  it('creates a sub-playlist (201) and trims the name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      ...json({ name: '  Focus  ', emoji: '🎯' }),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Focus', emoji: '🎯', kind: 'sub', spotifyId: null });
  });

  it('rejects an empty or whitespace-only name', async () => {
    for (const name of ['', '   ']) {
      const res = await app.inject({ method: 'POST', url: '/api/playlists', ...json({ name }) });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_body');
    }
  });
});

describe('PATCH /api/playlists/:id', () => {
  it('updates a sub-playlist and answers 204', async () => {
    const playlist = createSubPlaylist({ name: 'Old' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/playlists/${playlist.id}`,
      ...json({ name: 'New', color: null }),
    });

    expect(res.statusCode).toBe(204);
    expect(getPlaylistById(playlist.id)?.name).toBe('New');
  });

  it('rejects a non-numeric id with 400', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/playlists/abc', ...json({}) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_params' });
  });

  it('404s for an unknown playlist', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/playlists/999', ...json({}) });
    expect(res.statusCode).toBe(404);
  });

  it('refuses to edit Main/Archive playlists', async () => {
    const main = upsertPlaylist('main1', 'Main', 'main');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/playlists/${main.id}`,
      ...json({ name: 'Hacked' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('not_editable');
    expect(getPlaylistById(main.id)?.name).toBe('Main');
  });

  it('rejects an invalid body', async () => {
    const playlist = createSubPlaylist({ name: 'P' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/playlists/${playlist.id}`,
      ...json({ name: '' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_body');
  });
});

describe('DELETE /api/playlists/:id', () => {
  it('deletes a sub-playlist', async () => {
    const playlist = createSubPlaylist({ name: 'Gone' });
    const res = await app.inject({ method: 'DELETE', url: `/api/playlists/${playlist.id}` });
    expect(res.statusCode).toBe(204);
    expect(getPlaylistById(playlist.id)).toBeUndefined();
  });

  it('refuses to delete Main/Archive', async () => {
    const archive = upsertPlaylist('arch1', 'Archive', 'archive');
    const res = await app.inject({ method: 'DELETE', url: `/api/playlists/${archive.id}` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('not_deletable');
    expect(getPlaylistById(archive.id)).toBeDefined();
  });

  it('404s for an unknown playlist and 400s for a bad id', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/playlists/999' })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ method: 'DELETE', url: '/api/playlists/0' })).statusCode).toBe(400);
  });
});

describe('GET /api/playlists/:id/suggestions', () => {
  it('returns an (empty) suggestion list for an existing playlist', async () => {
    const playlist = createSubPlaylist({ name: 'P' });
    const res = await app.inject(`/api/playlists/${playlist.id}/suggestions`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('404s for an unknown playlist', async () => {
    expect((await app.inject('/api/playlists/999/suggestions')).statusCode).toBe(404);
  });

  it('validates the limit (positive, max 200)', async () => {
    const playlist = createSubPlaylist({ name: 'P' });
    expect((await app.inject(`/api/playlists/${playlist.id}/suggestions?limit=0`)).statusCode).toBe(
      400,
    );
    expect(
      (await app.inject(`/api/playlists/${playlist.id}/suggestions?limit=201`)).statusCode,
    ).toBe(400);
    expect(
      (await app.inject(`/api/playlists/${playlist.id}/suggestions?limit=200`)).statusCode,
    ).toBe(200);
  });
});
