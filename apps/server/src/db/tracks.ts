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
       SET name = ?, artists = ?, album = ?, image_url = ?, duration_ms = ?, added_at = ?, is_local = ?
       WHERE uri = ?`,
    ).run(
      track.name,
      track.artists,
      track.album,
      track.imageUrl,
      track.durationMs,
      track.addedAt,
      track.isLocal ? 1 : 0,
      track.uri,
    );
    return;
  }

  db.prepare(
    `INSERT INTO tracks
       (uri, name, artists, album, image_url, duration_ms, added_at, first_seen_at, status, in_main, in_archive, is_local)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
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
