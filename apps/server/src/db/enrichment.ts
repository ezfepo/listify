import { db } from './index.js';
import './schema.js';
import type { EnrichmentOutcome, TrackFeatures, TrackTag } from '../enrich/types.js';

export interface EnrichableTrackRow {
  uri: string;
  name: string;
  artists: string;
  isrc: string | null;
}

/**
 * Tracks with no `enrichment_status` row for this source yet, plus ones whose last
 * attempt errored (retried) — 'not_found'/'ok' are left alone per plan.md §4.
 */
export function getTracksPendingEnrichment(source: string): EnrichableTrackRow[] {
  return db
    .prepare(
      `SELECT t.uri, t.name, t.artists, t.isrc
       FROM tracks t
       LEFT JOIN enrichment_status es ON es.track_uri = t.uri AND es.source = ?
       WHERE es.track_uri IS NULL OR es.status = 'error'`,
    )
    .all(source) as unknown as EnrichableTrackRow[];
}

export function setEnrichmentStatus(
  trackUri: string,
  source: string,
  status: EnrichmentOutcome,
): void {
  db.prepare(
    `INSERT INTO enrichment_status (track_uri, source, status, ts) VALUES (?, ?, ?, ?)
     ON CONFLICT(track_uri, source) DO UPDATE SET status = excluded.status, ts = excluded.ts`,
  ).run(trackUri, source, status, new Date().toISOString());
}

/** track_features has one row per track (no `source` dimension in its primary key) — the latest provider to enrich a track wins. */
export function upsertTrackFeatures(
  trackUri: string,
  source: string,
  features: TrackFeatures,
): void {
  db.prepare(
    `INSERT INTO track_features
       (track_uri, source, valence, energy, danceability, tempo, acousticness, instrumentalness, speechiness, loudness, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(track_uri) DO UPDATE SET
       source = excluded.source, valence = excluded.valence, energy = excluded.energy,
       danceability = excluded.danceability, tempo = excluded.tempo, acousticness = excluded.acousticness,
       instrumentalness = excluded.instrumentalness, speechiness = excluded.speechiness,
       loudness = excluded.loudness, fetched_at = excluded.fetched_at`,
  ).run(
    trackUri,
    source,
    features.valence ?? null,
    features.energy ?? null,
    features.danceability ?? null,
    features.tempo ?? null,
    features.acousticness ?? null,
    features.instrumentalness ?? null,
    features.speechiness ?? null,
    features.loudness ?? null,
    new Date().toISOString(),
  );
}

/** Replaces all of this source's tags for a track (a fresh fetch supersedes the old set). */
export function replaceTrackTags(trackUri: string, source: string, tags: TrackTag[]): void {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM track_tags WHERE track_uri = ? AND source = ?').run(trackUri, source);
    const insert = db.prepare(
      'INSERT INTO track_tags (track_uri, tag, weight, source) VALUES (?, ?, ?, ?)',
    );
    for (const t of tags) {
      insert.run(trackUri, t.tag, t.weight, source);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export interface CoverageBySource {
  source: string;
  ok: number;
  notFound: number;
  error: number;
  pending: number;
}

/** Coverage report for the Phase 3b checkpoint: % of tracks with features/tags per source. */
export function getEnrichmentCoverage(): CoverageBySource[] {
  const totalRow = db.prepare('SELECT COUNT(*) AS count FROM tracks').get() as { count: number };
  const total = totalRow.count;

  const rows = db
    .prepare(
      `SELECT source,
              SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok,
              SUM(CASE WHEN status = 'not_found' THEN 1 ELSE 0 END) AS not_found,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error
       FROM enrichment_status
       GROUP BY source`,
    )
    .all() as { source: string; ok: number; not_found: number; error: number }[];

  return rows.map((r) => ({
    source: r.source,
    ok: r.ok,
    notFound: r.not_found,
    error: r.error,
    pending: total - r.ok - r.not_found - r.error,
  }));
}
