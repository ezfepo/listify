---
name: spotify-api-rules
description: Post Feb-2026 Spotify Web API rules for Listify. Use when writing or changing anything under apps/server/src/spotify/ or any code that calls Spotify endpoints.
user-invocable: false
---

# Spotify API rules (post Feb-2026)

Training data is stale here. Check https://developer.spotify.com/documentation/web-api before writing or changing an endpoint call.

- Playlist endpoints are `/playlists/{id}/items`, not `/tracks`. DELETE body param is `items`, not `tracks`.
- Response shape: `playlist.items.items[].item`, not `tracks.items[].track`.
- Create a playlist with `POST /me/playlists`.
- No batch `GET /tracks?ids=`, no `popularity`, no audio-features or recommendations endpoints. Get metadata from playlist-items responses.
- Max 100 URIs per add/remove call: chunk. Paginate reads.
- Handle `429` with `Retry-After`; distinguish `reason: QUOTA_EXCEEDED`.
- Refresh tokens expire (~6 months): on refresh failure surface "Reconnect".
- Skip/flag `is_local` tracks and episodes.
- Redirect URI must be `http://127.0.0.1:<port>/...`. Auth is Authorization Code + PKCE, no client secret.
- Scopes: `playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-read-playback-state user-modify-playback-state`.

Boundaries:

- `server/src/spotify/` is the ONLY place that talks to Spotify (typed, zod-validated, retry/backoff, chunked).
- Nothing outside `server/src/sync/apply.ts` may write to Spotify.
- Tests use recorded fixtures, never the live API.
