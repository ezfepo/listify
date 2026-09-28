import { z } from 'zod';
import type { EnrichProvider, EnrichResult, EnrichableTrack } from './types.js';

// Verified against https://reccobeats.com/docs (Sept 2026): free, no API key.
// Flow is Spotify ID -> ReccoBeats track UUID -> audio features, two batch-shaped
// GET endpoints that both accept a CSV `ids` query param and wrap results in
// `content` (confirmed for /v1/audio-features's documented sample response; /v1/track
// follows the same "get multiple X" convention per their request/response docs).
const API_BASE = 'https://api.reccobeats.com/v1';
const MAX_429_RETRIES = 3;

const reccoTrackSchema = z
  .object({
    id: z.string(),
    href: z.string().optional(),
  })
  .passthrough();

const reccoTrackBatchSchema = z.object({ content: z.array(reccoTrackSchema) });

const reccoAudioFeaturesSchema = z
  .object({
    id: z.string(),
    acousticness: z.number().optional(),
    danceability: z.number().optional(),
    energy: z.number().optional(),
    instrumentalness: z.number().optional(),
    loudness: z.number().optional(),
    speechiness: z.number().optional(),
    tempo: z.number().optional(),
    valence: z.number().optional(),
  })
  .passthrough();

const reccoAudioFeaturesBatchSchema = z.object({ content: z.array(reccoAudioFeaturesSchema) });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reccoGet(url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });

    if (res.status === 429) {
      if (attempt >= MAX_429_RETRIES) {
        throw new Error(`ReccoBeats rate limit retries exhausted for ${url}`);
      }
      const retryAfter = Math.max(1, Number(res.headers.get('retry-after') ?? '1'));
      await sleep(retryAfter * 1000);
      continue;
    }

    if (res.status === 404) return null;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ReccoBeats API ${url} returned ${res.status}: ${text}`);
    }

    return res.json();
  }
}

function spotifyIdFromUri(uri: string): string | null {
  // spotify:track:<id> — local tracks (spotify:local:...) have no resolvable ID.
  const match = /^spotify:track:([A-Za-z0-9]+)$/.exec(uri);
  return match?.[1] ?? null;
}

/**
 * ReccoBeats: Spotify-shaped audio features (valence, energy, danceability, ...),
 * looked up by Spotify track ID. Coverage isn't 100% — see plan.md's Phase 3b
 * checkpoint on what to do if it's too low.
 */
export const reccobeatsProvider: EnrichProvider = {
  name: 'reccobeats',

  isConfigured(): boolean {
    return true; // No API key required.
  },

  async enrich(track: EnrichableTrack): Promise<EnrichResult | null> {
    const spotifyId = spotifyIdFromUri(track.uri);
    if (!spotifyId) return null;

    const trackBody = await reccoGet(`${API_BASE}/track?ids=${encodeURIComponent(spotifyId)}`);
    if (!trackBody) return null;
    const trackBatch = reccoTrackBatchSchema.safeParse(trackBody);
    const reccoTrack = trackBatch.success ? trackBatch.data.content[0] : undefined;
    if (!reccoTrack) return null;

    const featuresBody = await reccoGet(
      `${API_BASE}/audio-features?ids=${encodeURIComponent(reccoTrack.id)}`,
    );
    if (!featuresBody) return null;
    const featuresBatch = reccoAudioFeaturesBatchSchema.safeParse(featuresBody);
    const features = featuresBatch.success ? featuresBatch.data.content[0] : undefined;
    if (!features) return null;

    return {
      features: {
        valence: features.valence,
        energy: features.energy,
        danceability: features.danceability,
        tempo: features.tempo,
        acousticness: features.acousticness,
        instrumentalness: features.instrumentalness,
        speechiness: features.speechiness,
        loudness: features.loudness,
      },
    };
  },
};
