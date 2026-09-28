import { afterEach, describe, expect, it, vi } from 'vitest';
import { reccobeatsProvider } from './reccobeats.js';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reccobeatsProvider', () => {
  it('is always configured (no API key required)', () => {
    expect(reccobeatsProvider.isConfigured()).toBe(true);
  });

  it('returns null for a local track (no resolvable Spotify ID)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await reccobeatsProvider.enrich({
      uri: 'spotify:local:artist:album:song:1',
      name: 'Local Song',
      artists: 'Local Artist',
      isrc: null,
    });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves Spotify ID -> ReccoBeats ID -> audio features', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          content: [{ id: 'recco-uuid-1', href: 'https://open.spotify.com/track/abc123' }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          content: [
            { id: 'recco-uuid-1', valence: 0.5, energy: 0.6, danceability: 0.7, tempo: 120 },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await reccobeatsProvider.enrich({
      uri: 'spotify:track:abc123',
      name: 'Song',
      artists: 'Artist',
      isrc: null,
    });

    expect(result).toEqual({
      features: {
        valence: 0.5,
        energy: 0.6,
        danceability: 0.7,
        tempo: 120,
        acousticness: undefined,
        instrumentalness: undefined,
        speechiness: undefined,
        loudness: undefined,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/v1/track?ids=abc123');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/v1/audio-features?ids=recco-uuid-1');
  });

  it('returns null when ReccoBeats has no match for the track', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { content: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await reccobeatsProvider.enrich({
      uri: 'spotify:track:unknown',
      name: 'Unknown Song',
      artists: 'Nobody',
      isrc: null,
    });

    expect(result).toBeNull();
  });

  it('retries on 429 honoring Retry-After, then succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'retry-after': '1' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          content: [{ id: 'recco-uuid-1', href: 'https://open.spotify.com/track/abc123' }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { content: [{ id: 'recco-uuid-1', valence: 0.5 }] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = reccobeatsProvider.enrich({
      uri: 'spotify:track:abc123',
      name: 'Song',
      artists: 'Artist',
      isrc: null,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result?.features?.valence).toBe(0.5);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('throws when the API returns a non-2xx, non-429, non-404 status', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      reccobeatsProvider.enrich({
        uri: 'spotify:track:abc123',
        name: 'Song',
        artists: 'Artist',
        isrc: null,
      }),
    ).rejects.toThrow(/returned 500/);
  });
});
