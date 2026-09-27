import { getSetting } from '../db/settings.js';
import { listSubPlaylists, replacePlaylistTracks, upsertPlaylist } from '../db/playlists.js';
import {
  countTracksInArchive,
  countTracksInMain,
  markInArchive,
  markInMain,
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

/** Step 1 of the sync engine: read Main, Archive, and every adopted sub-playlist, upsert into the DB. */
export async function pull(): Promise<PullSummary> {
  const mainSpotifyId = getSetting('main_playlist_spotify_id');
  const archiveSpotifyId = getSetting('archive_playlist_spotify_id');
  if (!mainSpotifyId || !archiveSpotifyId) {
    throw new PullSetupError('Main and Archive playlists are not configured yet');
  }

  const accessToken = await getValidAccessToken();

  const allPlaylists = await getMyPlaylists(accessToken);
  const archiveMeta = allPlaylists.find((p) => p.id === archiveSpotifyId);
  const mainName = isLikedSongs(mainSpotifyId)
    ? 'Liked Songs'
    : (allPlaylists.find((p) => p.id === mainSpotifyId)?.name ?? 'Main');
  upsertPlaylist(mainSpotifyId, mainName, 'main');
  upsertPlaylist(archiveSpotifyId, archiveMeta?.name ?? 'Main – Archive', 'archive');

  resetMembershipFlags();

  const mainResult = await fetchMainTracks(accessToken, mainSpotifyId);
  const mainTracks = mainResult.tracks;
  let skippedEpisodes = mainResult.skippedEpisodes;
  for (const track of mainTracks) {
    upsertTrack(track, 'inbox');
    markInMain(track.uri);
  }

  const archiveItems = await getPlaylistItems(accessToken, archiveSpotifyId);
  for (const entry of archiveItems) {
    if (entry.item?.type === 'episode') {
      skippedEpisodes++;
      continue;
    }
    const track = normalizeTrackEntry(entry);
    if (!track) continue;
    upsertTrack(track, 'organized');
    markInArchive(track.uri);
  }

  const subPlaylists = listSubPlaylists();
  const subSummaries: { name: string; trackCount: number }[] = [];
  for (const sub of subPlaylists) {
    if (!sub.spotify_id) continue;
    const items = await getPlaylistItems(accessToken, sub.spotify_id);
    const uris: string[] = [];
    for (const entry of items) {
      if (entry.item?.type === 'episode') {
        skippedEpisodes++;
        continue;
      }
      const track = normalizeTrackEntry(entry);
      if (!track) continue;
      upsertTrack(track, 'organized');
      uris.push(track.uri);
    }
    replacePlaylistTracks(sub.id, uris);
    subSummaries.push({ name: sub.name, trackCount: uris.length });
  }

  return {
    mainTrackCount: countTracksInMain(),
    archiveTrackCount: countTracksInArchive(),
    subPlaylists: subSummaries,
    skippedEpisodes,
  };
}
