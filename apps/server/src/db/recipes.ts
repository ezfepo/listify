import { db } from './index.js';
import './schema.js';
import type { FeatureRanges } from '../enrich/score.js';

export interface Recipe {
  playlistId: number;
  includeTags: string[];
  excludeTags: string[];
  featureRanges: FeatureRanges;
}

interface RecipeRow {
  playlist_id: number;
  include_tags_json: string | null;
  exclude_tags_json: string | null;
  feature_ranges_json: string | null;
}

function rowToRecipe(row: RecipeRow): Recipe {
  return {
    playlistId: row.playlist_id,
    includeTags: row.include_tags_json ? JSON.parse(row.include_tags_json) : [],
    excludeTags: row.exclude_tags_json ? JSON.parse(row.exclude_tags_json) : [],
    featureRanges: row.feature_ranges_json ? JSON.parse(row.feature_ranges_json) : {},
  };
}

export function getRecipe(playlistId: number): Recipe | undefined {
  const row = db.prepare('SELECT * FROM playlist_recipes WHERE playlist_id = ?').get(playlistId) as
    RecipeRow | undefined;
  return row ? rowToRecipe(row) : undefined;
}

export function upsertRecipe(playlistId: number, recipe: Omit<Recipe, 'playlistId'>): Recipe {
  db.prepare(
    `INSERT INTO playlist_recipes (playlist_id, include_tags_json, exclude_tags_json, feature_ranges_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(playlist_id) DO UPDATE SET
       include_tags_json = excluded.include_tags_json,
       exclude_tags_json = excluded.exclude_tags_json,
       feature_ranges_json = excluded.feature_ranges_json`,
  ).run(
    playlistId,
    JSON.stringify(recipe.includeTags),
    JSON.stringify(recipe.excludeTags),
    JSON.stringify(recipe.featureRanges),
  );
  return { playlistId, ...recipe };
}

export function deleteRecipe(playlistId: number): void {
  db.prepare('DELETE FROM playlist_recipes WHERE playlist_id = ?').run(playlistId);
}
