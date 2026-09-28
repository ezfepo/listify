import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from './index.js';
import './schema.js';
import { getSetting, setSetting } from './settings.js';

// Parent tables first, so import() can insert without violating foreign keys.
// Deliberately excludes `settings` (holds OAuth tokens — see EXPORTABLE_SETTINGS_KEYS
// below) and `operations` (a local audit log, not organizing data worth restoring).
const EXPORTABLE_TABLES = [
  'tracks',
  'playlists',
  'playlist_tracks',
  'track_features',
  'track_tags',
  'playlist_recipes',
  'enrichment_status',
] as const;

type ExportableTable = (typeof EXPORTABLE_TABLES)[number];

// Only these two settings are safe to round-trip — CLAUDE.md: "Secrets stay in
// .env; never commit them or print them to logs." Access/refresh tokens live in
// `settings` too but must never end up in a JSON file on disk.
const EXPORTABLE_SETTINGS_KEYS = [
  'main_playlist_spotify_id',
  'archive_playlist_spotify_id',
] as const;

export interface DatabaseSnapshot {
  version: 1;
  exportedAt: string;
  tables: Record<ExportableTable, Record<string, unknown>[]>;
  settings: Record<string, string>;
}

export function exportDatabaseSnapshot(): DatabaseSnapshot {
  const tables = {} as DatabaseSnapshot['tables'];
  for (const table of EXPORTABLE_TABLES) {
    tables[table] = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
  }

  const settings: Record<string, string> = {};
  for (const key of EXPORTABLE_SETTINGS_KEYS) {
    const value = getSetting(key);
    if (value !== undefined) settings[key] = value;
  }

  return { version: 1, exportedAt: new Date().toISOString(), tables, settings };
}

/** Replaces the whole DB's organizing data with a snapshot's. Never touches OAuth tokens. */
export function importDatabaseSnapshot(snapshot: DatabaseSnapshot): void {
  if (snapshot.version !== 1) {
    throw new Error(`Unsupported snapshot version: ${String(snapshot.version)}`);
  }

  db.exec('BEGIN');
  try {
    for (const table of [...EXPORTABLE_TABLES].reverse()) {
      db.exec(`DELETE FROM ${table}`);
    }
    for (const table of EXPORTABLE_TABLES) {
      const rows = snapshot.tables[table] ?? [];
      const firstRow = rows[0];
      if (!firstRow) continue;
      const columns = Object.keys(firstRow);
      const placeholders = columns.map(() => '?').join(', ');
      const insert = db.prepare(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
      );
      for (const row of rows) {
        insert.run(...columns.map((c) => row[c] as never));
      }
    }
    for (const [key, value] of Object.entries(snapshot.settings ?? {})) {
      if ((EXPORTABLE_SETTINGS_KEYS as readonly string[]).includes(key)) {
        setSetting(key, value);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Step 4.a of apply() (plan.md §4): a timestamped snapshot written before any Spotify write. Returns the file path. */
export function writeBackupSnapshot(backupsDir: string): string {
  mkdirSync(backupsDir, { recursive: true });
  const snapshot = exportDatabaseSnapshot();
  const filename = `backup-${snapshot.exportedAt.replace(/[:.]/g, '-')}.json`;
  const path = join(backupsDir, filename);
  writeFileSync(path, JSON.stringify(snapshot, null, 2));
  return path;
}
