import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { upsertPlaylist } from '../db/playlists.js';
import { getSetting, setSetting } from '../db/settings.js';
import { getValidAccessToken } from '../spotify/auth.js';
import { getMyPlaylists } from '../spotify/client.js';
import { SpotifyAuthError } from '../spotify/errors.js';

const setupBodySchema = z.object({
  mainSpotifyId: z.string(),
  archiveSpotifyId: z.string(),
  adopt: z.array(z.object({ spotifyId: z.string(), name: z.string() })).default([]),
});

export async function setupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/playlists', async (_req, reply) => {
    let accessToken: string;
    try {
      accessToken = await getValidAccessToken();
    } catch (err) {
      if (err instanceof SpotifyAuthError) {
        return reply.code(401).send({ error: err.reason });
      }
      throw err;
    }

    const playlists = await getMyPlaylists(accessToken);
    return playlists.map((p) => ({
      id: p.id,
      name: p.name,
      ownerId: p.owner.id,
      ownerDisplayName: p.owner.display_name,
      trackCount: p.items?.total ?? p.tracks?.total ?? 0,
    }));
  });

  app.get('/api/setup', async () => {
    return {
      mainSpotifyId: getSetting('main_playlist_spotify_id') ?? null,
      archiveSpotifyId: getSetting('archive_playlist_spotify_id') ?? null,
    };
  });

  app.post('/api/setup', async (req, reply) => {
    const body = setupBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', details: body.error.issues });
    }

    const { mainSpotifyId, archiveSpotifyId, adopt } = body.data;
    setSetting('main_playlist_spotify_id', mainSpotifyId);
    setSetting('archive_playlist_spotify_id', archiveSpotifyId);

    for (const playlist of adopt) {
      upsertPlaylist(playlist.spotifyId, playlist.name, 'sub');
    }

    return { status: 'ok' };
  });
}
