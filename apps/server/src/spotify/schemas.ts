import { z } from 'zod';

export const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  scope: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
});

export type SpotifyTokenResponse = z.infer<typeof tokenResponseSchema>;

export const meProfileSchema = z.object({
  id: z.string(),
  display_name: z.string().nullable(),
});

export type SpotifyMeProfile = z.infer<typeof meProfileSchema>;

// href/limit/offset/previous are omitted when a request's `fields` param doesn't ask for
// them (we do this for playlist items, to keep the response lean), so only next/total/items
// are guaranteed.
function pagedSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    href: z.string().optional(),
    limit: z.number().optional(),
    next: z.string().nullable(),
    offset: z.number().optional(),
    previous: z.string().nullable().optional(),
    total: z.number(),
    items: z.array(itemSchema),
  });
}

const simplifiedPlaylistSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    owner: z.object({ id: z.string(), display_name: z.string().nullable() }),
    // `items.total` replaced the deprecated `tracks.total` post Feb-2026; accept either.
    items: z.object({ total: z.number() }).optional(),
    tracks: z.object({ total: z.number() }).optional(),
  })
  .passthrough();

export type SpotifySimplifiedPlaylist = z.infer<typeof simplifiedPlaylistSchema>;

export const playlistsPageSchema = pagedSchema(simplifiedPlaylistSchema);

const externalIdsSchema = z.object({ isrc: z.string().optional() }).passthrough();

const playlistItemTrackSchema = z
  .object({
    type: z.enum(['track', 'episode']),
    uri: z.string(),
    id: z.string().nullable(),
    name: z.string(),
    duration_ms: z.number().optional(),
    is_local: z.boolean().optional().default(false),
    artists: z.array(z.object({ name: z.string() })).optional(),
    album: z
      .object({
        name: z.string().optional(),
        images: z.array(z.object({ url: z.string() })).optional(),
      })
      .optional(),
    external_ids: externalIdsSchema.optional(),
  })
  .passthrough();

const playlistItemEntrySchema = z
  .object({
    added_at: z.string().nullable(),
    is_local: z.boolean(),
    // Renamed from `track` post Feb-2026: playlist.items.items[].item (was .track).
    item: playlistItemTrackSchema.nullable(),
  })
  .passthrough();

export type SpotifyPlaylistItemEntry = z.infer<typeof playlistItemEntrySchema>;

export const playlistItemsPageSchema = pagedSchema(playlistItemEntrySchema);

// GET /me/tracks ("Liked Songs"): a different endpoint family from playlist items,
// with its own shape — the track lives under `track`, not `item`, there's no
// top-level `is_local` (only nested), and there's no `type` discriminant since this
// endpoint never returns episodes (those have their own "saved episodes" endpoint).
const savedTrackObjectSchema = z
  .object({
    uri: z.string(),
    id: z.string().nullable(),
    name: z.string(),
    duration_ms: z.number().optional(),
    is_local: z.boolean().optional().default(false),
    artists: z.array(z.object({ name: z.string() })).optional(),
    album: z
      .object({
        name: z.string().optional(),
        images: z.array(z.object({ url: z.string() })).optional(),
      })
      .optional(),
    external_ids: externalIdsSchema.optional(),
  })
  .passthrough();

const savedTrackEntrySchema = z
  .object({
    added_at: z.string(),
    track: savedTrackObjectSchema.nullable(),
  })
  .passthrough();

export type SpotifySavedTrackEntry = z.infer<typeof savedTrackEntrySchema>;

export const savedTracksPageSchema = pagedSchema(savedTrackEntrySchema);
