import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPlaylistById } from '../db/playlists.js';
import { deleteRecipe, getRecipe, upsertRecipe } from '../db/recipes.js';
import type { FeatureKey } from '../enrich/score.js';

const FEATURE_KEYS: FeatureKey[] = [
  'valence',
  'energy',
  'danceability',
  'tempo',
  'acousticness',
  'instrumentalness',
  'speechiness',
  'loudness',
];

const rangeSchema = z
  .tuple([z.number(), z.number()])
  .refine(([min, max]) => min <= max, { message: 'range min must be <= max' });

const featureRangesSchema = z
  .record(z.string(), rangeSchema)
  .default({})
  .refine((ranges) => Object.keys(ranges).every((k) => (FEATURE_KEYS as string[]).includes(k)), {
    message: `featureRanges keys must be one of: ${FEATURE_KEYS.join(', ')}`,
  });

const recipeBodySchema = z.object({
  includeTags: z.array(z.string()).default([]),
  excludeTags: z.array(z.string()).default([]),
  featureRanges: featureRangesSchema,
});

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

export async function recipeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/playlists/:id/recipe', async (req, reply) => {
    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_params' });
    }
    if (!getPlaylistById(params.data.id)) {
      return reply.code(404).send({ error: 'playlist_not_found' });
    }

    const recipe = getRecipe(params.data.id);
    return (
      recipe ?? { playlistId: params.data.id, includeTags: [], excludeTags: [], featureRanges: {} }
    );
  });

  app.put('/api/playlists/:id/recipe', async (req, reply) => {
    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_params' });
    }
    if (!getPlaylistById(params.data.id)) {
      return reply.code(404).send({ error: 'playlist_not_found' });
    }

    const body = recipeBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', details: body.error.issues });
    }

    return upsertRecipe(params.data.id, body.data);
  });

  app.delete('/api/playlists/:id/recipe', async (req, reply) => {
    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_params' });
    }
    if (!getPlaylistById(params.data.id)) {
      return reply.code(404).send({ error: 'playlist_not_found' });
    }

    deleteRecipe(params.data.id);
    return reply.code(204).send();
  });
}
