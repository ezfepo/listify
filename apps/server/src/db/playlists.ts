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
