# Listify — CLAUDE.md

Local-only web app that splits one big Spotify playlist ("Main") into many
mood/context playlists, using only songs already in Main. Full plan in
[plan.md](plan.md); read it before starting a new phase.

## Decisions (do not re-litigate)

- Local web app on `http://127.0.0.1`, no packaging.
- Node 24.16.0+, TypeScript, Fastify API (`apps/server`), React + Vite +
  Tailwind UI (`apps/web`), npm workspaces, single repo.
- Storage: `node:sqlite` (`DatabaseSync`, built-in — never add `better-sqlite3`), plus JSON export/import for backups.
- Local DB is the source of truth; Spotify is a sync target.
- Song lifecycle: Main = inbox. Organizing copies a song into `Main – Archive`
  and removes it from Main only after the Archive copy is verified.
- Classification is assisted: ReccoBeats (audio features) + Last.fm (tags)
  produce suggestions; a human always confirms.
- Not a player: only "Open in Spotify" deep links + optional play on active
  device.
- Auth: Authorization Code + PKCE, no client secret.

## Spotify API rules (post Feb-2026 — verify before coding, do not trust training data)

- Always check https://developer.spotify.com/documentation/web-api before
  writing/changing an endpoint call.
- Owner needs Spotify Premium. Redirect URI must be `http://127.0.0.1:<port>/...`.
- Playlist endpoints are `/playlists/{id}/items` (not `/tracks`); DELETE body
  param is `items`, not `tracks`.
- Response shape: `playlist.items.items[].item` (not `tracks.items[].track`).
- Create playlist via `POST /me/playlists`.
- No batch `GET /tracks?ids=`, no `popularity`, no audio-features or
  recommendations endpoints — get metadata from playlist-items responses.
- Max 100 URIs per add/remove call (chunk); paginate reads.
- Handle `429` + `Retry-After`; distinguish `reason: QUOTA_EXCEEDED`.
- Refresh tokens expire (~6 months) — on refresh failure, surface "Reconnect".
- Skip/flag `is_local` tracks and episodes.
- Scopes: `playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-read-playback-state user-modify-playback-state`

## Architecture

```
listify/
  apps/server/   Fastify · auth · spotify client · sync engine · SQLite
  apps/web/      React · Vite · Tailwind
  data/          app.db · backups/*.json   (git-ignored)
```

- `server/src/spotify/` is the ONLY place that talks to Spotify (thin,
  typed, zod-validated, retry/backoff, chunked).
- `server/src/sync/` holds pure functions: `pull()`, `diff()`, `apply()`.
- Web never calls Spotify directly — only `/api/*`.
- **Rule: nothing outside `server/src/sync/apply.ts` may write to Spotify.**
- Never remove a track from Main that isn't verified present in Archive.

## Commands

- `npm run dev` — starts server (port 8787) and web (port 5173) together.
- `npm test` — runs tests across workspaces.
- `npm run lint` / `npm run format` — ESLint / Prettier.

## Working rules

1. One phase of `plan.md` per session; stop at its checkpoint.
2. Tests never hit the live Spotify API (use recorded fixtures).
3. Secrets stay in `.env`; never commit them or print them to logs.
4. Small commits, conventional messages. Tick checkboxes in `plan.md` as
   phases complete.
