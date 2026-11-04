import { describe, expect, it } from 'vitest';
import { isLikedSongs, LIKED_SONGS_SENTINEL } from './liked-songs.js';

describe('isLikedSongs', () => {
  it('recognises the sentinel that stands in for the Liked Songs "playlist id"', () => {
    expect(isLikedSongs(LIKED_SONGS_SENTINEL)).toBe(true);
  });

  it('does not match real playlist ids or empty strings', () => {
    expect(isLikedSongs('37i9dQZF1DXcBWIGoYBM5M')).toBe(false);
    expect(isLikedSongs('')).toBe(false);
    expect(isLikedSongs('LIKED_SONGS')).toBe(false);
  });
});
