import { getSetting } from '../db/settings.js';
import {
  countPlaylistsForTrack,
  listSubPlaylists,
  listTrackUrisForPlaylist,
  replacePlaylistTracks,
  upsertPlaylist,
} from '../db/playlists.js';
import {
  countTracksInArchive,
  countTracksInMain,
  markInArchive,
  markInMain,
  recomputeStatusFromAssignments,
  resetMembershipFlags,
  upsertTrack,
} from '../db/tracks.js';
import { getValidAccessToken } from '../spotify/auth.js';
import { getMyPlaylists, getPlaylistItems, getSavedTracks } from '../spotify/client.js';
import { isLikedSongs } from '../spotify/liked-songs.js';
import { normalizeSavedTrackEntry, normalizeTrackEntry } from './normalize.js';
import type { NormalizedTrack } from './types.js';

export class PullSetupError extends Error {}

export interface PullSummary {
  mainTrackCount: number;
  archiveTrackCount: number;
  subPlaylists: { name: string; trackCount: number }[];
  skippedEpisodes: number;
}

interface FetchedTracks {
  tracks: NormalizedTrack[];
  skippedEpisodes: number;
}

/**
 * Reads Main's tracks. "Liked Songs" (GET /me/tracks) isn't a real playlist —
 * it has no ID, a different response shape, and never contains episodes — so it
 * gets its own path rather than reusing getPlaylistItems/normalizeTrackEntry.
 */
async function fetchMainTracks(accessToken: string, mainSpotifyId: string): Promise<FetchedTracks> {
  if (isLikedSongs(mainSpotifyId)) {
    const entries = await getSavedTracks(accessToken);
    const tracks = entries
      .map(normalizeSavedTrackEntry)
      .filter((t): t is NormalizedTrack => t !== null);
    return { tracks, skippedEpisodes: 0 };
  }

  const entries = await getPlaylistItems(accessToken, mainSpotifyId);
  let skippedEpisodes = 0;
  const tracks: NormalizedTrack[] = [];
  for (const entry of entries) {
    if (entry.item?.type === 'episode') {
      skippedEpisodes++;
      continue;
    }
    const track = normalizeTrackEntry(entry);
    if (track) tracks.push(track);
  }
  return { tracks, skippedEpisodes };
}

export interface PendingLocalChange {
  playlistId: number;
  name: string;
  /** Local assignments to this adopted playlist that Spotify doesn't have (yet). */
  count: number;
}

/** Thrown when a pull would overwrite local assignments that were never applied to Spotify. */
export class PullBlockedError extends Error {
  readonly pending: PendingLocalChange[];
  constructor(pending: PendingLocalChange[]) {
    const total = pending.reduce((sum, p) => sum + p.count, 0);
    super(
      `Pull would discard ${total} local assignment(s) that are not on Spotify yet. ` +
        'Apply them first, or pull anyway to discard them.',
    );
    this.pending = pending;
  }
}

export interface PullOptions {
  /** Overwrite local assignments to adopted playlists with what Spotify has. */
  discardLocalChanges?: boolean;
}

interface FetchedSub {
  id: number;
  name: string;
  tracks: NormalizedTrack[];
}

/**
 * Step 1 of the sync engine: read Main, Archive, and every adopted sub-playlist, upsert into the DB.
 *
 * Everything is read from Spotify first; the local DB is only touched afterwards, in one
 * synchronous stretch (no awaits), so nothing can interleave between the pending-changes check
 * and the writes, and the in_main/in_archive flags are never left half-reset across a network call.
 */
export async function pull(options: PullOptions = {}): Promise<PullSummary> {
  const mainSpotifyId = getSetting('main_playlist_spotify_id');
  const archiveSpotifyId = getSetting('archive_playlist_spotify_id');
  if (!mainSpotifyId || !archiveSpotifyId) {
    throw new PullSetupError('Main and Archive playlists are not configured yet');
  }

  const accessToken = await getValidAccessToken();

  // --- read phase (network only) ---
  const allPlaylists = await getMyPlaylists(accessToken);
  const archiveMeta = allPlaylists.find((p) => p.id === archiveSpotifyId);
  const mainName = isLikedSongs(mainSpotifyId)
    ? 'Liked Songs'
    : (allPlaylists.find((p) => p.id === mainSpotifyId)?.name ?? 'Main');

  const mainResult = await fetchMainTracks(accessToken, mainSpotifyId);
  let skippedEpisodes = mainResult.skippedEpisodes;

  const archiveTracks: NormalizedTrack[] = [];
  for (const entry of await getPlaylistItems(accessToken, archiveSpotifyId)) {
    if (entry.item?.type === 'episode') {
      skippedEpisodes++;
      continue;
    }
    const track = normalizeTrackEntry(entry);
    if (track) archiveTracks.push(track);
  }

  const fetchedSubs: FetchedSub[] = [];
  for (const sub of listSubPlaylists()) {
    if (!sub.spotify_id) continue;
    const tracks: NormalizedTrack[] = [];
    for (const entry of await getPlaylistItems(accessToken, sub.spotify_id)) {
      if (entry.item?.type === 'episode') {
        skippedEpisodes++;
        continue;
      }
      const track = normalizeTrackEntry(entry);
      if (track) tracks.push(track);
    }
    fetchedSubs.push({ id: sub.id, name: sub.name, tracks });
  }

  // --- write phase (synchronous) ---
  const pending: PendingLocalChange[] = [];
  for (const sub of fetchedSubs) {
    const onSpotify = new Set(sub.tracks.map((t) => t.uri));
    const count = listTrackUrisForPlaylist(sub.id).filter((uri) => !onSpotify.has(uri)).length;
    if (count > 0) pending.push({ playlistId: sub.id, name: sub.name, count });
  }
  if (pending.length > 0 && !options.discardLocalChanges) {
    throw new PullBlockedError(pending);
  }

  upsertPlaylist(mainSpotifyId, mainName, 'main');
  upsertPlaylist(archiveSpotifyId, archiveMeta?.name ?? 'Main – Archive', 'archive');

  resetMembershipFlags();

  for (const track of mainResult.tracks) {
    upsertTrack(track, 'inbox');
    markInMain(track.uri);
  }

  for (const track of archiveTracks) {
    upsertTrack(track, 'organized');
    markInArchive(track.uri);
  }

  const subSummaries: { name: string; trackCount: number }[] = [];
  for (const sub of fetchedSubs) {
    for (const track of sub.tracks) upsertTrack(track, 'organized');
    // Spotify is authoritative for an adopted sub-playlist's membership, but
    // replacing it doesn't by itself fix `status` for a track that fell out —
    // without this it stays 'organized' forever even if it's now in no playlist.
    const droppedUris = replacePlaylistTracks(
      sub.id,
      sub.tracks.map((t) => t.uri),
    );
    for (const uri of droppedUris) {
      recomputeStatusFromAssignments(uri, countPlaylistsForTrack(uri) > 0);
    }
    subSummaries.push({ name: sub.name, trackCount: sub.tracks.length });
  }

  return {
    mainTrackCount: countTracksInMain(),
    archiveTrackCount: countTracksInArchive(),
    subPlaylists: subSummaries,
    skippedEpisodes,
  };
}
