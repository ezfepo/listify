import { describe, expect, it } from 'vitest';
import {
  meProfileSchema,
  playlistItemsPageSchema,
  playlistsPageSchema,
  savedTracksPageSchema,
  tokenResponseSchema,
} from './schemas.js';

describe('tokenResponseSchema', () => {
  it('accepts a token response without a refresh token (refresh responses omit it)', () => {
    const parsed = tokenResponseSchema.parse({
      access_token: 'a',
      token_type: 'Bearer',
      scope: 'x y',
      expires_in: 3600,
    });
    expect(parsed.refresh_token).toBeUndefined();
  });

  it('rejects a response missing the access token', () => {
    expect(() =>
      tokenResponseSchema.parse({ token_type: 'Bearer', scope: '', expires_in: 1 }),
    ).toThrow();
  });
});

describe('meProfileSchema', () => {
  it('allows a null display name', () => {
    expect(meProfileSchema.parse({ id: 'u', display_name: null })).toEqual({
      id: 'u',
      display_name: null,
    });
  });
});

describe('playlistsPageSchema', () => {
  const owner = { id: 'u', display_name: null };

  it('accepts either items.total (post Feb-2026) or the deprecated tracks.total', () => {
    const page = playlistsPageSchema.parse({
      next: null,
      total: 2,
      items: [
        { id: '1', name: 'New', owner, items: { total: 5 } },
        { id: '2', name: 'Old', owner, tracks: { total: 7 } },
      ],
    });
    expect(page.items[0]?.items?.total).toBe(5);
    expect(page.items[1]?.tracks?.total).toBe(7);
  });

  it('only requires next/total/items (href/limit/offset are omitted when fields= is used)', () => {
    expect(() => playlistsPageSchema.parse({ next: null, total: 0, items: [] })).not.toThrow();
  });

  it('keeps unknown fields on a playlist (passthrough)', () => {
    const page = playlistsPageSchema.parse({
      next: null,
      total: 1,
      items: [{ id: '1', name: 'P', owner, collaborative: true }],
    });
    expect((page.items[0] as Record<string, unknown>).collaborative).toBe(true);
  });
});

describe('playlistItemsPageSchema', () => {
  const trackItem = {
    type: 'track',
    uri: 'spotify:track:1',
    id: '1',
    name: 'Song',
  };

  it('reads the track from `item` (renamed from `track` post Feb-2026)', () => {
    const page = playlistItemsPageSchema.parse({
      next: null,
      total: 1,
      items: [{ added_at: '2024-01-01T00:00:00Z', is_local: false, item: trackItem }],
    });
    expect(page.items[0]?.item?.uri).toBe('spotify:track:1');
  });

  it('defaults a missing nested is_local to false', () => {
    const page = playlistItemsPageSchema.parse({
      next: null,
      total: 1,
      items: [{ added_at: null, is_local: false, item: trackItem }],
    });
    expect(page.items[0]?.item?.is_local).toBe(false);
  });

  it('accepts episodes and null (removed/unavailable) items', () => {
    const page = playlistItemsPageSchema.parse({
      next: null,
      total: 2,
      items: [
        { added_at: null, is_local: false, item: { ...trackItem, type: 'episode' } },
        { added_at: null, is_local: false, item: null },
      ],
    });
    expect(page.items[0]?.item?.type).toBe('episode');
    expect(page.items[1]?.item).toBeNull();
  });

  it('rejects an unknown item type', () => {
    expect(() =>
      playlistItemsPageSchema.parse({
        next: null,
        total: 1,
        items: [{ added_at: null, is_local: false, item: { ...trackItem, type: 'ad' } }],
      }),
    ).toThrow();
  });

  it('rejects the pre-Feb-2026 shape that uses `track` instead of `item`', () => {
    expect(() =>
      playlistItemsPageSchema.parse({
        next: null,
        total: 1,
        items: [{ added_at: null, is_local: false, track: trackItem }],
      }),
    ).toThrow();
  });

  it('reads ISRC from external_ids', () => {
    const page = playlistItemsPageSchema.parse({
      next: null,
      total: 1,
      items: [
        {
          added_at: null,
          is_local: false,
          item: { ...trackItem, external_ids: { isrc: 'USABC1234567' } },
        },
      ],
    });
    expect(page.items[0]?.item?.external_ids?.isrc).toBe('USABC1234567');
  });
});

describe('savedTracksPageSchema (Liked Songs)', () => {
  it('reads the track from `track`, with no `type` discriminant', () => {
    const page = savedTracksPageSchema.parse({
      next: 'https://api.spotify.com/v1/me/tracks?offset=50',
      total: 120,
      items: [
        {
          added_at: '2024-01-01T00:00:00Z',
          track: { uri: 'spotify:track:1', id: '1', name: 'Song' },
        },
      ],
    });
    expect(page.total).toBe(120);
    expect(page.items[0]?.track?.uri).toBe('spotify:track:1');
  });

  it('allows a null track', () => {
    expect(() =>
      savedTracksPageSchema.parse({
        next: null,
        total: 1,
        items: [{ added_at: '2024-01-01T00:00:00Z', track: null }],
      }),
    ).not.toThrow();
  });
});
