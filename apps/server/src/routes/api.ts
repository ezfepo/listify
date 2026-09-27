import type { FastifyInstance } from 'fastify';
import { getValidAccessToken } from '../spotify/auth.js';
import { getMe } from '../spotify/client.js';
import { SpotifyAuthError, SpotifyHttpError } from '../spotify/errors.js';

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

    try {
      const profile = await getMe(accessToken);
      return { id: profile.id, displayName: profile.display_name };
    } catch (err) {
      if (err instanceof SpotifyHttpError) {
        if (err.status === 401) {
          return reply.code(401).send({ error: 'reconnect_required' });
        }
        app.log.error(err.message);
        return reply.code(502).send({ error: 'spotify_error' });
      }
      throw err;
    }
  });
}
