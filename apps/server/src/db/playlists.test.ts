import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './index.js';
import {
  assignTrackToPlaylist,
  countPlaylistsForTrack,
  createSubPlaylist,
  deleteSubPlaylist,
  getPlaylistById,
  listPlaylistIdsForTrack,
  listPlaylistsWithCounts,
  unassignTrackFromPlaylist,
  updateSubPlaylist,
  upsertPlaylist,
} from './playlists.js';
import { markInArchive, markInMain, upsertTrack } from './tracks.js';

function track(uri: string) {
  return {
    uri,
    name: 'Song',
    artists: 'Artist',
    album: null,
    imageUrl: null,
    durationMs: null,
    addedAt: null,
    isLocal: false,
    isrc: null,
  };
}

beforeEach(() => {
  db.exec('DELETE FROM playlist_tracks; DELETE FROM playlists; DELETE FROM tracks;');
});

describe('createSubPlaylist / updateSubPlaylist / deleteSubPlaylist', () => {
  it('creates a local-only sub-playlist with no Spotify ID', () => {
    const playlist = createSubPlaylist({ name: 'Sad', emoji: '😢', color: '#336699' });
    expect(playlist.spotifyId).toBeNull();
    expect(playlist.kind).toBe('sub');
    expect(playlist.trackCount).toBe(0);

    const row = getPlaylistById(playlist.id);
    expect(row?.name).toBe('Sad');
  });

  it('updates only the provided fields, leaving the rest untouched', () => {
    const playlist = createSubPlaylist({ name: 'Sad', emoji: '😢', color: '#336699' });
    updateSubPlaylist(playlist.id, { color: '#ff0000' });

    const updated = listPlaylistsWithCounts().find((p) => p.id === playlist.id);
    expect(updated?.name).toBe('Sad');
    expect(updated?.emoji).toBe('😢');
    expect(updated?.color).toBe('#ff0000');
  });

  it('refuses to update a main/archive playlist', () => {
    const main = upsertPlaylist('main123', 'Main', 'main');
    updateSubPlaylist(main.id, { name: 'Renamed' });
    expect(getPlaylistById(main.id)?.name).toBe('Main');
  });

  it('deletes a sub-playlist but not a main/archive playlist', () => {
    const sub = createSubPlaylist({ name: 'Sad' });
    const main = upsertPlaylist('main123', 'Main', 'main');

    deleteSubPlaylist(sub.id);
    deleteSubPlaylist(main.id);

    expect(getPlaylistById(sub.id)).toBeUndefined();
    expect(getPlaylistById(main.id)).toBeDefined();
  });

  it('cascades track assignments when a sub-playlist is deleted', () => {
    const sub = createSubPlaylist({ name: 'Sad' });
    upsertTrack(track('spotify:track:1'), 'inbox');
    assignTrackToPlaylist(sub.id, 'spotify:track:1');

    deleteSubPlaylist(sub.id);

    const rows = db.prepare('SELECT * FROM playlist_tracks WHERE playlist_id = ?').all(sub.id);
    expect(rows).toEqual([]);
  });
});

describe('listPlaylistsWithCounts', () => {
  it("reports each playlist's current track count", () => {
    const sub = createSubPlaylist({ name: 'Sad' });
    upsertTrack(track('spotify:track:1'), 'inbox');
    upsertTrack(track('spotify:track:2'), 'inbox');
    assignTrackToPlaylist(sub.id, 'spotify:track:1');
    assignTrackToPlaylist(sub.id, 'spotify:track:2');

    const playlists = listPlaylistsWithCounts();
    expect(playlists.find((p) => p.id === sub.id)?.trackCount).toBe(2);
  });

  it('counts main/archive by in_main/in_archive, since they never get playlist_tracks rows', () => {
    const main = upsertPlaylist('main123', 'Main', 'main');
    const archive = upsertPlaylist('archive456', 'Main – Archive', 'archive');
    upsertTrack(track('spotify:track:1'), 'inbox');
    upsertTrack(track('spotify:track:2'), 'inbox');
    markInMain('spotify:track:1');
    markInMain('spotify:track:2');
    markInArchive('spotify:track:1');

    const playlists = listPlaylistsWithCounts();
    expect(playlists.find((p) => p.id === main.id)?.trackCount).toBe(2);
    expect(playlists.find((p) => p.id === archive.id)?.trackCount).toBe(1);
  });
});

describe('assignTrackToPlaylist / unassignTrackFromPlaylist', () => {
  it('is idempotent — assigning twice does not duplicate the row', () => {
    const sub = createSubPlaylist({ name: 'Sad' });
    upsertTrack(track('spotify:track:1'), 'inbox');

    assignTrackToPlaylist(sub.id, 'spotify:track:1');
    assignTrackToPlaylist(sub.id, 'spotify:track:1');

    expect(countPlaylistsForTrack('spotify:track:1')).toBe(1);
  });

  it('tracks which playlists a track belongs to', () => {
    const sad = createSubPlaylist({ name: 'Sad' });
    const road = createSubPlaylist({ name: 'Road' });
    upsertTrack(track('spotify:track:1'), 'inbox');

    assignTrackToPlaylist(sad.id, 'spotify:track:1');
    assignTrackToPlaylist(road.id, 'spotify:track:1');
    expect(listPlaylistIdsForTrack('spotify:track:1').sort()).toEqual([sad.id, road.id].sort());

    unassignTrackFromPlaylist(sad.id, 'spotify:track:1');
    expect(listPlaylistIdsForTrack('spotify:track:1')).toEqual([road.id]);
  });
});
