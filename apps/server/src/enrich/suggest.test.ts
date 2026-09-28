import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/index.js';
import { replaceTrackTags, upsertTrackFeatures } from '../db/enrichment.js';
import { assignTrackToPlaylist, createSubPlaylist } from '../db/playlists.js';
import { upsertRecipe } from '../db/recipes.js';
import { upsertTrack } from '../db/tracks.js';
import { suggestPlaylistsForTrack, suggestTracksForPlaylist } from './suggest.js';

function track(uri: string, name = 'Song') {
  return {
    uri,
    name,
    artists: 'Artist',
    album: null,
    imageUrl: null,
    durationMs: null,
    addedAt: null,
    isLocal: false,
    isrc: null,
  };
}

beforeEach(() => {
  db.exec(
    'DELETE FROM playlist_tracks; DELETE FROM playlist_recipes; DELETE FROM playlists; DELETE FROM track_tags; DELETE FROM track_features; DELETE FROM tracks;',
  );
});

describe('suggestPlaylistsForTrack', () => {
  it('ranks sub-playlists by fit, highest score first', () => {
    upsertTrack(track('spotify:track:1'), 'inbox');
    upsertTrackFeatures('spotify:track:1', 'reccobeats', { valence: 0.1, energy: 0.2 });
    replaceTrackTags('spotify:track:1', 'lastfm', [{ tag: 'sad', weight: 90 }]);

    const sad = createSubPlaylist({ name: 'Sad' });
    upsertRecipe(sad.id, {
      includeTags: ['sad'],
      excludeTags: [],
      featureRanges: { valence: [0, 0.35], energy: [0, 0.5] },
    });
    const party = createSubPlaylist({ name: 'Party' });
    upsertRecipe(party.id, {
      includeTags: ['party'],
      excludeTags: [],
      featureRanges: { valence: [0.7, 1], energy: [0.7, 1] },
    });

    const suggestions = suggestPlaylistsForTrack('spotify:track:1');

    expect(suggestions[0]?.playlistName).toBe('Sad');
    expect(suggestions[0]?.score).toBe(100);
    expect(suggestions[0]?.reason).toContain('tag: sad');
    expect(suggestions[1]?.playlistName).toBe('Party');
    expect(suggestions[1]?.score).toBe(0);
  });

  it('gives a generic reason when the score comes purely from the playlist profile', () => {
    upsertTrack(track('spotify:track:new'), 'inbox');
    upsertTrackFeatures('spotify:track:new', 'reccobeats', { valence: 0.1, energy: 0.2 });

    const sad = createSubPlaylist({ name: 'Sad' });
    // No recipe at all, so recipeMatchScore is 0 and any signal must come from examples.
    for (let i = 0; i < 10; i++) {
      const uri = `spotify:track:example${i}`;
      upsertTrack(track(uri), 'organized');
      upsertTrackFeatures(uri, 'reccobeats', { valence: 0.1, energy: 0.2 });
      assignTrackToPlaylist(sad.id, uri);
    }

    const suggestions = suggestPlaylistsForTrack('spotify:track:new');
    const sadSuggestion = suggestions.find((s) => s.playlistName === 'Sad');
    expect(sadSuggestion?.score).toBeGreaterThan(0);
    expect(sadSuggestion?.reason).toBe('based on similar songs in this playlist');
  });
});

describe('suggestTracksForPlaylist', () => {
  it('ranks unassigned candidates and excludes already-assigned or zero-scoring tracks', () => {
    const sad = createSubPlaylist({ name: 'Sad' });
    upsertRecipe(sad.id, { includeTags: ['sad'], excludeTags: [], featureRanges: {} });

    upsertTrack(track('spotify:track:1', 'Matches'), 'inbox');
    replaceTrackTags('spotify:track:1', 'lastfm', [{ tag: 'sad', weight: 90 }]);

    upsertTrack(track('spotify:track:2', 'No match'), 'inbox');

    upsertTrack(track('spotify:track:3', 'Already assigned'), 'inbox');
    replaceTrackTags('spotify:track:3', 'lastfm', [{ tag: 'sad', weight: 90 }]);
    assignTrackToPlaylist(sad.id, 'spotify:track:3');

    const suggestions = suggestTracksForPlaylist(sad.id);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.uri).toBe('spotify:track:1');
    expect(suggestions[0]?.score).toBe(100);
  });

  it('respects the limit', () => {
    const sad = createSubPlaylist({ name: 'Sad' });
    upsertRecipe(sad.id, { includeTags: ['sad'], excludeTags: [], featureRanges: {} });

    for (let i = 0; i < 5; i++) {
      const uri = `spotify:track:${i}`;
      upsertTrack(track(uri), 'inbox');
      replaceTrackTags(uri, 'lastfm', [{ tag: 'sad', weight: 90 }]);
    }

    expect(suggestTracksForPlaylist(sad.id, 2)).toHaveLength(2);
  });
});
