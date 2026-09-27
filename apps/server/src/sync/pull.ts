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
import { getMyPlaylists, getPlaylistItems } from '../spotify/client.js';
import { normalizeTrackEntry } from './normalize.js';

export class PullSetupError extends Error {}

export interface PullSummary {
  mainTrackCount: number;
  archiveTrackCount: number;
  subPlaylists: { name: string; trackCount: number }[];
  skippedEpisodes: number;
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
  const mainMeta = allPlaylists.find((p) => p.id === mainSpotifyId);
  const archiveMeta = allPlaylists.find((p) => p.id === archiveSpotifyId);
  upsertPlaylist(mainSpotifyId, mainMeta?.name ?? 'Main', 'main');
  upsertPlaylist(archiveSpotifyId, archiveMeta?.name ?? 'Main – Archive', 'archive');

  resetMembershipFlags();
  let skippedEpisodes = 0;

  const mainItems = await getPlaylistItems(accessToken, mainSpotifyId);
  for (const entry of mainItems) {
    if (entry.item?.type === 'episode') {
      skippedEpisodes++;
      continue;
    }
    const track = normalizeTrackEntry(entry);
    if (!track) continue;
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
