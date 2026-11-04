import { beforeEach, describe, expect, it } from 'vitest';
import type { NormalizedTrack } from '../sync/types.js';
import { db } from './index.js';
import {
  countTracksInArchive,
  countTracksInMain,
  getTrack,
  getTrackStatus,
  markInArchive,
  markInMain,
  resetMembershipFlags,
  setTrackStatus,
  upsertTrack,
} from './tracks.js';

function track(uri: string, overrides: Partial<NormalizedTrack> = {}): NormalizedTrack {
  return {
    uri,
    name: 'Song',
    artists: 'Artist',
    album: 'Album',
    imageUrl: 'http://img/1',
    durationMs: 1000,
    addedAt: '2024-01-01T00:00:00Z',
    isLocal: false,
    isrc: 'USABC1234567',
    ...overrides,
  };
}

function firstSeenAt(uri: string): string {
  const row = db.prepare('SELECT first_seen_at FROM tracks WHERE uri = ?').get(uri) as {
    first_seen_at: string;
  };
  return row.first_seen_at;
}

beforeEach(() => {
  db.exec('DELETE FROM playlist_tracks; DELETE FROM playlists; DELETE FROM tracks;');
});

describe('upsertTrack', () => {
  it('inserts a new track with the given default status and no membership flags', () => {
    upsertTrack(track('spotify:track:1'), 'inbox');

    expect(getTrack('spotify:track:1')).toMatchObject({
      uri: 'spotify:track:1',
      name: 'Song',
      artists: 'Artist',
      album: 'Album',
      image_url: 'http://img/1',
      duration_ms: 1000,
      status: 'inbox',
      in_main: 0,
      in_archive: 0,
      is_local: 0,
      isrc: 'USABC1234567',
    });
  });

  it('stores the "organized" default status for tracks first seen in the archive', () => {
    upsertTrack(track('spotify:track:1'), 'organized');
    expect(getTrackStatus('spotify:track:1')).toBe('organized');
  });

  it('updates metadata on an existing track but never touches its status or membership', () => {
    upsertTrack(track('spotify:track:1'), 'inbox');
    setTrackStatus('spotify:track:1', 'skipped');
    markInMain('spotify:track:1');

    upsertTrack(track('spotify:track:1', { name: 'Renamed', isLocal: true, isrc: null }), 'inbox');

    expect(getTrack('spotify:track:1')).toMatchObject({
      name: 'Renamed',
      is_local: 1,
      isrc: null,
      status: 'skipped',
      in_main: 1,
    });
  });

  it('keeps first_seen_at stable across re-pulls', () => {
    upsertTrack(track('spotify:track:1'), 'inbox');
    const first = firstSeenAt('spotify:track:1');
    upsertTrack(track('spotify:track:1', { name: 'x' }), 'inbox');
    expect(firstSeenAt('spotify:track:1')).toBe(first);
  });
});

describe('membership flags', () => {
  it('counts Main and Archive separately', () => {
    for (const n of [1, 2, 3]) upsertTrack(track(`spotify:track:${n}`), 'inbox');
    markInMain('spotify:track:1');
    markInMain('spotify:track:2');
    markInArchive('spotify:track:2');
    markInArchive('spotify:track:3');

    expect(countTracksInMain()).toBe(2);
    expect(countTracksInArchive()).toBe(2);
  });

  it('resetMembershipFlags clears both flags on every track so a pull can re-mark them', () => {
    upsertTrack(track('spotify:track:1'), 'inbox');
    markInMain('spotify:track:1');
    markInArchive('spotify:track:1');

    resetMembershipFlags();

    expect(countTracksInMain()).toBe(0);
    expect(countTracksInArchive()).toBe(0);
    expect(getTrack('spotify:track:1')).toBeDefined();
  });
});

describe('getTrack / getTrackStatus / setTrackStatus', () => {
  it('returns undefined for an unknown track', () => {
    expect(getTrack('nope')).toBeUndefined();
    expect(getTrackStatus('nope')).toBeUndefined();
  });

  it('changes status', () => {
    upsertTrack(track('spotify:track:1'), 'inbox');
    setTrackStatus('spotify:track:1', 'organized');
    expect(getTrackStatus('spotify:track:1')).toBe('organized');
  });

  it('rejects a status outside the allowed set (CHECK constraint)', () => {
    upsertTrack(track('spotify:track:1'), 'inbox');
    expect(() => setTrackStatus('spotify:track:1', 'bogus' as unknown as 'inbox')).toThrow();
  });
});
