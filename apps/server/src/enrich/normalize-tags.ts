import synonyms from './synonyms.json' with { type: 'json' };
import type { TrackTag } from './types.js';

const SYNONYMS: Record<string, string> = synonyms;

/** Minimum Last.fm-style weight (0-100) for a tag to be worth keeping — plan.md §4. */
const MIN_WEIGHT = 10;

/**
 * Lowercase + trim, map through the synonym list (synonyms.json — hand-editable),
 * drop anything below the weight floor, and merge duplicates that land on the same
 * canonical tag (keeping the highest weight, since near-duplicate raw tags like
 * "sad"/"melancholy" from the same provider usually reflect the same signal).
 */
export function normalizeTags(rawTags: TrackTag[]): TrackTag[] {
  const merged = new Map<string, number>();

  for (const raw of rawTags) {
    const trimmed = raw.tag.trim().toLowerCase();
    if (!trimmed || raw.weight < MIN_WEIGHT) continue;

    const canonical = SYNONYMS[trimmed] ?? trimmed;
    const existing = merged.get(canonical) ?? 0;
    if (raw.weight > existing) {
      merged.set(canonical, raw.weight);
    }
  }

  return [...merged.entries()].map(([tag, weight]) => ({ tag, weight }));
}
