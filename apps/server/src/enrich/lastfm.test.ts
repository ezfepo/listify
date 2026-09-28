import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

let lastfmProvider: (typeof import('./lastfm.js'))['lastfmProvider'];

beforeAll(async () => {
  process.env.LASTFM_API_KEY = 'test-key';
  ({ lastfmProvider } = await import('./lastfm.js'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lastfmProvider', () => {
  it('is configured only when LASTFM_API_KEY is set', () => {
    expect(lastfmProvider.isConfigured()).toBe(true);
  });

  it("returns the track's top tags as weighted TrackTags", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, {
        toptags: {
          tag: [
            { name: 'sad', count: 90 },
            { name: 'pop', count: 40 },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await lastfmProvider.enrich({
      uri: 'spotify:track:1',
      name: 'Believe',
      artists: 'Cher',
      isrc: null,
    });

    expect(result).toEqual({
      tags: [
        { tag: 'sad', weight: 90 },
        { tag: 'pop', weight: 40 },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0]?.[0] as URL;
    expect(url.toString()).toContain('method=track.gettoptags');
    expect(url.toString()).toContain('artist=Cher');
  });

  it("handles Last.fm's single-tag response shape (object, not array)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { toptags: { tag: { name: 'sad', count: 90 } } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await lastfmProvider.enrich({
      uri: 'spotify:track:1',
      name: 'Believe',
      artists: 'Cher',
      isrc: null,
    });

    expect(result).toEqual({ tags: [{ tag: 'sad', weight: 90 }] });
  });

  it('falls back to artist.getTopTags when the track has no tags', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { toptags: { tag: '' } }))
      .mockResolvedValueOnce(jsonResponse(200, { toptags: { tag: [{ name: 'pop', count: 97 }] } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await lastfmProvider.enrich({
      uri: 'spotify:track:1',
      name: 'Unknown',
      artists: 'Cher',
      isrc: null,
    });

    expect(result).toEqual({ tags: [{ tag: 'pop', weight: 97 }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = fetchMock.mock.calls[1]?.[0] as URL;
    expect(secondUrl.toString()).toContain('method=artist.gettoptags');
  });

  it('returns null when Last.fm has nothing for either the track or the artist', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { error: 6, message: 'Track not found' }))
      .mockResolvedValueOnce(jsonResponse(200, { error: 6, message: 'Artist not found' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await lastfmProvider.enrich({
      uri: 'spotify:track:1',
      name: 'Ghost',
      artists: 'Nobody',
      isrc: null,
    });

    expect(result).toBeNull();
  });

  it('uses only the first artist when multiple are joined', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { toptags: { tag: [] } }))
      .mockResolvedValueOnce(jsonResponse(200, { toptags: { tag: [{ name: 'pop', count: 50 }] } }));
    vi.stubGlobal('fetch', fetchMock);

    await lastfmProvider.enrich({
      uri: 'spotify:track:1',
      name: 'Song',
      artists: 'Artist A, Artist B',
      isrc: null,
    });

    const firstUrl = fetchMock.mock.calls[0]?.[0] as URL;
    expect(firstUrl.toString()).toContain('artist=Artist+A');
  });
});
