import { db } from './index.js';
import './schema.js';

export type PlaylistKind = 'main' | 'archive' | 'sub';

export interface PlaylistRow {
  id: number;
  spotify_id: string | null;
  name: string;
  kind: PlaylistKind;
}

export function upsertPlaylist(spotifyId: string, name: string, kind: PlaylistKind): PlaylistRow {
  const existing = db
    .prepare('SELECT id, spotify_id, name, kind FROM playlists WHERE spotify_id = ?')
    .get(spotifyId) as PlaylistRow | undefined;

  if (existing) {
    db.prepare('UPDATE playlists SET name = ?, kind = ? WHERE id = ?').run(name, kind, existing.id);
    return { ...existing, name, kind };
  }

  const result = db
    .prepare('INSERT INTO playlists (spotify_id, name, kind) VALUES (?, ?, ?)')
    .run(spotifyId, name, kind);

  return { id: Number(result.lastInsertRowid), spotify_id: spotifyId, name, kind };
}

export function getPlaylistBySpotifyId(spotifyId: string): PlaylistRow | undefined {
  return db
    .prepare('SELECT id, spotify_id, name, kind FROM playlists WHERE spotify_id = ?')
    .get(spotifyId) as PlaylistRow | undefined;
}

export function getPlaylistById(id: number): PlaylistRow | undefined {
  return db.prepare('SELECT id, spotify_id, name, kind FROM playlists WHERE id = ?').get(id) as
    PlaylistRow | undefined;
}

export function listSubPlaylists(): PlaylistRow[] {
  return db
    .prepare("SELECT id, spotify_id, name, kind FROM playlists WHERE kind = 'sub'")
    .all() as unknown as PlaylistRow[];
}

/** Mirrors a playlist's current Spotify contents: replaces the whole track list. */
export function replacePlaylistTracks(playlistId: number, trackUris: string[]): void {
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlistId);
    const insert = db.prepare(
      'INSERT INTO playlist_tracks (playlist_id, track_uri, assigned_at) VALUES (?, ?, ?)',
    );
    for (const uri of trackUris) {
      insert.run(playlistId, uri, now);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export interface PlaylistWithCount {
  id: number;
  spotifyId: string | null;
  name: string;
  kind: PlaylistKind;
  criteriaNote: string | null;
  emoji: string | null;
  color: string | null;
  sortOrder: number;
  trackCount: number;
}

interface PlaylistDetailRow {
  id: number;
  spotify_id: string | null;
  name: string;
  kind: PlaylistKind;
  criteria_note: string | null;
  emoji: string | null;
  color: string | null;
  sort_order: number;
  track_count: number;
}

function toPlaylistWithCount(row: PlaylistDetailRow): PlaylistWithCount {
  return {
    id: row.id,
    spotifyId: row.spotify_id,
    name: row.name,
    kind: row.kind,
    criteriaNote: row.criteria_note,
    emoji: row.emoji,
    color: row.color,
    sortOrder: row.sort_order,
    trackCount: row.track_count,
  };
}

/** All playlists (main, archive, every sub-playlist) with their current track counts — for the organizer's left pane. */
export function listPlaylistsWithCounts(): PlaylistWithCount[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.spotify_id, p.name, p.kind, p.criteria_note, p.emoji, p.color, p.sort_order,
              CASE p.kind
                WHEN 'main' THEN (SELECT COUNT(*) FROM tracks t WHERE t.in_main = 1)
                WHEN 'archive' THEN (SELECT COUNT(*) FROM tracks t WHERE t.in_archive = 1)
                ELSE (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id)
              END AS track_count
       FROM playlists p
       ORDER BY p.kind, p.sort_order, p.name`,
    )
    .all() as unknown as PlaylistDetailRow[];
  return rows.map(toPlaylistWithCount);
}

export interface NewPlaylistInput {
  name: string;
  criteriaNote?: string | null;
  emoji?: string | null;
  color?: string | null;
}

/** Creates a local-only sub-playlist (no Spotify counterpart yet — that's created on Apply, Phase 5/6). */
export function createSubPlaylist(input: NewPlaylistInput): PlaylistWithCount {
  const result = db
    .prepare(
      "INSERT INTO playlists (spotify_id, name, criteria_note, emoji, color, kind) VALUES (NULL, ?, ?, ?, ?, 'sub')",
    )
    .run(input.name, input.criteriaNote ?? null, input.emoji ?? null, input.color ?? null);
  return {
    id: Number(result.lastInsertRowid),
    spotifyId: null,
    name: input.name,
    kind: 'sub',
    criteriaNote: input.criteriaNote ?? null,
    emoji: input.emoji ?? null,
    color: input.color ?? null,
    sortOrder: 0,
    trackCount: 0,
  };
}

export interface PlaylistUpdateInput {
  name?: string;
  criteriaNote?: string | null;
  emoji?: string | null;
  color?: string | null;
  sortOrder?: number;
}

/** Updates a sub-playlist's editable fields. Only 'sub' playlists are user-editable this way — main/archive come from Spotify. */
export function updateSubPlaylist(id: number, input: PlaylistUpdateInput): void {
  const current = db
    .prepare(
      "SELECT name, criteria_note, emoji, color, sort_order FROM playlists WHERE id = ? AND kind = 'sub'",
    )
    .get(id) as
    | {
        name: string;
        criteria_note: string | null;
        emoji: string | null;
        color: string | null;
        sort_order: number;
      }
    | undefined;
  if (!current) return;

  db.prepare(
    'UPDATE playlists SET name = ?, criteria_note = ?, emoji = ?, color = ?, sort_order = ? WHERE id = ?',
  ).run(
    input.name ?? current.name,
    input.criteriaNote !== undefined ? input.criteriaNote : current.criteria_note,
    input.emoji !== undefined ? input.emoji : current.emoji,
    input.color !== undefined ? input.color : current.color,
    input.sortOrder ?? current.sort_order,
    id,
  );
}

/** Deletes a sub-playlist. Cascades to playlist_tracks and playlist_recipes via ON DELETE CASCADE. */
export function deleteSubPlaylist(id: number): void {
  db.prepare("DELETE FROM playlists WHERE id = ? AND kind = 'sub'").run(id);
}

/** Assigns a track to a sub-playlist (no-op if already assigned). */
export function assignTrackToPlaylist(playlistId: number, trackUri: string): void {
  db.prepare(
    `INSERT INTO playlist_tracks (playlist_id, track_uri, assigned_at) VALUES (?, ?, ?)
     ON CONFLICT(playlist_id, track_uri) DO NOTHING`,
  ).run(playlistId, trackUri, new Date().toISOString());
}

export function unassignTrackFromPlaylist(playlistId: number, trackUri: string): void {
  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_uri = ?').run(
    playlistId,
    trackUri,
  );
}

/** Which sub-playlists a track currently belongs to (main/archive membership isn't tracked here — see tracks.in_main/in_archive). */
export function listPlaylistIdsForTrack(trackUri: string): number[] {
  const rows = db
    .prepare('SELECT playlist_id FROM playlist_tracks WHERE track_uri = ?')
    .all(trackUri) as { playlist_id: number }[];
  return rows.map((r) => r.playlist_id);
}

export function countPlaylistsForTrack(trackUri: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM playlist_tracks WHERE track_uri = ?')
    .get(trackUri) as { count: number };
  return row.count;
}
