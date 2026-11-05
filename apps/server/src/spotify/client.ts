import { SpotifyHttpError, SpotifyRateLimitError } from './errors.js';
import {
  meProfileSchema,
  playlistItemsPageSchema,
  playlistsPageSchema,
  savedTracksPageSchema,
  type SpotifyMeProfile,
  type SpotifyPlaylistItemEntry,
  type SpotifySavedTrackEntry,
  type SpotifySimplifiedPlaylist,
} from './schemas.js';

const API_BASE = 'https://api.spotify.com/v1';
const PAGE_LIMIT = 50;
const MAX_429_RETRIES = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function spotifyGet(accessToken: string, url: string): Promise<unknown> {
  return spotifyRequest(accessToken, url, 'GET');
}

/**
 * Shared request helper for every Spotify write call (POST/DELETE) plus GET,
 * with the same 429/backoff handling as reads: honors Retry-After, distinguishes
 * an app-level QUOTA_EXCEEDED (not worth retrying) from a transient rate limit.
 */
async function spotifyRequest(
  accessToken: string,
  url: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429) {
      const responseBody = (await res
        .clone()
        .json()
        .catch(() => undefined)) as { error?: { reason?: string } } | undefined;

      // QUOTA_EXCEEDED is an app-level cap, not a transient rate limit — retrying won't help.
      if (responseBody?.error?.reason === 'QUOTA_EXCEEDED') {
        throw new SpotifyRateLimitError('Spotify app quota exceeded (reason: QUOTA_EXCEEDED)');
      }
      if (attempt >= MAX_429_RETRIES) {
        throw new SpotifyRateLimitError('Spotify rate limit retries exhausted');
      }
      const retryAfter = Math.max(1, Number(res.headers.get('retry-after') ?? '1'));
      await sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new SpotifyHttpError(
        res.status,
        `Spotify API ${method} ${url} returned ${res.status}: ${text}`,
      );
    }

    if (res.status === 204) return undefined;
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }
}

/** The current user's profile. Throws SpotifyHttpError(status) on a non-2xx response. */
export async function getMe(accessToken: string): Promise<SpotifyMeProfile> {
  const res = await fetch(`${API_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new SpotifyHttpError(res.status, `GET /me returned ${res.status}`);
  }
  return meProfileSchema.parse(await res.json());
}

/** All playlists owned or followed by the current user (paginated). */
export async function getMyPlaylists(accessToken: string): Promise<SpotifySimplifiedPlaylist[]> {
  const playlists: SpotifySimplifiedPlaylist[] = [];
  let url: string | null = `${API_BASE}/me/playlists?limit=${PAGE_LIMIT}`;

  while (url) {
    const page = playlistsPageSchema.parse(await spotifyGet(accessToken, url));
    playlists.push(...page.items);
    url = page.next;
  }

  return playlists;
}

const ITEMS_FIELDS =
  'next,total,items(added_at,is_local,item(id,uri,name,duration_ms,is_local,type,artists(name),album(name,images(url)),external_ids(isrc)))';

/** All items (tracks/episodes) of a playlist (paginated). */
export async function getPlaylistItems(
  accessToken: string,
  playlistId: string,
): Promise<SpotifyPlaylistItemEntry[]> {
  const entries: SpotifyPlaylistItemEntry[] = [];
  let url: string | null =
    `${API_BASE}/playlists/${playlistId}/items?limit=${PAGE_LIMIT}&fields=${encodeURIComponent(ITEMS_FIELDS)}`;

  while (url) {
    const page = playlistItemsPageSchema.parse(await spotifyGet(accessToken, url));
    entries.push(...page.items);
    url = page.next;
  }

  return entries;
}

/** All of the current user's saved tracks ("Liked Songs"), paginated. */
export async function getSavedTracks(accessToken: string): Promise<SpotifySavedTrackEntry[]> {
  const entries: SpotifySavedTrackEntry[] = [];
  let url: string | null = `${API_BASE}/me/tracks?limit=${PAGE_LIMIT}`;

  while (url) {
    const page = savedTracksPageSchema.parse(await spotifyGet(accessToken, url));
    entries.push(...page.items);
    url = page.next;
  }

  return entries;
}

/** Just the total count of saved tracks, without paginating through all of them. */
export async function getSavedTracksTotal(accessToken: string): Promise<number> {
  const page = savedTracksPageSchema.parse(
    await spotifyGet(accessToken, `${API_BASE}/me/tracks?limit=1`),
  );
  return page.total;
}

/**
 * Starts playback of a single track on the user's active device (Premium only).
 * Throws SpotifyHttpError(404) when there's no active device — callers should
 * treat that as "nothing to play", not a real failure (plan.md: optional feature).
 */
export async function playTrack(accessToken: string, trackUri: string): Promise<void> {
  const res = await fetch(`${API_BASE}/me/player/play`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [trackUri] }),
  });
  if (!res.ok) {
    throw new SpotifyHttpError(res.status, `PUT /me/player/play returned ${res.status}`);
  }
}

/** Creates a new playlist for the current user. Empty until items are added. */
export async function createPlaylist(accessToken: string, name: string): Promise<{ id: string }> {
  const body = (await spotifyRequest(accessToken, `${API_BASE}/me/playlists`, 'POST', {
    name,
    public: false,
  })) as { id: string };
  return body;
}

/** Adds up to 100 track/episode URIs to a playlist in one call — chunk before calling. */
export async function addItemsToPlaylist(
  accessToken: string,
  playlistId: string,
  uris: string[],
): Promise<void> {
  await spotifyRequest(accessToken, `${API_BASE}/playlists/${playlistId}/items`, 'POST', { uris });
}

/** Removes up to 100 track/episode URIs from a playlist in one call — chunk before calling. */
export async function removeItemsFromPlaylist(
  accessToken: string,
  playlistId: string,
  uris: string[],
): Promise<void> {
  await spotifyRequest(accessToken, `${API_BASE}/playlists/${playlistId}/items`, 'DELETE', {
    items: uris.map((uri) => ({ uri })),
  });
}

/**
 * Removes tracks from the current user's Liked Songs ("library"). Verified against
 * live docs (Sep 2026): the old `DELETE /me/tracks` (track IDs, max 50) is now
 * deprecated in favor of `DELETE /me/library` (Spotify URIs, max 40) — plan.md's
 * "chunked by 50, track IDs" is stale; use URIs chunked by 40 instead. Caller chunks.
 */
export async function removeSavedTracks(accessToken: string, uris: string[]): Promise<void> {
  const query = new URLSearchParams({ uris: uris.join(',') });
  await spotifyRequest(accessToken, `${API_BASE}/me/library?${query.toString()}`, 'DELETE');
}
