// Pure suggestion-scoring functions per plan.md §4 ("Suggestion score per (track, playlist)").
// No DB access, no ML libs — plain arithmetic so this stays fully unit-testable.

export type FeatureKey =
  | 'valence'
  | 'energy'
  | 'danceability'
  | 'tempo'
  | 'acousticness'
  | 'instrumentalness'
  | 'speechiness'
  | 'loudness';

export type FeatureRanges = Partial<Record<FeatureKey, [number, number]>>;

export interface ScoreRecipe {
  includeTags: string[];
  excludeTags: string[];
  featureRanges: FeatureRanges;
}

export interface ScoreTrack {
  features: Partial<Record<FeatureKey, number>> | null;
  /** Normalized tag names (see normalize-tags.ts) — weight already filtered upstream. */
  tags: string[];
}

/** A playlist needs at least this many songs before its own profile counts as a signal (plan.md). */
const MIN_EXAMPLES_FOR_PROFILE = 10;

// Only features on a comparable 0-1 scale go into the cosine similarity below —
// mixing in tempo (~40-220 BPM) or loudness (~-60-0 dB) unnormalized would let
// those two dominate the vector purely from their larger magnitude.
const BOUNDED_FEATURE_KEYS: FeatureKey[] = [
  'valence',
  'energy',
  'danceability',
  'acousticness',
  'instrumentalness',
  'speechiness',
];

function tagOverlapScore(track: ScoreTrack, recipe: ScoreRecipe): number | null {
  if (recipe.includeTags.length === 0) return null;
  const matched = recipe.includeTags.filter((t) => track.tags.includes(t)).length;
  return matched / recipe.includeTags.length;
}

function featureRangeScore(track: ScoreTrack, recipe: ScoreRecipe): number | null {
  if (!track.features) return null;
  const keys = (Object.keys(recipe.featureRanges) as FeatureKey[]).filter(
    (k) => recipe.featureRanges[k] !== undefined,
  );
  let considered = 0;
  let matched = 0;
  for (const key of keys) {
    const value = track.features[key];
    if (value === undefined) continue;
    const range = recipe.featureRanges[key];
    if (!range) continue;
    considered++;
    if (value >= range[0] && value <= range[1]) matched++;
  }
  return considered === 0 ? null : matched / considered;
}

/** Recipe match: tag overlap + feature-range fit, averaged when both have a signal. */
export function recipeMatchScore(track: ScoreTrack, recipe: ScoreRecipe): number {
  if (recipe.excludeTags.some((t) => track.tags.includes(t))) return 0;

  const tagScore = tagOverlapScore(track, recipe);
  const featureScore = featureRangeScore(track, recipe);
  if (tagScore === null && featureScore === null) return 0;
  if (tagScore === null) return featureScore as number;
  if (featureScore === null) return tagScore;
  return (tagScore + featureScore) / 2;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);
  const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
  const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

/** Cosine similarity between the track's bounded features and the playlist's feature centroid. */
function featureCentroidSimilarity(track: ScoreTrack, examples: ScoreTrack[]): number | null {
  if (!track.features) return null;

  const dims = BOUNDED_FEATURE_KEYS.filter(
    (k) => track.features?.[k] !== undefined && examples.some((e) => e.features?.[k] !== undefined),
  );
  if (dims.length === 0) return null;

  const centroid = dims.map((k) => {
    const values = examples.map((e) => e.features?.[k]).filter((v): v is number => v !== undefined);
    return mean(values);
  });
  const trackVector = dims.map((k) => track.features?.[k] as number);

  return cosineSimilarity(trackVector, centroid);
}

/** Jaccard-ish: how well the track's tags line up with the playlist's own tag frequency. */
function tagProfileSimilarity(track: ScoreTrack, examples: ScoreTrack[]): number | null {
  if (track.tags.length === 0) return null;
  const examplesWithTags = examples.filter((e) => e.tags.length > 0);
  if (examplesWithTags.length === 0) return null;

  const frequency = new Map<string, number>();
  for (const example of examplesWithTags) {
    for (const tag of new Set(example.tags)) {
      frequency.set(tag, (frequency.get(tag) ?? 0) + 1);
    }
  }

  const weights = track.tags.map((tag) => (frequency.get(tag) ?? 0) / examplesWithTags.length);
  return mean(weights);
}

/** "Learn from examples": similarity to the playlist's existing feature/tag profile, once it has enough songs. */
export function exampleProfileScore(track: ScoreTrack, examples: ScoreTrack[]): number | null {
  if (examples.length < MIN_EXAMPLES_FOR_PROFILE) return null;

  const featureSim = featureCentroidSimilarity(track, examples);
  const tagSim = tagProfileSimilarity(track, examples);
  if (featureSim === null && tagSim === null) return null;
  if (featureSim === null) return tagSim as number;
  if (tagSim === null) return featureSim;
  return (featureSim + tagSim) / 2;
}

/**
 * Final suggestion score for (track, playlist), 0-100. Recipe match alone until the
 * playlist has enough songs to also learn from its own profile, then a 50/50 mix.
 * Per plan.md, playlists should show suggestions scoring >= 60.
 */
export function score(
  track: ScoreTrack,
  recipe: ScoreRecipe,
  playlistExamples: ScoreTrack[] = [],
): number {
  const recipeScore = recipeMatchScore(track, recipe);
  const exampleScore = exampleProfileScore(track, playlistExamples);
  const final = exampleScore === null ? recipeScore : (recipeScore + exampleScore) / 2;
  return Math.round(Math.max(0, Math.min(1, final)) * 100);
}
