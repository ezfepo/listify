import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

const fetchMock = vi.fn();

interface Call {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body: unknown;
}

// Typed view of the nth fetch call (url, init) with the JSON body parsed.
function call(n: number): Call {
  const args = fetchMock.mock.calls[n] as [string, RequestInit | undefined] | undefined;
  if (!args) throw new Error(`fetch call #${n} was not made`);
  const [url, init] = args;
  return {
    url,
    method: init?.method,
    headers: init?.headers as Record<string, string> | undefined,
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api request helper', () => {
  it('returns parsed JSON on success', async () => {
    const library = { playlists: [], statusCounts: { inbox: 1, organized: 2, skipped: 3 } };
    fetchMock.mockResolvedValue(jsonResponse(library));

    await expect(api.getLibrary()).resolves.toEqual(library);
    expect(fetchMock).toHaveBeenCalledWith('/api/library', expect.any(Object));
  });

  it('returns undefined on 204 without parsing a body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(api.deletePlaylist(7)).resolves.toBeUndefined();
    expect(call(0).url).toBe('/api/playlists/7');
    expect(call(0).method).toBe('DELETE');
  });

  it('sets the JSON content type only when there is a body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await api.deletePlaylist(1);
    expect(call(0).headers).toBeUndefined();

    await api.createPlaylist({ name: 'Chill' });
    expect(call(1).headers).toEqual({ 'Content-Type': 'application/json' });
    expect(call(1).body).toEqual({ name: 'Chill' });
  });

  it('throws ApiError carrying status and the server message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Playlist not found' }, 404));

    const err = await api.getRecipe(99).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.message).toBe('Playlist not found');
  });

  it('falls back to body.error, then to a generic HTTP message', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad_request' }, 400));
    await expect(api.getLibrary()).rejects.toMatchObject({ status: 400, message: 'bad_request' });

    fetchMock.mockResolvedValueOnce(new Response('<html>oops</html>', { status: 502 }));
    await expect(api.getLibrary()).rejects.toMatchObject({ status: 502, message: 'HTTP 502' });
  });
});

describe('api endpoints', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async () => jsonResponse({ total: 0, items: [] }));
  });

  it('getTracks defaults to limit 5000 / offset 0 and omits empty filters', async () => {
    await api.getTracks();
    expect(call(0).url).toBe('/api/tracks?limit=5000&offset=0');
  });

  it('getTracks sends status, query, limit and offset', async () => {
    await api.getTracks({ status: 'inbox', q: 'daft punk', limit: 20, offset: 40 });
    const url = new URL(call(0).url, 'http://x');
    expect(url.pathname).toBe('/api/tracks');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: 'inbox',
      q: 'daft punk',
      limit: '20',
      offset: '40',
    });
  });

  it('URL-encodes track URIs in the path', async () => {
    await api.assignTrack('spotify:track:abc123', 5);
    expect(call(0).url).toBe('/api/tracks/spotify%3Atrack%3Aabc123/assign');
    expect(call(0).body).toEqual({ playlistId: 5 });
  });

  it('bulk operations post uris and playlistId together', async () => {
    await api.bulkAssign(['a', 'b'], 3);
    await api.bulkUnassign(['c'], 4);
    expect(call(0).url).toBe('/api/tracks/bulk/assign');
    expect(call(0).body).toEqual({
      uris: ['a', 'b'],
      playlistId: 3,
    });
    expect(call(1).url).toBe('/api/tracks/bulk/unassign');
    expect(call(1).body).toEqual({ uris: ['c'], playlistId: 4 });
  });

  it('setTrackStatus surfaces removedFromPlaylistIds so skip can be undone', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ removedFromPlaylistIds: [1, 2] }));

    await expect(api.setTrackStatus('spotify:track:x', 'skipped')).resolves.toEqual({
      removedFromPlaylistIds: [1, 2],
    });
    expect(call(0).body).toEqual({ status: 'skipped' });
  });

  it('getPlaylistSuggestions defaults to limit 50', async () => {
    await api.getPlaylistSuggestions(9);
    expect(call(0).url).toBe('/api/playlists/9/suggestions?limit=50');
  });

  it('putRecipe PUTs the recipe without a playlistId in the body', async () => {
    const recipe = {
      includeTags: ['chill'],
      excludeTags: [],
      featureRanges: { energy: [0, 0.4] as [number, number] },
    };
    await api.putRecipe(2, recipe);
    expect(call(0).method).toBe('PUT');
    expect(call(0).body).toEqual(recipe);
  });

  it('getSyncDiff GETs the diff preview', async () => {
    await api.getSyncDiff();
    expect(call(0).url).toBe('/api/sync/diff');
    expect(call(0).method).toBeUndefined();
  });

  it('applySync POSTs with no body', async () => {
    await api.applySync();
    expect(call(0).url).toBe('/api/sync/apply');
    expect(call(0).method).toBe('POST');
    expect(call(0).body).toBeUndefined();
  });

  it('importSnapshot POSTs the parsed snapshot as the body', async () => {
    const snapshot = { version: 1, exportedAt: 'now', tables: {}, settings: {} };
    await api.importSnapshot(snapshot);
    expect(call(0).url).toBe('/api/import');
    expect(call(0).method).toBe('POST');
    expect(call(0).body).toEqual(snapshot);
  });
});
