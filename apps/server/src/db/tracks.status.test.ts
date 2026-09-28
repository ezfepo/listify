import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './index.js';
import {
  assignTrackToPlaylist,
  createSubPlaylist,
  listPlaylistIdsForTrack,
  unassignTrackFromPlaylist,
} from './playlists.js';
import {
  getStatusCounts,
  getTrackStatus,
  listUnassignedCandidateTracks,
  recomputeStatusFromAssignments,
  setTrackStatus,
  skipTrack,
  upsertTrack,
} from './tracks.js';

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

describe('recomputeStatusFromAssignments', () => {
  it('flips inbox -> organized once assigned, and back to inbox once fully unassigned', () => {
    upsertTrack(track('spotify:track:1'), 'inbox');
    const sub = createSubPlaylist({ name: 'Sad' });

    assignTrackToPlaylist(sub.id, 'spotify:track:1');
    recomputeStatusFromAssignments('spotify:track:1', true);
    expect(getTrackStatus('spotify:track:1')).toBe('organized');

    unassignTrackFromPlaylist(sub.id, 'spotify:track:1');
    recomputeStatusFromAssignments('spotify:track:1', false);
    expect(getTrackStatus('spotify:track:1')).toBe('inbox');
  });

  it('assigning a skipped track organizes it — assignment is a deliberate action that overrides skip', () => {
    upsertTrack(track('spotify:track:1'), 'inbox');
    setTrackStatus('spotify:track:1', 'skipped');

    recomputeStatusFromAssignments('spotify:track:1', true);
    expect(getTrackStatus('spotify:track:1')).toBe('organized');
  });

  it('unassigning down to zero playlists preserves an explicit skip instead of resurrecting it to inbox', () => {
    upsertTrack(track('spotify:track:1'), 'inbox');
    setTrackStatus('spotify:track:1', 'skipped');

    recomputeStatusFromAssignments('spotify:track:1', false);
    expect(getTrackStatus('spotify:track:1')).toBe('skipped');
  });
});

describe('skipTrack', () => {
  it('removes the track from every playlist it was in, marks it skipped, and returns the removed playlist ids', () => {
    upsertTrack(track('spotify:track:1'), 'inbox');
    const sad = createSubPlaylist({ name: 'Sad' });
    const road = createSubPlaylist({ name: 'Road' });
    assignTrackToPlaylist(sad.id, 'spotify:track:1');
    assignTrackToPlaylist(road.id, 'spotify:track:1');

    const removed = skipTrack('spotify:track:1');

    expect(removed.sort()).toEqual([sad.id, road.id].sort());
    expect(listPlaylistIdsForTrack('spotify:track:1')).toEqual([]);
    expect(getTrackStatus('spotify:track:1')).toBe('skipped');
  });

  it('returns an empty array for a track that had no playlists', () => {
    upsertTrack(track('spotify:track:1'), 'inbox');
    expect(skipTrack('spotify:track:1')).toEqual([]);
    expect(getTrackStatus('spotify:track:1')).toBe('skipped');
  });
});

describe('getStatusCounts', () => {
  it('counts tracks per status, defaulting missing statuses to 0', () => {
    upsertTrack(track('spotify:track:1'), 'inbox');
    upsertTrack(track('spotify:track:2'), 'inbox');
    setTrackStatus('spotify:track:2', 'organized');

    expect(getStatusCounts()).toEqual({ inbox: 1, organized: 1, skipped: 0 });
  });
});

describe('listUnassignedCandidateTracks', () => {
  it('excludes tracks already in a sub-playlist and skipped tracks', () => {
    upsertTrack(track('spotify:track:1'), 'inbox');
    upsertTrack(track('spotify:track:2'), 'inbox');
    upsertTrack(track('spotify:track:3'), 'inbox');
    const sub = createSubPlaylist({ name: 'Sad' });
    assignTrackToPlaylist(sub.id, 'spotify:track:1');
    setTrackStatus('spotify:track:2', 'skipped');

    const candidates = listUnassignedCandidateTracks();
    expect(candidates.map((t) => t.uri)).toEqual(['spotify:track:3']);
  });
});
