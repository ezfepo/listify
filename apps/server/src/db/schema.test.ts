import { describe, expect, it } from 'vitest';
import { db } from './index.js';
import './schema.js';

function tableNames(): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
    name: string;
  }[];
  return rows.map((r) => r.name);
}

describe('schema', () => {
  it('creates every table from the data model', () => {
    expect(tableNames()).toEqual(
      expect.arrayContaining([
        'settings',
        'tracks',
        'playlists',
        'playlist_tracks',
        'track_features',
        'track_tags',
        'playlist_recipes',
        'enrichment_status',
        'operations',
      ]),
    );
  });

  it('is idempotent: re-running the schema on boot does not fail or drop data', async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('keep', 'me')").run();
    // A fresh module instance re-executes the CREATE TABLE IF NOT EXISTS statements.
    const freshInstance = './schema.js?again';
    await import(/* @vite-ignore */ freshInstance);
    expect(db.prepare("SELECT value FROM settings WHERE key = 'keep'").get()).toEqual({
      value: 'me',
    });
    db.exec("DELETE FROM settings WHERE key = 'keep'");
  });

  it('has the isrc column on tracks (added by migration)', () => {
    const columns = db.prepare("SELECT name FROM pragma_table_info('tracks')").all() as {
      name: string;
    }[];
    expect(columns.map((c) => c.name)).toContain('isrc');
  });

  it('enforces foreign keys', () => {
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(() =>
      db
        .prepare(
          "INSERT INTO playlist_tracks (playlist_id, track_uri, assigned_at) VALUES (999, 'nope', 'now')",
        )
        .run(),
    ).toThrow();
  });

  it('restricts playlist kind to main / archive / sub', () => {
    expect(() =>
      db.prepare("INSERT INTO playlists (name, kind) VALUES ('x', 'weird')").run(),
    ).toThrow();
  });

  it('restricts enrichment status values', () => {
    db.prepare(
      "INSERT INTO tracks (uri, name, artists, first_seen_at) VALUES ('t', 'n', 'a', 'now')",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO enrichment_status (track_uri, source, status, ts) VALUES ('t', 's', 'maybe', 'now')",
        )
        .run(),
    ).toThrow();
    db.exec("DELETE FROM tracks WHERE uri = 't'");
  });
});
