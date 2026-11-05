/**
 * Step 2 of the sync engine (plan.md §4): a pure comparison of desired (local DB)
 * state against actual (freshly-read Spotify) state, producing the ordered list of
 * write operations apply() must perform. No I/O here — everything is passed in, so
 * this is fully unit-testable without a DB or network.
 */

export interface DiffSubPlaylistInput {
  id: number;
  spotifyId: string | null;
  name: string;
  /** Locally desired membership (from playlist_tracks) — may contain duplicates. */
  desiredUris: string[];
  /** Actual current Spotify membership; empty when spotifyId is null (not created yet). */
  actualUris: string[];
}

export interface DiffInput {
  subPlaylists: DiffSubPlaylistInput[];
  /** URIs of every track assigned to at least one sub-playlist (status='organized'), excluding local files. */
  organizedUris: string[];
  /** Archive's actual current Spotify membership. */
  actualArchiveUris: string[];
  /** Main's (or Liked Songs') actual current Spotify membership. */
  actualMainUris: string[];
  /** is_local tracks — Spotify can't manage these by URI, so they're excluded from every op. */
  localTrackUris: string[];
}

export type DiffOperation =
  | { kind: 'createPlaylist'; playlistId: number; name: string }
  | { kind: 'addToPlaylist'; playlistId: number; uris: string[] }
  | { kind: 'addToArchive'; uris: string[] }
  | { kind: 'removeFromMain'; uris: string[] };

export interface DiffResult {
  operations: DiffOperation[];
  /** Local-file URIs that were excluded from every op above, for visibility in the Diff Preview UI. */
  skippedLocalUris: string[];
}

export function diff(input: DiffInput): DiffResult {
  const localSet = new Set(input.localTrackUris);
  const operations: DiffOperation[] = [];

  for (const sub of input.subPlaylists) {
    if (!sub.spotifyId) {
      operations.push({ kind: 'createPlaylist', playlistId: sub.id, name: sub.name });
    }

    const actualSet = new Set(sub.actualUris);
    const desiredSet = new Set(sub.desiredUris);
    const toAdd = [...desiredSet].filter((uri) => !actualSet.has(uri) && !localSet.has(uri));
    if (toAdd.length > 0) {
      operations.push({ kind: 'addToPlaylist', playlistId: sub.id, uris: toAdd });
    }
  }

  const organizedSet = new Set(input.organizedUris);

  const archiveActualSet = new Set(input.actualArchiveUris);
  const toArchive = [...organizedSet].filter(
    (uri) => !archiveActualSet.has(uri) && !localSet.has(uri),
  );
  if (toArchive.length > 0) {
    operations.push({ kind: 'addToArchive', uris: toArchive });
  }

  const mainActualSet = new Set(input.actualMainUris);
  const toRemoveFromMain = [...organizedSet].filter(
    (uri) => mainActualSet.has(uri) && !localSet.has(uri),
  );
  if (toRemoveFromMain.length > 0) {
    operations.push({ kind: 'removeFromMain', uris: toRemoveFromMain });
  }

  return { operations, skippedLocalUris: [...localSet] };
}
