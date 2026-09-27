import type { FastifyInstance } from 'fastify';
import { SpotifyAuthError, SpotifyRateLimitError } from '../spotify/errors.js';
import { pull, PullSetupError } from '../sync/pull.js';

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/sync/pull', async (_req, reply) => {
    try {
      return await pull();
    } catch (err) {
      if (err instanceof SpotifyAuthError) {
        return reply.code(401).send({ error: err.reason });
      }
      if (err instanceof PullSetupError) {
        return reply.code(409).send({ error: 'setup_required', message: err.message });
      }
      if (err instanceof SpotifyRateLimitError) {
        return reply.code(503).send({ error: 'rate_limited', message: err.message });
      }
      throw err;
    }
  });
}
