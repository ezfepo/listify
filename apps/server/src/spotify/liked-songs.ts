// "Liked Songs" isn't a real playlist in the Spotify API — it has no playlist ID,
// is read via a different endpoint (GET /me/tracks, not /playlists/{id}/items),
// and (for Phase 6+) is written to via DELETE /me/tracks with track IDs, max 50
// per call — not the playlist-items URI/100 rules. This sentinel stands in for
// its "playlist ID" everywhere in our data model (settings, the playlists table).
export const LIKED_SONGS_SENTINEL = 'liked_songs';

export function isLikedSongs(spotifyId: string): boolean {
  return spotifyId === LIKED_SONGS_SENTINEL;
}
