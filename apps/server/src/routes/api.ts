import type { FastifyInstance } from 'fastify';
import { getValidAccessToken } from '../spotify/auth.js';
import { SpotifyAuthError } from '../spotify/errors.js';
import { meProfileSchema } from '../spotify/schemas.js';

export async function apiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    return { status: 'ok' };
  });

  app.get('/api/me', async (_req, reply) => {
    let accessToken: string;
    try {
      accessToken = await getValidAccessToken();
    } catch (err) {
      if (err instanceof SpotifyAuthError) {
        return reply.code(401).send({ error: err.reason });
      }
      throw err;
    }

    const res = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 401) {
      return reply.code(401).send({ error: 'reconnect_required' });
    }
    if (!res.ok) {
      app.log.error(`Spotify /me returned ${res.status}`);
      return reply.code(502).send({ error: 'spotify_error' });
    }

    const profile = meProfileSchema.parse(await res.json());
    return { id: profile.id, displayName: profile.display_name };
  });
}
