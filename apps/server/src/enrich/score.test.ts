import { describe, expect, it } from 'vitest';
import {
  exampleProfileScore,
  recipeMatchScore,
  score,
  type ScoreRecipe,
  type ScoreTrack,
} from './score.js';

const sadRecipe: ScoreRecipe = {
  includeTags: ['sad'],
  excludeTags: [],
  featureRanges: { valence: [0, 0.35], energy: [0, 0.5] },
};

function track(overrides: Partial<ScoreTrack> = {}): ScoreTrack {
  return { features: null, tags: [], ...overrides };
}

describe('recipeMatchScore', () => {
  it('scores 1 when tags and feature ranges both fully match', () => {
    const t = track({ features: { valence: 0.2, energy: 0.3 }, tags: ['sad'] });
    expect(recipeMatchScore(t, sadRecipe)).toBe(1);
  });

  it('scores 0 when an excluded tag is present, regardless of everything else', () => {
    const recipe: ScoreRecipe = { ...sadRecipe, excludeTags: ['party'] };
    const t = track({ features: { valence: 0.2, energy: 0.3 }, tags: ['sad', 'party'] });
    expect(recipeMatchScore(t, recipe)).toBe(0);
  });

  it('averages tag and feature signals when only one partially matches', () => {
    // Feature range matches (1.0), no include tags matched (0/1) -> average 0.5.
    const t = track({ features: { valence: 0.2, energy: 0.3 }, tags: [] });
    expect(recipeMatchScore(t, sadRecipe)).toBe(0.5);
  });

  it('falls back to whichever signal is present when a recipe only sets tags', () => {
    const recipe: ScoreRecipe = {
      includeTags: ['road', 'driving'],
      excludeTags: [],
      featureRanges: {},
    };
    const t = track({ tags: ['road'] });
    expect(recipeMatchScore(t, recipe)).toBe(0.5);
  });

  it('returns 0 for a track with no features and a recipe with only feature ranges', () => {
    const recipe: ScoreRecipe = {
      includeTags: [],
      excludeTags: [],
      featureRanges: { valence: [0, 0.5] },
    };
    expect(recipeMatchScore(track(), recipe)).toBe(0);
  });

  it('ignores a feature range for a dimension the track has no value for', () => {
    const recipe: ScoreRecipe = {
      includeTags: [],
      excludeTags: [],
      featureRanges: { valence: [0, 0.5], tempo: [100, 140] },
    };
    // Only valence is present, and it's in range -> full match on the considered dimension.
    const t = track({ features: { valence: 0.2 } });
    expect(recipeMatchScore(t, recipe)).toBe(1);
  });
});

describe('exampleProfileScore', () => {
  it('returns null when the playlist has fewer than 10 example songs', () => {
    const examples = Array.from({ length: 9 }, () =>
      track({ features: { valence: 0.2 }, tags: ['sad'] }),
    );
    expect(
      exampleProfileScore(track({ features: { valence: 0.2 }, tags: ['sad'] }), examples),
    ).toBeNull();
  });

  it('scores high similarity for a track matching a tight feature centroid', () => {
    const examples = Array.from({ length: 10 }, () =>
      track({ features: { valence: 0.2, energy: 0.3, danceability: 0.4 }, tags: ['sad'] }),
    );
    const similar = track({
      features: { valence: 0.2, energy: 0.3, danceability: 0.4 },
      tags: ['sad'],
    });
    const dissimilar = track({
      features: { valence: 0.9, energy: 0.9, danceability: 0.9 },
      tags: ['party'],
    });

    const similarScore = exampleProfileScore(similar, examples) as number;
    const dissimilarScore = exampleProfileScore(dissimilar, examples) as number;

    expect(similarScore).toBeGreaterThan(dissimilarScore);
    expect(similarScore).toBeCloseTo(1, 5);
  });

  it('returns null when neither the track nor the examples have any comparable signal', () => {
    const examples = Array.from({ length: 10 }, () => track());
    expect(exampleProfileScore(track(), examples)).toBeNull();
  });
});

describe('score', () => {
  it('matches the plan.md "Sad" starter recipe example', () => {
    const perfectMatch = track({ features: { valence: 0.1, energy: 0.2 }, tags: ['sad'] });
    expect(score(perfectMatch, sadRecipe)).toBe(100);

    const noMatch = track({ features: { valence: 0.9, energy: 0.9 }, tags: ['party'] });
    expect(score(noMatch, sadRecipe)).toBe(0);
  });

  it('blends recipe and example scores 50/50 once the playlist has 10+ songs', () => {
    const examples = Array.from({ length: 10 }, () =>
      track({ features: { valence: 0.1, energy: 0.2 }, tags: ['sad'] }),
    );
    // Matches the recipe fully (tags + features) and matches the example profile fully too.
    const t = track({ features: { valence: 0.1, energy: 0.2 }, tags: ['sad'] });
    expect(score(t, sadRecipe, examples)).toBe(100);
  });

  it('clamps to 0-100', () => {
    const t = track({ features: { valence: 0.1, energy: 0.2 }, tags: ['sad'] });
    expect(score(t, sadRecipe)).toBeLessThanOrEqual(100);
    expect(score(track(), sadRecipe)).toBeGreaterThanOrEqual(0);
  });
});
