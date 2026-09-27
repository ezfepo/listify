import type { SpotifyPlaylistItemEntry } from '../spotify/schemas.js';
import type { NormalizedTrack } from './types.js';

/**
 * Converts a raw playlist-items entry into a NormalizedTrack, or null to skip it.
 * Returns null for a removed track (`item` is null) or an episode — per plan.md,
 * episodes aren't tracked at all; local tracks are kept but flagged (`isLocal`)
 * since they can't be managed by URI like a normal Spotify track.
 */
export function normalizeTrackEntry(entry: SpotifyPlaylistItemEntry): NormalizedTrack | null {
  const item = entry.item;
  if (!item || item.type !== 'track') return null;

  const artists = (item.artists ?? []).map((a) => a.name).join(', ');
  const imageUrl = item.album?.images?.[0]?.url ?? null;

  return {
    uri: item.uri,
    name: item.name,
    artists,
    album: item.album?.name ?? null,
    imageUrl,
    durationMs: item.duration_ms ?? null,
    addedAt: entry.added_at,
    isLocal: entry.is_local || Boolean(item.is_local),
  };
}
