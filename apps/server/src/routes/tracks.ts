import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getTrackForReview, listTracksForReview } from '../db/enrichment.js';
import {
  assignTrackToPlaylist,
  countPlaylistsForTrack,
  getPlaylistById,
  unassignTrackFromPlaylist,
} from '../db/playlists.js';
import {
  getTrack,
  recomputeStatusFromAssignments,
  setTrackStatus,
  skipTrack,
} from '../db/tracks.js';
import { suggestPlaylistsForTrack } from '../enrich/suggest.js';
import { getValidAccessToken } from '../spotify/auth.js';
import { playTrack } from '../spotify/client.js';
import { SpotifyAuthError, SpotifyHttpError } from '../spotify/errors.js';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(5000).default(1000),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().min(1).optional(),
  status: z.enum(['inbox', 'organized', 'skipped']).optional(),
});

const assignBodySchema = z.object({ playlistId: z.number().int().positive() });

const statusBodySchema = z.object({ status: z.enum(['inbox', 'organized', 'skipped']) });

const bulkBodySchema = z.object({
  uris: z.array(z.string()).min(1),
  playlistId: z.number().int().positive(),
});

function requireTrack(uri: string) {
  return getTrack(uri);
}

/**
 * Read/write endpoints for browsing and organizing tracks — assign/unassign to a
 * sub-playlist, set triage status, bulk-assign a selection, and per-track playlist
 * suggestions for triage mode. See plan.md's Phase 4 checklist.
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
      status: query.data.status,
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

  app.get('/api/tracks/:uri/suggestions', async (req, reply) => {
    const { uri } = req.params as { uri: string };
    if (!requireTrack(uri)) {
      return reply.code(404).send({ error: 'track_not_found' });
    }
    return suggestPlaylistsForTrack(uri);
  });

  app.post('/api/tracks/:uri/assign', async (req, reply) => {
    const { uri } = req.params as { uri: string };
    if (!requireTrack(uri)) {
      return reply.code(404).send({ error: 'track_not_found' });
    }
    const body = assignBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', details: body.error.issues });
    }
    if (!getPlaylistById(body.data.playlistId)) {
      return reply.code(404).send({ error: 'playlist_not_found' });
    }

    assignTrackToPlaylist(body.data.playlistId, uri);
    recomputeStatusFromAssignments(uri, countPlaylistsForTrack(uri) > 0);
    return reply.code(204).send();
  });

  app.post('/api/tracks/:uri/unassign', async (req, reply) => {
    const { uri } = req.params as { uri: string };
    if (!requireTrack(uri)) {
      return reply.code(404).send({ error: 'track_not_found' });
    }
    const body = assignBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', details: body.error.issues });
    }

    unassignTrackFromPlaylist(body.data.playlistId, uri);
    recomputeStatusFromAssignments(uri, countPlaylistsForTrack(uri) > 0);
    return reply.code(204).send();
  });

  app.post('/api/tracks/:uri/status', async (req, reply) => {
    const { uri } = req.params as { uri: string };
    if (!requireTrack(uri)) {
      return reply.code(404).send({ error: 'track_not_found' });
    }
    const body = statusBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', details: body.error.issues });
    }

    if (body.data.status === 'skipped') {
      const removedFromPlaylistIds = skipTrack(uri);
      return { removedFromPlaylistIds };
    }
    setTrackStatus(uri, body.data.status);
    return reply.code(204).send();
  });

  app.post('/api/tracks/bulk/assign', async (req, reply) => {
    const body = bulkBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', details: body.error.issues });
    }
    if (!getPlaylistById(body.data.playlistId)) {
      return reply.code(404).send({ error: 'playlist_not_found' });
    }

    for (const uri of body.data.uris) {
      if (!requireTrack(uri)) continue;
      assignTrackToPlaylist(body.data.playlistId, uri);
      recomputeStatusFromAssignments(uri, countPlaylistsForTrack(uri) > 0);
    }
    return reply.code(204).send();
  });

  // Optional per plan.md — no in-app player, just hand off to the user's active
  // Spotify device. No active device (or no Premium) is not an app error.
  app.post('/api/tracks/:uri/play', async (req, reply) => {
    const { uri } = req.params as { uri: string };
    if (!requireTrack(uri)) {
      return reply.code(404).send({ error: 'track_not_found' });
    }

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
      await playTrack(accessToken, uri);
    } catch (err) {
      if (err instanceof SpotifyHttpError) {
        return reply.code(err.status).send({ error: 'playback_failed', message: err.message });
      }
      throw err;
    }
    return reply.code(204).send();
  });

  app.post('/api/tracks/bulk/unassign', async (req, reply) => {
    const body = bulkBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', details: body.error.issues });
    }

    for (const uri of body.data.uris) {
      if (!requireTrack(uri)) continue;
      unassignTrackFromPlaylist(body.data.playlistId, uri);
      recomputeStatusFromAssignments(uri, countPlaylistsForTrack(uri) > 0);
    }
    return reply.code(204).send();
  });
}
