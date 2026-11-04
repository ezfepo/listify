import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './index.js';
import { createSubPlaylist, deleteSubPlaylist } from './playlists.js';
import { deleteRecipe, getRecipe, upsertRecipe } from './recipes.js';

beforeEach(() => {
  db.exec('DELETE FROM playlist_recipes; DELETE FROM playlists;');
});

describe('recipes', () => {
  it('returns undefined when a playlist has no recipe', () => {
    const playlist = createSubPlaylist({ name: 'Focus' });
    expect(getRecipe(playlist.id)).toBeUndefined();
  });

  it('round-trips tags and feature ranges', () => {
    const playlist = createSubPlaylist({ name: 'Focus' });
    const recipe = {
      includeTags: ['ambient', 'instrumental'],
      excludeTags: ['vocal'],
      featureRanges: { energy: [0, 0.4] as [number, number], tempo: [60, 110] as [number, number] },
    };

    expect(upsertRecipe(playlist.id, recipe)).toEqual({ playlistId: playlist.id, ...recipe });
    expect(getRecipe(playlist.id)).toEqual({ playlistId: playlist.id, ...recipe });
  });

  it('upserts: a second write replaces the first, leaving a single row', () => {
    const playlist = createSubPlaylist({ name: 'Focus' });
    upsertRecipe(playlist.id, { includeTags: ['a'], excludeTags: [], featureRanges: {} });
    upsertRecipe(playlist.id, { includeTags: ['b'], excludeTags: ['c'], featureRanges: {} });

    expect(getRecipe(playlist.id)?.includeTags).toEqual(['b']);
    expect(getRecipe(playlist.id)?.excludeTags).toEqual(['c']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM playlist_recipes').get()).toEqual({ n: 1 });
  });

  it('treats NULL JSON columns as empty defaults', () => {
    const playlist = createSubPlaylist({ name: 'Focus' });
    db.prepare('INSERT INTO playlist_recipes (playlist_id) VALUES (?)').run(playlist.id);

    expect(getRecipe(playlist.id)).toEqual({
      playlistId: playlist.id,
      includeTags: [],
      excludeTags: [],
      featureRanges: {},
    });
  });

  it('deleteRecipe removes it, and is a no-op when there is none', () => {
    const playlist = createSubPlaylist({ name: 'Focus' });
    upsertRecipe(playlist.id, { includeTags: ['a'], excludeTags: [], featureRanges: {} });
    deleteRecipe(playlist.id);
    expect(getRecipe(playlist.id)).toBeUndefined();
    expect(() => deleteRecipe(playlist.id)).not.toThrow();
  });

  it('is removed with its playlist (ON DELETE CASCADE)', () => {
    const playlist = createSubPlaylist({ name: 'Focus' });
    upsertRecipe(playlist.id, { includeTags: ['a'], excludeTags: [], featureRanges: {} });
    deleteSubPlaylist(playlist.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM playlist_recipes').get()).toEqual({ n: 0 });
  });
});
