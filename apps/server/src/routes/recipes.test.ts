import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/index.js';
import { createSubPlaylist } from '../db/playlists.js';
import { getRecipe } from '../db/recipes.js';
import { recipeRoutes } from './recipes.js';
import { buildTestApp } from './test-app.js';

let app: FastifyInstance;

beforeEach(async () => {
  db.exec('DELETE FROM playlist_recipes; DELETE FROM playlists;');
  app = await buildTestApp(recipeRoutes);
});

afterEach(async () => {
  await app.close();
});

function put(id: number | string, payload: object) {
  return app.inject({ method: 'PUT', url: `/api/playlists/${id}/recipe`, payload });
}

describe('GET /api/playlists/:id/recipe', () => {
  it('returns an empty default recipe when none was saved', async () => {
    const playlist = createSubPlaylist({ name: 'P' });
    const res = await app.inject(`/api/playlists/${playlist.id}/recipe`);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      playlistId: playlist.id,
      includeTags: [],
      excludeTags: [],
      featureRanges: {},
    });
  });

  it('404s for an unknown playlist and 400s for a bad id', async () => {
    expect((await app.inject('/api/playlists/999/recipe')).statusCode).toBe(404);
    expect((await app.inject('/api/playlists/nope/recipe')).statusCode).toBe(400);
  });
});

describe('PUT /api/playlists/:id/recipe', () => {
  it('saves and returns the recipe', async () => {
    const playlist = createSubPlaylist({ name: 'P' });
    const recipe = {
      includeTags: ['chill'],
      excludeTags: ['metal'],
      featureRanges: { energy: [0, 0.5] },
    };

    const res = await put(playlist.id, recipe);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ playlistId: playlist.id, ...recipe });
    expect(getRecipe(playlist.id)).toMatchObject(recipe);
  });

  it('fills in defaults for omitted fields', async () => {
    const playlist = createSubPlaylist({ name: 'P' });
    const res = await put(playlist.id, {});
    expect(res.json()).toEqual({
      playlistId: playlist.id,
      includeTags: [],
      excludeTags: [],
      featureRanges: {},
    });
  });

  it('rejects a range whose min is greater than its max', async () => {
    const playlist = createSubPlaylist({ name: 'P' });
    const res = await put(playlist.id, { featureRanges: { energy: [0.9, 0.1] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_body');
  });

  it('rejects an unknown feature key', async () => {
    const playlist = createSubPlaylist({ name: 'P' });
    const res = await put(playlist.id, { featureRanges: { loudnessy: [0, 1] } });
    expect(res.statusCode).toBe(400);
  });

  it('accepts every supported feature key', async () => {
    const playlist = createSubPlaylist({ name: 'P' });
    const keys = [
      'valence',
      'energy',
      'danceability',
      'tempo',
      'acousticness',
      'instrumentalness',
      'speechiness',
      'loudness',
    ];
    const featureRanges = Object.fromEntries(keys.map((k) => [k, [0, 1]]));
    expect((await put(playlist.id, { featureRanges })).statusCode).toBe(200);
  });

  it('rejects non-string tags and malformed ranges', async () => {
    const playlist = createSubPlaylist({ name: 'P' });
    expect((await put(playlist.id, { includeTags: [1] })).statusCode).toBe(400);
    expect((await put(playlist.id, { featureRanges: { energy: [0.1] } })).statusCode).toBe(400);
  });

  it('404s for an unknown playlist', async () => {
    expect((await put(999, {})).statusCode).toBe(404);
  });
});

describe('DELETE /api/playlists/:id/recipe', () => {
  it('removes the recipe and answers 204', async () => {
    const playlist = createSubPlaylist({ name: 'P' });
    await put(playlist.id, { includeTags: ['a'] });

    const res = await app.inject({ method: 'DELETE', url: `/api/playlists/${playlist.id}/recipe` });

    expect(res.statusCode).toBe(204);
    expect(getRecipe(playlist.id)).toBeUndefined();
  });

  it('404s for an unknown playlist', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/playlists/999/recipe' });
    expect(res.statusCode).toBe(404);
  });
});
