import { db } from '../db/index.js';
import { listSubPlaylists, type PlaylistRow } from '../db/playlists.js';
import { getRecipe } from '../db/recipes.js';
import { listUnassignedCandidateTracks, type TrackRow } from '../db/tracks.js';
import { score, type FeatureKey, type ScoreRecipe, type ScoreTrack } from './score.js';

const FEATURE_COLUMNS: FeatureKey[] = [
  'valence',
  'energy',
  'danceability',
  'tempo',
  'acousticness',
  'instrumentalness',
  'speechiness',
  'loudness',
];

function loadScoreTrack(uri: string): ScoreTrack {
  const featuresRow = db
    .prepare(`SELECT ${FEATURE_COLUMNS.join(', ')} FROM track_features WHERE track_uri = ?`)
    .get(uri) as Record<FeatureKey, number | null> | undefined;

  const tagRows = db
    .prepare('SELECT DISTINCT tag FROM track_tags WHERE track_uri = ?')
    .all(uri) as {
    tag: string;
  }[];

  let features: ScoreTrack['features'] = null;
  if (featuresRow) {
    features = {};
    for (const key of FEATURE_COLUMNS) {
      const value = featuresRow[key];
      if (value !== null && value !== undefined) features[key] = value;
    }
  }

  return { features, tags: tagRows.map((r) => r.tag) };
}

function loadRecipe(playlistId: number): ScoreRecipe {
  const recipe = getRecipe(playlistId);
  return recipe
    ? {
        includeTags: recipe.includeTags,
        excludeTags: recipe.excludeTags,
        featureRanges: recipe.featureRanges,
      }
    : { includeTags: [], excludeTags: [], featureRanges: {} };
}

function loadPlaylistExamples(playlistId: number): ScoreTrack[] {
  const uris = db
    .prepare('SELECT track_uri FROM playlist_tracks WHERE playlist_id = ?')
    .all(playlistId) as { track_uri: string }[];
  return uris.map((r) => loadScoreTrack(r.track_uri));
}

/** A short human-readable reason for a score, e.g. "valence 0.21 · tag: sad" (plan.md's triage-mode example). */
function explainMatch(track: ScoreTrack, recipe: ScoreRecipe): string {
  const parts: string[] = [];

  const matchedTags = recipe.includeTags.filter((t) => track.tags.includes(t));
  for (const tag of matchedTags) parts.push(`tag: ${tag}`);

  for (const key of Object.keys(recipe.featureRanges) as FeatureKey[]) {
    const range = recipe.featureRanges[key];
    const value = track.features?.[key];
    if (!range || value === undefined) continue;
    if (value >= range[0] && value <= range[1]) {
      parts.push(`${key} ${value.toFixed(2)}`);
    }
  }

  return parts.length > 0 ? parts.join(' · ') : 'based on similar songs in this playlist';
}

export interface PlaylistSuggestion {
  playlistId: number;
  playlistName: string;
  score: number;
  reason: string;
}

/** For triage mode: ranks every sub-playlist by how well this track fits it. */
export function suggestPlaylistsForTrack(uri: string): PlaylistSuggestion[] {
  const scoreTrack = loadScoreTrack(uri);
  const subPlaylists = listSubPlaylists();

  return subPlaylists
    .map((playlist: PlaylistRow) => {
      const recipe = loadRecipe(playlist.id);
      const examples = loadPlaylistExamples(playlist.id);
      return {
        playlistId: playlist.id,
        playlistName: playlist.name,
        score: score(scoreTrack, recipe, examples),
        reason: explainMatch(scoreTrack, recipe),
      };
    })
    .sort((a, b) => b.score - a.score);
}

export interface TrackSuggestion {
  uri: string;
  name: string;
  artists: string;
  score: number;
  reason: string;
}

/** For Auto-sort view: ranks unassigned candidate tracks by fit for this one playlist. */
export function suggestTracksForPlaylist(playlistId: number, limit = 50): TrackSuggestion[] {
  const recipe = loadRecipe(playlistId);
  const examples = loadPlaylistExamples(playlistId);
  const candidates = listUnassignedCandidateTracks();

  return candidates
    .map((track: TrackRow) => {
      const scoreTrack = loadScoreTrack(track.uri);
      return {
        uri: track.uri,
        name: track.name,
        artists: track.artists,
        score: score(scoreTrack, recipe, examples),
        reason: explainMatch(scoreTrack, recipe),
      };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
