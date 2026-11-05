import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/index.js';
import { setSetting } from '../db/settings.js';
import { upsertTrack } from '../db/tracks.js';
import { exportRoutes } from './export.js';
import { buildTestApp } from './test-app.js';

function emptySnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    version: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    tables: {
      tracks: [],
      playlists: [],
      playlist_tracks: [],
      track_features: [],
      track_tags: [],
      playlist_recipes: [],
      enrichment_status: [],
    },
    settings: {},
    ...overrides,
  };
}

let app: FastifyInstance;

beforeEach(async () => {
  db.exec(
    'DELETE FROM tracks; DELETE FROM playlists; DELETE FROM playlist_tracks; DELETE FROM settings;',
  );
  app = await buildTestApp(exportRoutes);
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/export', () => {
  it('returns a versioned snapshot with a download filename header', async () => {
    const res = await app.inject('/api/export');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="listify-backup-/);
    const body = res.json();
    expect(body.version).toBe(1);
    expect(body.tables.tracks).toEqual([]);
  });

  it('reflects current DB content', async () => {
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

    const body = (await app.inject('/api/export')).json();
    expect(body.tables.tracks).toHaveLength(1);
  });

  it('never leaks OAuth tokens into the export', async () => {
    setSetting('spotify_access_token', 'super-secret-token');
    setSetting('main_playlist_spotify_id', 'main123');

    const res = await app.inject('/api/export');

    expect(res.body).not.toContain('super-secret-token');
    expect(res.json().settings).toEqual({ main_playlist_spotify_id: 'main123' });
  });
});

describe('POST /api/import', () => {
  function post(body: object) {
    return app.inject({ method: 'POST', url: '/api/import', payload: body });
  }

  it('replaces the DB with the snapshot and answers 204', async () => {
    const snapshot = emptySnapshot({
      tables: {
        ...emptySnapshot().tables,
        tracks: [
          {
            uri: 'spotify:track:imported',
            name: 'Imported',
            artists: 'A',
            album: null,
            image_url: null,
            duration_ms: null,
            added_at: null,
            first_seen_at: '2026-01-01T00:00:00.000Z',
            status: 'inbox',
            in_main: 0,
            in_archive: 0,
            is_local: 0,
            isrc: null,
          },
        ],
      },
    });

    const res = await post(snapshot);

    expect(res.statusCode).toBe(204);
    const row = db.prepare('SELECT name FROM tracks WHERE uri = ?').get('spotify:track:imported');
    expect(row).toEqual({ name: 'Imported' });
  });

  it('rejects a body missing required fields with 400 invalid_body', async () => {
    const res = await post({ version: 1 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_body');
  });

  it('rejects an unsupported version with 400 invalid_body (schema enforces the literal)', async () => {
    const res = await post(emptySnapshot({ version: 2 }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_body');
  });

  it('answers 400 import_failed when the snapshot violates a DB constraint', async () => {
    // playlist_tracks references a track_uri that doesn't exist — foreign_keys = ON rejects it.
    const snapshot = emptySnapshot({
      tables: {
        ...emptySnapshot().tables,
        playlist_tracks: [
          {
            playlist_id: 1,
            track_uri: 'spotify:track:missing',
            assigned_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    });

    const res = await post(snapshot);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('import_failed');
  });
});
