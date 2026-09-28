import type { FastifyInstance } from 'fastify';
import { getEnrichmentCoverage } from '../db/enrichment.js';
import { isEnrichmentRunning, triggerEnrichment } from '../enrich/queue.js';

export async function enrichRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/enrich/status', async () => {
    return {
      running: isEnrichmentRunning(),
      coverage: getEnrichmentCoverage(),
    };
  });

  // Mainly for retrying after fixing config (e.g. adding LASTFM_API_KEY) without a full re-pull.
  app.post('/api/enrich/run', async (_req, reply) => {
    triggerEnrichment((err) => app.log.error(err, 'enrichment queue failed'));
    return reply.code(202).send({ status: 'started' });
  });
}
