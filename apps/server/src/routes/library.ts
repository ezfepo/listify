import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createSubPlaylist,
  deleteSubPlaylist,
  getPlaylistById,
  listPlaylistsWithCounts,
  updateSubPlaylist,
} from '../db/playlists.js';
import { getStatusCounts } from '../db/tracks.js';
import { suggestTracksForPlaylist } from '../enrich/suggest.js';

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

const createBodySchema = z.object({
  name: z.string().trim().min(1),
  criteriaNote: z.string().trim().optional(),
  emoji: z.string().trim().optional(),
  color: z.string().trim().optional(),
});

const updateBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  criteriaNote: z.string().trim().nullable().optional(),
  emoji: z.string().trim().nullable().optional(),
  color: z.string().trim().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const suggestQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});

/**
 * The organizer's local library: playlists (main/archive/sub, each with its
 * current track count) plus the Inbox/Organized/Skipped counts for the left
 * pane — all local-only (see plan.md's "playlist CRUD (local only)"). Nothing
 * here touches Spotify; that happens on Apply (Phase 5/6).
 */
export async function libraryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/library', async () => {
    return {
      playlists: listPlaylistsWithCounts(),
      statusCounts: getStatusCounts(),
    };
  });

  app.post('/api/playlists', async (req, reply) => {
    const body = createBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', details: body.error.issues });
    }
    return reply.code(201).send(createSubPlaylist(body.data));
  });

  app.patch('/api/playlists/:id', async (req, reply) => {
    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_params' });
    }
    const playlist = getPlaylistById(params.data.id);
    if (!playlist) {
      return reply.code(404).send({ error: 'playlist_not_found' });
    }
    if (playlist.kind !== 'sub') {
      return reply
        .code(400)
        .send({ error: 'not_editable', message: 'Only sub-playlists can be edited here.' });
    }

    const body = updateBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', details: body.error.issues });
    }

    updateSubPlaylist(params.data.id, body.data);
    return reply.code(204).send();
  });

  app.delete('/api/playlists/:id', async (req, reply) => {
    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_params' });
    }
    const playlist = getPlaylistById(params.data.id);
    if (!playlist) {
      return reply.code(404).send({ error: 'playlist_not_found' });
    }
    if (playlist.kind !== 'sub') {
      return reply
        .code(400)
        .send({ error: 'not_deletable', message: 'Only sub-playlists can be deleted.' });
    }

    deleteSubPlaylist(params.data.id);
    return reply.code(204).send();
  });

  app.get('/api/playlists/:id/suggestions', async (req, reply) => {
    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_params' });
    }
    if (!getPlaylistById(params.data.id)) {
      return reply.code(404).send({ error: 'playlist_not_found' });
    }
    const query = suggestQuerySchema.safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid_query', details: query.error.issues });
    }

    return suggestTracksForPlaylist(params.data.id, query.data.limit);
  });
}
