import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpotifyHttpError, SpotifyRateLimitError } from './errors.js';
import {
  getMe,
  getMyPlaylists,
  getPlaylistItems,
  getSavedTracks,
  getSavedTracksTotal,
  playTrack,
} from './client.js';

const fetchMock = vi.fn();

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const owner = { id: 'u', display_name: null };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('getMe', () => {
  it('sends the bearer token and parses the profile', async () => {
    fetchMock.mockResolvedValue(json({ id: 'me', display_name: 'Me' }));

    await expect(getMe('tok')).resolves.toEqual({ id: 'me', display_name: 'Me' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.spotify.com/v1/me', {
      headers: { Authorization: 'Bearer tok' },
    });
  });

  it('throws SpotifyHttpError carrying the status on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 401 }));
    await expect(getMe('bad')).rejects.toMatchObject({ name: 'SpotifyHttpError', status: 401 });
  });
});

describe('pagination', () => {
  it('getMyPlaylists follows `next` until it is null and concatenates the pages', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          next: 'https://api.spotify.com/v1/me/playlists?offset=50',
          total: 2,
          items: [{ id: '1', name: 'A', owner }],
        }),
      )
      .mockResolvedValueOnce(
        json({ next: null, total: 2, items: [{ id: '2', name: 'B', owner }] }),
      );

    const playlists = await getMyPlaylists('tok');

    expect(playlists.map((p) => p.id)).toEqual(['1', '2']);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.spotify.com/v1/me/playlists?limit=50');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.spotify.com/v1/me/playlists?offset=50');
  });

  it('getPlaylistItems uses /items (not /tracks) with a fields filter and a page limit of 50', async () => {
    fetchMock.mockResolvedValue(json({ next: null, total: 0, items: [] }));

    await getPlaylistItems('tok', 'PL123');

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe('/v1/playlists/PL123/items');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('fields')).toContain('item(');
  });

  it('getSavedTracks reads /me/tracks pages', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          next: 'https://api.spotify.com/v1/me/tracks?offset=50',
          total: 2,
          items: [{ added_at: '2024-01-01T00:00:00Z', track: { uri: 'u1', id: '1', name: 'A' } }],
        }),
      )
      .mockResolvedValueOnce(
        json({
          next: null,
          total: 2,
          items: [{ added_at: '2024-01-02T00:00:00Z', track: { uri: 'u2', id: '2', name: 'B' } }],
        }),
      );

    const entries = await getSavedTracks('tok');
    expect(entries.map((e) => e.track?.uri)).toEqual(['u1', 'u2']);
  });

  it('getSavedTracksTotal asks for a single item and returns only the total', async () => {
    fetchMock.mockResolvedValue(json({ next: null, total: 4321, items: [] }));

    await expect(getSavedTracksTotal('tok')).resolves.toBe(4321);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.spotify.com/v1/me/tracks?limit=1');
  });

  it('rejects a response that does not match the schema (zod-validated)', async () => {
    fetchMock.mockResolvedValue(json({ items: 'nope' }));
    await expect(getMyPlaylists('tok')).rejects.toThrow();
  });

  it('throws with the status and body on a non-2xx, non-429 response', async () => {
    fetchMock.mockResolvedValue(new Response('server on fire', { status: 500 }));
    await expect(getMyPlaylists('tok')).rejects.toThrow(/returned 500: server on fire/);
  });
});

describe('429 handling', () => {
  it('waits for Retry-After and retries', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '3' } }))
      .mockResolvedValueOnce(json({ next: null, total: 0, items: [] }));

    const promise = getMyPlaylists('tok');
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('waits at least 1s when Retry-After is missing or zero', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(json({ next: null, total: 0, items: [] }));

    const promise = getMyPlaylists('tok');
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry QUOTA_EXCEEDED: it is an app-level cap, not a transient rate limit', async () => {
    fetchMock.mockImplementation(async () =>
      json({ error: { status: 429, reason: 'QUOTA_EXCEEDED' } }, { status: 429 }),
    );

    await expect(getMyPlaylists('tok')).rejects.toBeInstanceOf(SpotifyRateLimitError);
    await expect(getMyPlaylists('tok')).rejects.toThrow(/QUOTA_EXCEEDED/);
    expect(fetchMock).toHaveBeenCalledTimes(2); // one call per attempt above, no retries
  });

  it('gives up after 5 retries', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response('', { status: 429 }));

    const promise = getMyPlaylists('tok');
    const assertion = expect(promise).rejects.toThrow(/retries exhausted/);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(6); // initial attempt + 5 retries
  });
});

describe('playTrack', () => {
  it('PUTs the track uri to the player endpoint', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await playTrack('tok', 'spotify:track:1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.spotify.com/v1/me/player/play');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ uris: ['spotify:track:1'] });
  });

  it('throws SpotifyHttpError(404) when there is no active device', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));

    const err = await playTrack('tok', 'spotify:track:1').catch((e) => e);
    expect(err).toBeInstanceOf(SpotifyHttpError);
    expect(err.status).toBe(404);
  });
});
