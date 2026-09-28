import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './index.js';
import {
  getTrackForReview,
  listTracksForReview,
  replaceTrackTags,
  setEnrichmentStatus,
  upsertTrackFeatures,
} from './enrichment.js';
import { upsertTrack } from './tracks.js';

function track(uri: string, name: string, artists = 'Artist') {
  return {
    uri,
    name,
    artists,
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
    'DELETE FROM enrichment_status; DELETE FROM track_features; DELETE FROM track_tags; DELETE FROM tracks;',
  );
});

describe('getTrackForReview', () => {
  it('returns undefined for a track that does not exist', () => {
    expect(getTrackForReview('spotify:track:missing')).toBeUndefined();
  });

  it('assembles the track row with its features, tags, and enrichment status', () => {
    upsertTrack(track('spotify:track:1', 'Believe', 'Cher'), 'inbox');
    upsertTrackFeatures('spotify:track:1', 'reccobeats', { valence: 0.5, energy: 0.6 });
    replaceTrackTags('spotify:track:1', 'lastfm', [
      { tag: 'pop', weight: 90 },
      { tag: 'dance', weight: 70 },
    ]);
    setEnrichmentStatus('spotify:track:1', 'reccobeats', 'ok');
    setEnrichmentStatus('spotify:track:1', 'lastfm', 'ok');

    const view = getTrackForReview('spotify:track:1');

    expect(view?.name).toBe('Believe');
    expect(view?.features).toMatchObject({ valence: 0.5, energy: 0.6 });
    expect(view?.tags).toEqual([
      { tag: 'pop', weight: 90, source: 'lastfm' },
      { tag: 'dance', weight: 70, source: 'lastfm' },
    ]);
    expect(view?.enrichment).toEqual([
      { source: 'lastfm', status: 'ok', ts: expect.any(String) },
      { source: 'reccobeats', status: 'ok', ts: expect.any(String) },
    ]);
  });

  it('returns null features and empty arrays for a track with no enrichment yet', () => {
    upsertTrack(track('spotify:track:2', 'Unenriched'), 'inbox');
    const view = getTrackForReview('spotify:track:2');
    expect(view?.features).toBeNull();
    expect(view?.tags).toEqual([]);
    expect(view?.enrichment).toEqual([]);
  });
});

describe('listTracksForReview', () => {
  it('paginates and reports the total independent of the page size', () => {
    for (let i = 0; i < 5; i++) {
      upsertTrack(track(`spotify:track:${i}`, `Song ${i}`), 'inbox');
    }

    const page = listTracksForReview({ limit: 2, offset: 0 });
    expect(page.total).toBe(5);
    expect(page.items).toHaveLength(2);
  });

  it('filters by a case-insensitive substring match on name or artists', () => {
    upsertTrack(track('spotify:track:1', 'Believe', 'Cher'), 'inbox');
    upsertTrack(track('spotify:track:2', 'Yesterday', 'The Beatles'), 'inbox');

    const byName = listTracksForReview({ limit: 50, offset: 0, search: 'believe' });
    expect(byName.items.map((t) => t.uri)).toEqual(['spotify:track:1']);

    const byArtist = listTracksForReview({ limit: 50, offset: 0, search: 'beatles' });
    expect(byArtist.items.map((t) => t.uri)).toEqual(['spotify:track:2']);
  });
});
