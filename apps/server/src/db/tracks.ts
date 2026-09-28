import { db } from './index.js';
import './schema.js';
import type { NormalizedTrack } from '../sync/types.js';

/** Clears in_main/in_archive on every track; a pull re-marks whatever it actually finds. */
export function resetMembershipFlags(): void {
  db.exec('UPDATE tracks SET in_main = 0, in_archive = 0');
}

export function upsertTrack(track: NormalizedTrack, defaultStatus: 'inbox' | 'organized'): void {
  const existing = db.prepare('SELECT uri FROM tracks WHERE uri = ?').get(track.uri);

  if (existing) {
    db.prepare(
      `UPDATE tracks
       SET name = ?, artists = ?, album = ?, image_url = ?, duration_ms = ?, added_at = ?, is_local = ?, isrc = ?
       WHERE uri = ?`,
    ).run(
      track.name,
      track.artists,
      track.album,
      track.imageUrl,
      track.durationMs,
      track.addedAt,
      track.isLocal ? 1 : 0,
      track.isrc,
      track.uri,
    );
    return;
  }

  db.prepare(
    `INSERT INTO tracks
       (uri, name, artists, album, image_url, duration_ms, added_at, first_seen_at, status, in_main, in_archive, is_local, isrc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
  ).run(
    track.uri,
    track.name,
    track.artists,
    track.album,
    track.imageUrl,
    track.durationMs,
    track.addedAt,
    new Date().toISOString(),
    defaultStatus,
    track.isLocal ? 1 : 0,
    track.isrc,
  );
}

export function markInMain(uri: string): void {
  db.prepare('UPDATE tracks SET in_main = 1 WHERE uri = ?').run(uri);
}

export function markInArchive(uri: string): void {
  db.prepare('UPDATE tracks SET in_archive = 1 WHERE uri = ?').run(uri);
}

export function countTracksInMain(): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM tracks WHERE in_main = 1').get() as {
    count: number;
  };
  return row.count;
}

export function countTracksInArchive(): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM tracks WHERE in_archive = 1').get() as {
    count: number;
  };
  return row.count;
}

export type TrackStatus = 'inbox' | 'organized' | 'skipped';

export interface TrackRow {
  uri: string;
  name: string;
  artists: string;
  album: string | null;
  image_url: string | null;
  duration_ms: number | null;
  added_at: string | null;
  status: TrackStatus;
  in_main: number;
  in_archive: number;
  is_local: number;
  isrc: string | null;
}

export function getTrack(uri: string): TrackRow | undefined {
  return db.prepare('SELECT * FROM tracks WHERE uri = ?').get(uri) as TrackRow | undefined;
}

export function getTrackStatus(uri: string): TrackStatus | undefined {
  const row = db.prepare('SELECT status FROM tracks WHERE uri = ?').get(uri) as
    { status: TrackStatus } | undefined;
  return row?.status;
}

export function setTrackStatus(uri: string, status: TrackStatus): void {
  db.prepare('UPDATE tracks SET status = ? WHERE uri = ?').run(status, uri);
}

/** Assign/unassign call this after changing a track's sub-playlist memberships, to keep `status` in sync — never overrides an explicit 'skipped'. */
export function recomputeStatusFromAssignments(uri: string, assignedToAnyPlaylist: boolean): void {
  const current = getTrackStatus(uri);
  if (current === 'skipped') return;
  setTrackStatus(uri, assignedToAnyPlaylist ? 'organized' : 'inbox');
}

export function getStatusCounts(): Record<TrackStatus, number> {
  const rows = db.prepare('SELECT status, COUNT(*) AS count FROM tracks GROUP BY status').all() as {
    status: TrackStatus;
    count: number;
  }[];
  const counts: Record<TrackStatus, number> = { inbox: 0, organized: 0, skipped: 0 };
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

/** Tracks not yet assigned to any sub-playlist — the candidate pool for suggestions/auto-sort. Excludes 'skipped'. */
export function listUnassignedCandidateTracks(): TrackRow[] {
  return db
    .prepare(
      `SELECT t.* FROM tracks t
       WHERE t.status != 'skipped'
         AND NOT EXISTS (SELECT 1 FROM playlist_tracks pt WHERE pt.track_uri = t.uri)`,
    )
    .all() as unknown as TrackRow[];
}
