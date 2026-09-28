export interface EnrichableTrack {
  uri: string;
  name: string;
  /** Comma-joined artist names, as stored on `tracks.artists` (see sync/normalize.ts). */
  artists: string;
  isrc: string | null;
}

export interface TrackFeatures {
  valence?: number;
  energy?: number;
  danceability?: number;
  tempo?: number;
  acousticness?: number;
  instrumentalness?: number;
  speechiness?: number;
  loudness?: number;
}

export interface TrackTag {
  tag: string;
  weight: number;
}

export interface EnrichResult {
  features?: TrackFeatures;
  tags?: TrackTag[];
}

export type EnrichmentOutcome = 'ok' | 'not_found' | 'error';

/**
 * One enrichment data source (see plan.md §4 "Enrichment + suggestions"). Each
 * provider is independent and swappable/droppable — the queue in queue.ts is the
 * only thing that knows about all of them.
 */
export interface EnrichProvider {
  /** Matches the `source` column in track_features/track_tags/enrichment_status. */
  name: string;
  /** False when required config (e.g. an API key) is missing — the queue skips it entirely rather than erroring per track. */
  isConfigured(): boolean;
  /** Returns null when the provider has nothing for this track (recorded as 'not_found', not an error). */
  enrich(track: EnrichableTrack): Promise<EnrichResult | null>;
}
