import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpotifyPlaylistItemEntry, SpotifySavedTrackEntry } from '../spotify/schemas.js';

function trackEntry(uri: string, id: string): SpotifyPlaylistItemEntry {
  return {
    added_at: '2026-01-01T00:00:00Z',
    is_local: false,
    item: {
      type: 'track',
      uri,
      id,
      name: 'Test Track',
      duration_ms: 200000,
      is_local: false,
      artists: [{ name: 'Test Artist' }],
      album: { name: 'Test Album' },
    },
  };
}

function savedEntry(uri: string, id: string): SpotifySavedTrackEntry {
  return {
    added_at: '2026-01-01T00:00:00Z',
    track: {
      uri,
      id,
      name: 'Test Track',
      duration_ms: 200000,
      is_local: false,
      artists: [{ name: 'Test Artist' }],
      album: { name: 'Test Album' },
    },
  };
}

const mockConfig = { dryRun: true };

vi.mock('../config.js', () => ({ config: mockConfig }));

vi.mock('../spotify/auth.js', () => ({
  getValidAccessToken: vi.fn(async () => 'fake-token'),
}));

vi.mock('../spotify/client.js', () => ({
  getPlaylistItems: vi.fn(async () => []),
  getSavedTracks: vi.fn(async () => []),
  createPlaylist: vi.fn(async () => ({ id: 'new-sub-sp-id' })),
  addItemsToPlaylist: vi.fn(async () => {}),
  removeItemsFromPlaylist: vi.fn(async () => {}),
  removeSavedTracks: vi.fn(async () => {}),
}));

// apply.ts reads LISTIFY_BACKUPS_DIR once at module load, so it must be set before importing it.
const backupsDir = mkdtempSync(join(tmpdir(), 'listify-apply-backups-'));
process.env.LISTIFY_BACKUPS_DIR = backupsDir;

const { db } = await import('../db/index.js');
const { setSetting } = await import('../db/settings.js');
const { createSubPlaylist, assignTrackToPlaylist } = await import('../db/playlists.js');
const { upsertTrack, setTrackStatus } = await import('../db/tracks.js');
const { apply, ApplySetupError } = await import('./apply.js');
const client = await import('../spotify/client.js');
const { LIKED_SONGS_SENTINEL } = await import('../spotify/liked-songs.js');

beforeEach(() => {
  db.exec(
    'DELETE FROM tracks; DELETE FROM playlists; DELETE FROM playlist_tracks; DELETE FROM settings; DELETE FROM operations;',
  );
  mockConfig.dryRun = true;
  vi.mocked(client.getPlaylistItems).mockReset().mockResolvedValue([]);
  vi.mocked(client.getSavedTracks).mockReset().mockResolvedValue([]);
  vi.mocked(client.createPlaylist).mockReset().mockResolvedValue({ id: 'new-sub-sp-id' });
  vi.mocked(client.addItemsToPlaylist).mockReset().mockResolvedValue(undefined);
  vi.mocked(client.removeItemsFromPlaylist).mockReset().mockResolvedValue(undefined);
  vi.mocked(client.removeSavedTracks).mockReset().mockResolvedValue(undefined);
});

afterAll(() => {
  rmSync(backupsDir, { recursive: true, force: true });
});

describe('apply', () => {
  it('requires Main and Archive to be configured first', async () => {
    await expect(apply()).rejects.toBeInstanceOf(ApplySetupError);
  });

  it('writes a backup snapshot before doing anything else', async () => {
    setSetting('main_playlist_spotify_id', 'main123');
    setSetting('archive_playlist_spotify_id', 'archive456');

    const summary = await apply();

    expect(summary.backupPath.startsWith(backupsDir)).toBe(true);
  });

  it('dry run logs every planned operation without calling any Spotify write endpoint', async () => {
    setSetting('main_playlist_spotify_id', 'main123');
    setSetting('archive_playlist_spotify_id', 'archive456');
    upsertTrack(
      {
        uri: 'spotify:track:1',
        name: 'T',
        artists: 'A',
        album: null,
        imageUrl: null,
        durationMs: 1000,
        addedAt: null,
        isLocal: false,
        isrc: null,
      },
      'inbox',
    );
    setTrackStatus('spotify:track:1', 'organized');
    const sad = createSubPlaylist({ name: 'Sad' });
    assignTrackToPlaylist(sad.id, 'spotify:track:1');
    vi.mocked(client.getPlaylistItems).mockImplementation(async (_token, playlistId) => {
      if (playlistId === 'main123') return [trackEntry('spotify:track:1', '1')];
      return [];
    });

    const summary = await apply();

    expect(summary.dryRun).toBe(true);
    expect(summary.operations.every((o) => o.status === 'dry_run')).toBe(true);
    expect(client.createPlaylist).not.toHaveBeenCalled();
    expect(client.addItemsToPlaylist).not.toHaveBeenCalled();
    expect(client.removeItemsFromPlaylist).not.toHaveBeenCalled();
    expect(client.removeSavedTracks).not.toHaveBeenCalled();

    const loggedOps = db
      .prepare('SELECT * FROM operations WHERE batch_id = ?')
      .all(summary.batchId);
    expect(loggedOps.length).toBeGreaterThan(0);
  });

  it('creates the playlist, adds to it and to Archive, then removes the verified track from a real Main playlist', async () => {
    mockConfig.dryRun = false;
    setSetting('main_playlist_spotify_id', 'main123');
    setSetting('archive_playlist_spotify_id', 'archive456');
    upsertTrack(
      {
        uri: 'spotify:track:1',
        name: 'T',
        artists: 'A',
        album: null,
        imageUrl: null,
        durationMs: 1000,
        addedAt: null,
        isLocal: false,
        isrc: null,
      },
      'inbox',
    );
    setTrackStatus('spotify:track:1', 'organized');
    const sad = createSubPlaylist({ name: 'Sad' });
    assignTrackToPlaylist(sad.id, 'spotify:track:1');

    let archiveCalls = 0;
    vi.mocked(client.getPlaylistItems).mockImplementation(async (_token, playlistId) => {
      if (playlistId === 'main123') return [trackEntry('spotify:track:1', '1')];
      if (playlistId === 'archive456') {
        archiveCalls += 1;
        // First read (diff build): not archived yet. Second read (4.e verify, after 4.d ran): archived.
        return archiveCalls === 1 ? [] : [trackEntry('spotify:track:1', '1')];
      }
      return [];
    });

    const summary = await apply();

    expect(client.createPlaylist).toHaveBeenCalledWith('fake-token', 'Sad');
    expect(client.addItemsToPlaylist).toHaveBeenCalledWith('fake-token', 'new-sub-sp-id', [
      'spotify:track:1',
    ]);
    expect(client.addItemsToPlaylist).toHaveBeenCalledWith('fake-token', 'archive456', [
      'spotify:track:1',
    ]);
    expect(client.removeItemsFromPlaylist).toHaveBeenCalledWith('fake-token', 'main123', [
      'spotify:track:1',
    ]);
    expect(client.removeSavedTracks).not.toHaveBeenCalled();

    const playlistRow = db.prepare('SELECT spotify_id FROM playlists WHERE id = ?').get(sad.id) as {
      spotify_id: string;
    };
    expect(playlistRow.spotify_id).toBe('new-sub-sp-id');

    const removeOpStatuses = summary.operations
      .filter((o) => o.operation.kind === 'removeFromMain')
      .map((o) => o.status);
    expect(removeOpStatuses).toContain('done');
  });

  it('does not remove a track from Main when it fails to verify in Archive afterward', async () => {
    mockConfig.dryRun = false;
    setSetting('main_playlist_spotify_id', 'main123');
    setSetting('archive_playlist_spotify_id', 'archive456');
    upsertTrack(
      {
        uri: 'spotify:track:1',
        name: 'T',
        artists: 'A',
        album: null,
        imageUrl: null,
        durationMs: 1000,
        addedAt: null,
        isLocal: false,
        isrc: null,
      },
      'inbox',
    );
    setTrackStatus('spotify:track:1', 'organized');

    vi.mocked(client.getPlaylistItems).mockImplementation(async (_token, playlistId) => {
      if (playlistId === 'main123') return [trackEntry('spotify:track:1', '1')];
      // Archive never actually gets the track (both reads come back empty), e.g. the add call failed.
      return [];
    });

    const summary = await apply();

    expect(client.removeItemsFromPlaylist).not.toHaveBeenCalled();
    expect(client.removeSavedTracks).not.toHaveBeenCalled();
    const failedRemoval = summary.operations.find(
      (o) => o.operation.kind === 'removeFromMain' && o.status === 'failed',
    );
    expect(failedRemoval?.operation).toMatchObject({ uris: ['spotify:track:1'] });
  });

  it('removes via DELETE /me/library (URIs) when Main is Liked Songs, not the playlist-items endpoint', async () => {
    mockConfig.dryRun = false;
    setSetting('main_playlist_spotify_id', LIKED_SONGS_SENTINEL);
    setSetting('archive_playlist_spotify_id', 'archive456');
    upsertTrack(
      {
        uri: 'spotify:track:1',
        name: 'T',
        artists: 'A',
        album: null,
        imageUrl: null,
        durationMs: 1000,
        addedAt: null,
        isLocal: false,
        isrc: null,
      },
      'inbox',
    );
    setTrackStatus('spotify:track:1', 'organized');

    vi.mocked(client.getSavedTracks).mockResolvedValue([savedEntry('spotify:track:1', '1')]);
    vi.mocked(client.getPlaylistItems).mockImplementation(async (_token, playlistId) => {
      if (playlistId === 'archive456') return [trackEntry('spotify:track:1', '1')];
      return [];
    });

    await apply();

    expect(client.removeSavedTracks).toHaveBeenCalledWith('fake-token', ['spotify:track:1']);
    expect(client.removeItemsFromPlaylist).not.toHaveBeenCalled();
  });

  it('excludes local tracks from being organized/removed and reports them as skipped', async () => {
    mockConfig.dryRun = false;
    setSetting('main_playlist_spotify_id', 'main123');
    setSetting('archive_playlist_spotify_id', 'archive456');
    upsertTrack(
      {
        uri: 'spotify:local:a:b:c:1',
        name: 'Local',
        artists: 'A',
        album: null,
        imageUrl: null,
        durationMs: 1000,
        addedAt: null,
        isLocal: true,
        isrc: null,
      },
      'inbox',
    );
    setTrackStatus('spotify:local:a:b:c:1', 'organized');

    const summary = await apply();

    expect(summary.skippedLocalUris).toEqual(['spotify:local:a:b:c:1']);
    expect(client.addItemsToPlaylist).not.toHaveBeenCalled();
    expect(client.removeItemsFromPlaylist).not.toHaveBeenCalled();
  });
});
