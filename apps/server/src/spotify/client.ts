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
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

    if (res.status === 429) {
      const body = (await res
        .clone()
        .json()
        .catch(() => undefined)) as { error?: { reason?: string } } | undefined;

      // QUOTA_EXCEEDED is an app-level cap, not a transient rate limit — retrying won't help.
      if (body?.error?.reason === 'QUOTA_EXCEEDED') {
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
      throw new Error(`Spotify API ${url} returned ${res.status}: ${text}`);
    }

    return res.json();
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
  'next,total,items(added_at,is_local,item(id,uri,name,duration_ms,is_local,type,artists(name),album(name,images(url))))';

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
  const page = savedTracksPageSchema.parse(await spotifyGet(accessToken, `${API_BASE}/me/tracks?limit=1`));
  return page.total;
}
