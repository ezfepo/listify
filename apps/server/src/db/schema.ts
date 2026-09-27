import { db } from './index.js';

// Idempotent: safe to run on every boot. Mirrors the data model in plan.md §4.
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tracks (
    uri TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    artists TEXT NOT NULL,
    album TEXT,
    image_url TEXT,
    duration_ms INTEGER,
    added_at TEXT,
    first_seen_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox', 'organized', 'skipped')),
    in_main INTEGER NOT NULL DEFAULT 0,
    in_archive INTEGER NOT NULL DEFAULT 0,
    is_local INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spotify_id TEXT UNIQUE,
    name TEXT NOT NULL,
    criteria_note TEXT,
    emoji TEXT,
    color TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('main', 'archive', 'sub')),
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_uri TEXT NOT NULL REFERENCES tracks(uri) ON DELETE CASCADE,
    assigned_at TEXT NOT NULL,
    PRIMARY KEY (playlist_id, track_uri)
  );

  CREATE TABLE IF NOT EXISTS track_features (
    track_uri TEXT PRIMARY KEY REFERENCES tracks(uri) ON DELETE CASCADE,
    source TEXT NOT NULL,
    valence REAL,
    energy REAL,
    danceability REAL,
    tempo REAL,
    acousticness REAL,
    instrumentalness REAL,
    speechiness REAL,
    loudness REAL,
    fetched_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS track_tags (
    track_uri TEXT NOT NULL REFERENCES tracks(uri) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    weight REAL NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (track_uri, tag, source)
  );

  CREATE TABLE IF NOT EXISTS playlist_recipes (
    playlist_id INTEGER PRIMARY KEY REFERENCES playlists(id) ON DELETE CASCADE,
    include_tags_json TEXT,
    exclude_tags_json TEXT,
    feature_ranges_json TEXT
  );

  CREATE TABLE IF NOT EXISTS enrichment_status (
    track_uri TEXT NOT NULL REFERENCES tracks(uri) ON DELETE CASCADE,
    source TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok', 'not_found', 'error')),
    ts TEXT NOT NULL,
    PRIMARY KEY (track_uri, source)
  );

  CREATE TABLE IF NOT EXISTS operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT,
    status TEXT NOT NULL,
    error TEXT
  );
`);
