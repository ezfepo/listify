import { z } from 'zod';
import { config } from '../config.js';
import type { EnrichProvider, EnrichResult, EnrichableTrack } from './types.js';

// Verified against https://www.last.fm/api/show/track.getTopTags and
// artist.getTopTags (Sept 2026): free API key, no auth beyond it. `count` is a
// 0-100 relative weight (not a play count), which we pass straight through as
// our tag weight.
const API_BASE = 'https://ws.audioscrobbler.com/2.0/';

const tagSchema = z.object({
  name: z.string(),
  count: z.coerce.number(),
});

// Last.fm's XML-derived JSON collapses a single-item list to an object instead
// of a one-element array, and an empty list can come back as `""`.
const tagListSchema = z
  .union([z.array(tagSchema), tagSchema, z.literal('')])
  .transform((v) => (v === '' ? [] : Array.isArray(v) ? v : [v]));

const topTagsResponseSchema = z.object({
  toptags: z.object({ tag: tagListSchema.optional().default([]) }),
});

const errorResponseSchema = z.object({ error: z.number(), message: z.string() });

function firstArtist(artists: string): string {
  return artists.split(',')[0]?.trim() ?? '';
}

async function lastfmGet(method: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(API_BASE);
  url.search = new URLSearchParams({
    method,
    api_key: config.lastfmApiKey,
    format: 'json',
    ...params,
  }).toString();

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Last.fm API ${method} returned HTTP ${res.status}`);
  }
  const body = await res.json();

  const error = errorResponseSchema.safeParse(body);
  if (error.success) {
    // Error 6 ("Invalid parameters") is Last.fm's way of saying "no such track/artist".
    if (error.data.error === 6) return null;
    throw new Error(`Last.fm API ${method} error ${error.data.error}: ${error.data.message}`);
  }

  return body;
}

async function getTopTags(
  artist: string,
  track: string,
): Promise<z.infer<typeof tagSchema>[] | null> {
  const trackTags = await lastfmGet('track.gettoptags', { artist, track });
  if (trackTags) {
    const parsed = topTagsResponseSchema.safeParse(trackTags);
    if (parsed.success && parsed.data.toptags.tag.length > 0) {
      return parsed.data.toptags.tag;
    }
  }

  // Fall back to the artist's tags when the track itself has none — still
  // useful signal (genre, era) per plan.md.
  const artistTags = await lastfmGet('artist.gettoptags', { artist });
  if (!artistTags) return null;
  const parsed = topTagsResponseSchema.safeParse(artistTags);
  return parsed.success ? parsed.data.toptags.tag : null;
}

/** Last.fm: crowd tags (mood, genre, decade, etc.) looked up by artist + track name. */
export const lastfmProvider: EnrichProvider = {
  name: 'lastfm',

  isConfigured(): boolean {
    return config.lastfmApiKey.length > 0;
  },

  async enrich(track: EnrichableTrack): Promise<EnrichResult | null> {
    const artist = firstArtist(track.artists);
    if (!artist || !track.name) return null;

    const tags = await getTopTags(artist, track.name);
    if (!tags || tags.length === 0) return null;

    return {
      tags: tags.map((t) => ({ tag: t.name, weight: t.count })),
    };
  },
};
