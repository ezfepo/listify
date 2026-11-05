import type { FastifyInstance } from 'fastify';
import { triggerEnrichment } from '../enrich/queue.js';
import { SpotifyAuthError, SpotifyRateLimitError } from '../spotify/errors.js';
import { apply, ApplySetupError, previewDiff } from '../sync/apply.js';
import { pull, PullSetupError } from '../sync/pull.js';

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/sync/pull', async (_req, reply) => {
    try {
      const summary = await pull();
      // Fire-and-forget: enrichment runs in the background and must never delay this response.
      triggerEnrichment((err) => app.log.error(err, 'enrichment queue failed'));
      return summary;
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

  // Read-only: what apply() would do. Backs the Diff Preview modal.
  app.get('/api/sync/diff', async (_req, reply) => {
    try {
      return await previewDiff();
    } catch (err) {
      if (err instanceof SpotifyAuthError) {
        return reply.code(401).send({ error: err.reason });
      }
      if (err instanceof ApplySetupError) {
        return reply.code(409).send({ error: 'setup_required', message: err.message });
      }
      if (err instanceof SpotifyRateLimitError) {
        return reply.code(503).send({ error: 'rate_limited', message: err.message });
      }
      throw err;
    }
  });

  app.post('/api/sync/apply', async (_req, reply) => {
    try {
      return await apply();
    } catch (err) {
      if (err instanceof SpotifyAuthError) {
        return reply.code(401).send({ error: err.reason });
      }
      if (err instanceof ApplySetupError) {
        return reply.code(409).send({ error: 'setup_required', message: err.message });
      }
      if (err instanceof SpotifyRateLimitError) {
        return reply.code(503).send({ error: 'rate_limited', message: err.message });
      }
      throw err;
    }
  });
}
