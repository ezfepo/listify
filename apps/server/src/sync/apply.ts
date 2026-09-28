import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { db } from '../db/index.js';
import './../db/schema.js';
import { writeBackupSnapshot } from '../db/export.js';
import {
  getPlaylistById,
  listSubPlaylists,
  listTrackUrisForPlaylist,
  setPlaylistSpotifyId,
} from '../db/playlists.js';
import { getSetting } from '../db/settings.js';
import { listLocalTrackUris, listOrganizedTrackUris } from '../db/tracks.js';
import { getValidAccessToken } from '../spotify/auth.js';
import {
  addItemsToPlaylist,
  createPlaylist,
  getPlaylistItems,
  getSavedTracks,
  removeItemsFromPlaylist,
  removeSavedTracks,
} from '../spotify/client.js';
import { isLikedSongs } from '../spotify/liked-songs.js';
import { chunk } from '../util/chunk.js';
import { diff, type DiffInput, type DiffOperation } from './diff.js';
import { normalizeSavedTrackEntry, normalizeTrackEntry } from './normalize.js';

// nothing outside sync/apply.ts may write to Spotify (CLAUDE.md).

export class ApplySetupError extends Error {}

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKUPS_DIR = process.env.LISTIFY_BACKUPS_DIR ?? `${__dirname}/../../../../data/backups`;

const PLAYLIST_ITEM_CHUNK = 100;
const LIBRARY_ITEM_CHUNK = 40; // DELETE /me/library — see spotify/client.ts removeSavedTracks

async function fetchMainUris(accessToken: string, mainSpotifyId: string): Promise<string[]> {
  if (isLikedSongs(mainSpotifyId)) {
    const entries = await getSavedTracks(accessToken);
    return entries
      .map(normalizeSavedTrackEntry)
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .map((t) => t.uri);
  }
  const entries = await getPlaylistItems(accessToken, mainSpotifyId);
  return entries
    .map(normalizeTrackEntry)
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .map((t) => t.uri);
}

async function fetchPlaylistUris(accessToken: string, spotifyId: string): Promise<string[]> {
  const entries = await getPlaylistItems(accessToken, spotifyId);
  return entries
    .map(normalizeTrackEntry)
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .map((t) => t.uri);
}

async function buildDiffInput(
  accessToken: string,
  mainSpotifyId: string,
  archiveSpotifyId: string,
) {
  const [actualMainUris, actualArchiveUris] = await Promise.all([
    fetchMainUris(accessToken, mainSpotifyId),
    fetchPlaylistUris(accessToken, archiveSpotifyId),
  ]);

  const subPlaylists = listSubPlaylists();
  const subInputs: DiffInput['subPlaylists'] = [];
  for (const sub of subPlaylists) {
    const actualUris = sub.spotify_id ? await fetchPlaylistUris(accessToken, sub.spotify_id) : [];
    subInputs.push({
      id: sub.id,
      spotifyId: sub.spotify_id,
      name: sub.name,
      desiredUris: listTrackUrisForPlaylist(sub.id),
      actualUris,
    });
  }

  const input: DiffInput = {
    subPlaylists: subInputs,
    organizedUris: listOrganizedTrackUris(),
    actualArchiveUris,
    actualMainUris,
    localTrackUris: listLocalTrackUris(),
  };
  return input;
}

export interface DiffPreview {
  operations: DiffOperation[];
  skippedLocalUris: string[];
}

/** Read-only: computes what apply() would do, without writing a backup, logging, or touching Spotify writes. For the Diff Preview UI. */
export async function previewDiff(): Promise<DiffPreview> {
  const mainSpotifyId = getSetting('main_playlist_spotify_id');
  const archiveSpotifyId = getSetting('archive_playlist_spotify_id');
  if (!mainSpotifyId || !archiveSpotifyId) {
    throw new ApplySetupError('Main and Archive playlists are not configured yet');
  }
  const accessToken = await getValidAccessToken();
  const diffInput = await buildDiffInput(accessToken, mainSpotifyId, archiveSpotifyId);
  return diff(diffInput);
}

interface LoggedOp {
  op: DiffOperation;
  status: 'dry_run' | 'done' | 'failed';
  error?: string;
}

function logOperation(batchId: string, entry: LoggedOp): void {
  db.prepare(
    'INSERT INTO operations (ts, batch_id, type, payload_json, status, error) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    new Date().toISOString(),
    batchId,
    entry.op.kind,
    JSON.stringify(entry.op),
    entry.status,
    entry.error ?? null,
  );
}

export interface ApplySummary {
  dryRun: boolean;
  batchId: string;
  backupPath: string;
  operations: { operation: DiffOperation; status: 'dry_run' | 'done' | 'failed'; error?: string }[];
  skippedLocalUris: string[];
}

/**
 * Step 4 of the sync engine (plan.md §4), strictly in order: snapshot, create
 * missing playlists, add to sub-playlists, add to Archive, re-verify Archive, only
 * then remove from Main (only URIs actually confirmed present in Archive).
 * With `config.dryRun` (default true until Phase 6), every write is logged instead
 * of sent.
 */
export async function apply(): Promise<ApplySummary> {
  const mainSpotifyId = getSetting('main_playlist_spotify_id');
  const archiveSpotifyId = getSetting('archive_playlist_spotify_id');
  if (!mainSpotifyId || !archiveSpotifyId) {
    throw new ApplySetupError('Main and Archive playlists are not configured yet');
  }

  const dryRun = config.dryRun;
  const batchId = randomUUID();
  const backupPath = writeBackupSnapshot(BACKUPS_DIR); // 4.a

  const accessToken = await getValidAccessToken();
  const diffInput = await buildDiffInput(accessToken, mainSpotifyId, archiveSpotifyId);
  const { operations, skippedLocalUris } = diff(diffInput);

  const logged: ApplySummary['operations'] = [];
  // Playlists created this run — new sub-playlists don't have a spotify_id in the
  // DB yet, but later addToPlaylist ops in the same batch need it.
  const createdSpotifyIds = new Map<number, string>();

  for (const op of operations) {
    if (op.kind !== 'createPlaylist') continue; // 4.b
    if (dryRun) {
      logOperation(batchId, { op, status: 'dry_run' });
      logged.push({ operation: op, status: 'dry_run' });
      continue;
    }
    try {
      const created = await createPlaylist(accessToken, op.name);
      setPlaylistSpotifyId(op.playlistId, created.id);
      createdSpotifyIds.set(op.playlistId, created.id);
      logOperation(batchId, { op, status: 'done' });
      logged.push({ operation: op, status: 'done' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logOperation(batchId, { op, status: 'failed', error: message });
      logged.push({ operation: op, status: 'failed', error: message });
    }
  }

  for (const op of operations) {
    if (op.kind !== 'addToPlaylist') continue; // 4.c
    const playlist = getPlaylistById(op.playlistId);
    const spotifyId = createdSpotifyIds.get(op.playlistId) ?? playlist?.spotify_id ?? undefined;
    if (dryRun || !spotifyId) {
      logOperation(batchId, { op, status: 'dry_run' });
      logged.push({ operation: op, status: 'dry_run' });
      continue;
    }
    try {
      for (const batch of chunk(op.uris, PLAYLIST_ITEM_CHUNK)) {
        await addItemsToPlaylist(accessToken, spotifyId, batch);
      }
      logOperation(batchId, { op, status: 'done' });
      logged.push({ operation: op, status: 'done' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logOperation(batchId, { op, status: 'failed', error: message });
      logged.push({ operation: op, status: 'failed', error: message });
    }
  }

  const addToArchiveOp = operations.find((op) => op.kind === 'addToArchive');
  if (addToArchiveOp) {
    // 4.d
    if (dryRun) {
      logOperation(batchId, { op: addToArchiveOp, status: 'dry_run' });
      logged.push({ operation: addToArchiveOp, status: 'dry_run' });
    } else {
      try {
        for (const batch of chunk(addToArchiveOp.uris, PLAYLIST_ITEM_CHUNK)) {
          await addItemsToPlaylist(accessToken, archiveSpotifyId, batch);
        }
        logOperation(batchId, { op: addToArchiveOp, status: 'done' });
        logged.push({ operation: addToArchiveOp, status: 'done' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logOperation(batchId, { op: addToArchiveOp, status: 'failed', error: message });
        logged.push({ operation: addToArchiveOp, status: 'failed', error: message });
      }
    }
  }

  const removeFromMainOp = operations.find((op) => op.kind === 'removeFromMain');
  if (removeFromMainOp) {
    if (dryRun) {
      // 4.e/4.f are skipped in dry-run — nothing was actually added to Archive to verify against.
      logOperation(batchId, { op: removeFromMainOp, status: 'dry_run' });
      logged.push({ operation: removeFromMainOp, status: 'dry_run' });
    } else {
      try {
        // 4.e: re-read Archive fresh — never trust the pre-write diff for what to remove.
        const verifiedArchiveUris = new Set(await fetchPlaylistUris(accessToken, archiveSpotifyId));
        const verifiedUris = removeFromMainOp.uris.filter((uri) => verifiedArchiveUris.has(uri));
        const unverifiedUris = removeFromMainOp.uris.filter((uri) => !verifiedArchiveUris.has(uri));

        if (verifiedUris.length > 0) {
          // 4.f
          if (isLikedSongs(mainSpotifyId)) {
            for (const batch of chunk(verifiedUris, LIBRARY_ITEM_CHUNK)) {
              await removeSavedTracks(accessToken, batch);
            }
          } else {
            for (const batch of chunk(verifiedUris, PLAYLIST_ITEM_CHUNK)) {
              await removeItemsFromPlaylist(accessToken, mainSpotifyId, batch);
            }
          }
        }

        const executedOp: DiffOperation = { kind: 'removeFromMain', uris: verifiedUris };
        logOperation(batchId, { op: executedOp, status: 'done' });
        logged.push({ operation: executedOp, status: 'done' });
        if (unverifiedUris.length > 0) {
          const skippedOp: DiffOperation = { kind: 'removeFromMain', uris: unverifiedUris };
          logOperation(batchId, {
            op: skippedOp,
            status: 'failed',
            error: 'not verified present in Archive after 4.d — Main left untouched for these URIs',
          });
          logged.push({
            operation: skippedOp,
            status: 'failed',
            error: 'not verified present in Archive after 4.d — Main left untouched for these URIs',
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logOperation(batchId, { op: removeFromMainOp, status: 'failed', error: message });
        logged.push({ operation: removeFromMainOp, status: 'failed', error: message });
      }
    }
  }

  return { dryRun, batchId, backupPath, operations: logged, skippedLocalUris };
}
