import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './index.js';
import './schema.js';
import { createSubPlaylist } from './playlists.js';
import { setSetting } from './settings.js';
import { upsertTrack } from './tracks.js';
import { exportDatabaseSnapshot, importDatabaseSnapshot, writeBackupSnapshot } from './export.js';

function track(uri: string) {
  return {
    uri,
    name: 'Test Track',
    artists: 'Test Artist',
    album: null,
    imageUrl: null,
    durationMs: 1000,
    addedAt: null,
    isLocal: false,
    isrc: null,
  };
}

beforeEach(() => {
  db.exec(
    'DELETE FROM tracks; DELETE FROM playlists; DELETE FROM playlist_tracks; DELETE FROM settings;',
  );
});

describe('exportDatabaseSnapshot / importDatabaseSnapshot', () => {
  it('round-trips tracks, playlists and their assignment', () => {
    upsertTrack(track('spotify:track:1'), 'inbox');
    const playlist = createSubPlaylist({ name: 'Sad' });
    db.prepare(
      'INSERT INTO playlist_tracks (playlist_id, track_uri, assigned_at) VALUES (?, ?, ?)',
    ).run(playlist.id, 'spotify:track:1', new Date().toISOString());
    setSetting('main_playlist_spotify_id', 'main123');
    setSetting('archive_playlist_spotify_id', 'archive123');
    setSetting('spotify_access_token', 'super-secret-token');

    const snapshot = exportDatabaseSnapshot();

    expect(snapshot.tables.tracks).toHaveLength(1);
    expect(snapshot.tables.playlists).toHaveLength(1);
    expect(snapshot.tables.playlist_tracks).toHaveLength(1);
    expect(snapshot.settings).toEqual({
      main_playlist_spotify_id: 'main123',
      archive_playlist_spotify_id: 'archive123',
    });
    // Never leak OAuth tokens into an exported snapshot.
    expect(Object.keys(snapshot.settings)).not.toContain('spotify_access_token');
    expect(JSON.stringify(snapshot)).not.toContain('super-secret-token');

    db.exec('DELETE FROM tracks; DELETE FROM playlists; DELETE FROM playlist_tracks;');
    importDatabaseSnapshot(snapshot);

    const restoredTrack = db.prepare('SELECT * FROM tracks WHERE uri = ?').get('spotify:track:1');
    expect(restoredTrack).toBeTruthy();
    const restoredPlaylist = db.prepare('SELECT * FROM playlists').get() as { name: string };
    expect(restoredPlaylist.name).toBe('Sad');
    const restoredAssignment = db.prepare('SELECT * FROM playlist_tracks').get();
    expect(restoredAssignment).toBeTruthy();
  });

  it('rejects a snapshot with an unsupported version', () => {
    expect(() =>
      importDatabaseSnapshot({
        version: 2 as unknown as 1,
        exportedAt: new Date().toISOString(),
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
      }),
    ).toThrow(/unsupported/i);
  });
});

describe('writeBackupSnapshot', () => {
  it('writes a timestamped JSON file into the given directory', () => {
    upsertTrack(track('spotify:track:1'), 'inbox');
    const dir = mkdtempSync(join(tmpdir(), 'listify-backup-'));
    try {
      const path = writeBackupSnapshot(dir);
      expect(path.startsWith(dir)).toBe(true);
      expect(path.endsWith('.json')).toBe(true);
      const contents = JSON.parse(readFileSync(path, 'utf-8'));
      expect(contents.tables.tracks).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
