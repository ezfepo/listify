import { describe, expect, it } from 'vitest';
import type { SpotifyPlaylistItemEntry } from '../spotify/schemas.js';
import { normalizeTrackEntry } from './normalize.js';

function trackEntry(overrides: Partial<SpotifyPlaylistItemEntry> = {}): SpotifyPlaylistItemEntry {
  return {
    added_at: '2026-01-01T00:00:00Z',
    is_local: false,
    item: {
      type: 'track',
      uri: 'spotify:track:1',
      id: '1',
      name: 'Song One',
      duration_ms: 200000,
      is_local: false,
      artists: [{ name: 'Artist A' }, { name: 'Artist B' }],
      album: { name: 'Album A', images: [{ url: 'https://img/large.jpg' }] },
    },
    ...overrides,
  };
}

describe('normalizeTrackEntry', () => {
  it('normalizes a regular track', () => {
    const track = normalizeTrackEntry(trackEntry());
    expect(track).toEqual({
      uri: 'spotify:track:1',
      name: 'Song One',
      artists: 'Artist A, Artist B',
      album: 'Album A',
      imageUrl: 'https://img/large.jpg',
      durationMs: 200000,
      addedAt: '2026-01-01T00:00:00Z',
      isLocal: false,
    });
  });

  it('skips a removed track (item is null)', () => {
    expect(normalizeTrackEntry(trackEntry({ item: null }))).toBeNull();
  });

  it('skips episodes entirely', () => {
    const entry = trackEntry({
      item: {
        type: 'episode',
        uri: 'spotify:episode:1',
        id: 'e1',
        name: 'Some Podcast',
        is_local: false,
      },
    });
    expect(normalizeTrackEntry(entry)).toBeNull();
  });

  it('keeps local tracks but flags them', () => {
    const entry = trackEntry({
      is_local: true,
      item: {
        type: 'track',
        uri: 'spotify:local:artist:album:song:123',
        id: null,
        name: 'Local Song',
        is_local: true,
        artists: [{ name: 'Local Artist' }],
      },
    });
    const track = normalizeTrackEntry(entry);
    expect(track?.isLocal).toBe(true);
    expect(track?.uri).toBe('spotify:local:artist:album:song:123');
  });

  it('falls back to null album/image when the album has no art', () => {
    const entry = trackEntry({
      item: {
        type: 'track',
        uri: 'spotify:track:2',
        id: '2',
        name: 'Song Two',
        is_local: false,
        artists: [],
      },
    });
    const track = normalizeTrackEntry(entry);
    expect(track?.album).toBeNull();
    expect(track?.imageUrl).toBeNull();
    expect(track?.artists).toBe('');
  });
});
