import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getTrackForReview, listTracksForReview } from '../db/enrichment.js';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().min(1).optional(),
});

/**
 * Read-only endpoints for browsing tracks with their enrichment data attached —
 * this is how the Phase 3b checkpoint (coverage review + spot-checking songs) gets
 * done without a UI yet; Phase 4 builds the real track table on top of the same data.
 */
export async function trackRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/tracks', async (req, reply) => {
    const query = listQuerySchema.safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid_query', details: query.error.issues });
    }

    return listTracksForReview({
      limit: query.data.limit,
      offset: query.data.offset,
      search: query.data.q,
    });
  });

  app.get('/api/tracks/:uri', async (req, reply) => {
    // Fastify already URL-decodes route params, so a client sends the URI
    // (e.g. spotify:track:abc123) percent-encoded and it arrives decoded here.
    const { uri } = req.params as { uri: string };
    const track = getTrackForReview(uri);
    if (!track) {
      return reply.code(404).send({ error: 'track_not_found' });
    }
    return track;
  });
}
