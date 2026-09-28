# plan.md — Listify (local Spotify playlist organizer)

> How to use: open this folder in VS Code, run `claude`, and say
> **"Read plan.md and execute Phase N. Stop at the checkpoint."**
> One phase per session. Tick the boxes as you go. Do not skip checkpoints.

---

## 1. Goal

**Listify**: a local-only web app that splits one big Spotify playlist ("Main")
into many mood/context playlists ("songs for my girl in the car", "sad",
"road"...), using only songs already in Main, and handles monthly batches of
new songs.

- **Spotify app name:** Listify (already created in the Spotify Developer Dashboard)
- **Redirect URI:** `http://127.0.0.1:8787/auth/callback`

## 2. Decisions (already made — do not re-litigate)

| Topic           | Decision                                                                                                                                 | Why                                                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App type        | Local web app,`http://127.0.0.1`                                                                                                       | Spotify OAuth needs a browser redirect anyway; no packaging/signing; best UI tooling. Can be wrapped in Tauri later if a desktop icon is wanted.                   |
| Stack           | Node**24.16.0+** + TypeScript. Fastify API, React + Vite + Tailwind UI, single repo (npm workspaces)                               | One language, Claude Code is strong at it.                                                                                                                         |
| Storage         | **`node:sqlite`** (built-in `DatabaseSync`) + JSON export/import                                                               | Songs shared between playlists = many-to-many. JSON gets painful; SQLite is still one file, no native module to compile. JSON export is the human-readable backup. |
| Source of truth | **Local DB**. Spotify is a sync target.                                                                                            | Enables re-organizing any time, undo, dry-run.                                                                                                                     |
| Song lifecycle  | **Option 2**: Main = inbox. After organizing, song is copied to `Main – Archive` and removed from Main.                         | Archive is the full pool for future criteria; Main only ever shows "what's new". Monthly 50 songs → drop into Main → Sync → they appear in Inbox.               |
| Main source     | Main can be **either** a real playlist **or Liked Songs** (`GET`/`DELETE /me/tracks`), picked on the setup screen. Archive must always be a real playlist. | Liked Songs isn't a real playlist in the API (no ID, own endpoints, own scopes) but is a common place people actually keep their "everything" pool — worth supporting natively instead of forcing a manual copy into a real playlist first. |
| Classification  | **Assisted**: external data (ReccoBeats audio features + Last.fm tags) → per-playlist suggestions → human confirms with one key. | Spotify removed audio-features from its API; third-party sources fill the gap. Human always has the final say.                                                     |
| Playback        | Not a player. Only a "which song was this?" check:`Open in Spotify` link + optional play on active device.                             | User keeps listening in Spotify.                                                                                                                                   |
| Auth            | Authorization Code + PKCE, no client secret                                                                                              | Personal app.                                                                                                                                                      |

## 3. Spotify API rules (post Feb-2026 — most tutorials are WRONG)

Claude Code: **verify every endpoint against
https://developer.spotify.com/documentation/web-api before coding it.**
Never trust training-data knowledge of this API.

- App owner needs **Spotify Premium** or the app stops working.
- Redirect URI must be `http://127.0.0.1:<port>/...` (`localhost` is rejected).
- Playlist endpoints are `/playlists/{id}/items` (NOT `/tracks`):
  `GET`, `POST`, `PUT`, `DELETE`. DELETE body param is `items`, not `tracks`.
- Response fields renamed: `playlist.items.items[].item` (was `tracks.items[].track`).
- Create playlist: `POST /me/playlists` (the `/users/{id}/playlists` one is gone).
- Removed: batch `GET /tracks?ids=`, `popularity`, audio-features,
  recommendations. Get all metadata from the playlist-items response itself.
- Max 100 URIs per add/remove call → chunk. Paginate reads.
- Handle `429` with `Retry-After`; distinguish `reason: QUOTA_EXCEEDED`.
- Refresh tokens now expire (~6 months) → on refresh failure, show "Reconnect".
- Skip/flag `is_local` tracks and episodes (cannot be managed by URI).
- Scopes: `playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-read-playback-state user-modify-playback-state user-library-read user-library-modify`
- **Liked Songs is not a playlist.** No playlist ID; read via `GET /me/tracks`
  (paged, but the track lives under `track`, not `item` — a different shape from
  playlist items, and there's no `type`/episode field since this endpoint never
  returns episodes). Removing a song from it (Phase 6+) is `DELETE /me/tracks`
  with **track IDs** (not URIs), max **50** per call — not the playlist-items
  rules (100 URIs). Needs `user-library-read`/`user-library-modify`, which the
  playlist-\* scopes don't cover.

## 4. Architecture

```
listify/
  plan.md  CLAUDE.md  .env  .gitignore  package.json (workspaces)
  apps/
    server/   Fastify · auth · spotify client · sync engine · SQLite
    web/      React · Vite · Tailwind · TanStack Query + Virtual
  data/       app.db · backups/*.json      (git-ignored)
```

- `server/src/spotify/` — the ONLY place that talks to Spotify (thin client,
  typed, zod-validated responses, retry/backoff, chunking).
- `server/src/sync/` — pure functions: `pull()`, `diff()`, `apply()`.
- Web never calls Spotify directly; it calls `/api/*`.

### Data model

```
tracks(uri PK, name, artists, album, image_url, duration_ms,
       added_at, first_seen_at, status['inbox'|'organized'|'skipped'],
       in_main, in_archive, is_local)
playlists(id PK, spotify_id NULL, name, criteria_note, emoji, color,
          kind['main'|'archive'|'sub'], sort_order)
playlist_tracks(playlist_id, track_uri, assigned_at, PRIMARY KEY(both))
track_features(track_uri PK, source, valence, energy, danceability, tempo,
       acousticness, instrumentalness, speechiness, loudness, fetched_at)
track_tags(track_uri, tag, weight, source, PRIMARY KEY(track_uri, tag, source))
playlist_recipes(playlist_id PK, include_tags_json, exclude_tags_json,
       feature_ranges_json)          -- e.g. {"valence":[0,0.35],"energy":[0,0.5]}
enrichment_status(track_uri, source, status['ok'|'not_found'|'error'], ts)
operations(id, ts, batch_id, type, payload_json, status, error)
settings(key PK, value)      -- tokens, main/archive ids
```

`playlists.spotify_id` (and the `settings` key `main_playlist_spotify_id`) can
hold the sentinel `"liked_songs"` instead of a real Spotify playlist ID, meaning
Main is Liked Songs rather than a playlist (`server/src/spotify/liked-songs.ts`,
`LIKED_SONGS_SENTINEL`/`isLikedSongs()`). Never treat it as a real ID when
calling playlist endpoints — check `isLikedSongs()` first and branch to the
`/me/tracks` client functions (`getSavedTracks`, `getSavedTracksTotal`, and —
Phase 6+ — the saved-tracks removal call) instead.

### Enrichment + suggestions

Providers live in `server/src/enrich/<provider>.ts` behind one interface
(`enrich(track) → {features?, tags?}`), so any of them can be swapped or dropped.
Verify each provider's live docs, rate limits and terms before coding.

| Provider                                                                  | Gives                                                                                    | Lookup key                   | Cost                                                       |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------- |
| **ReccoBeats** (primary)                                            | valence, energy, danceability, tempo, acousticness, instrumentalness... (Spotify-shaped) | Spotify track ID             | Free, no key. Coverage is not 100% → record`not_found`. |
| **Last.fm** `track.getTopTags` (+ `artist.getTopTags` fallback) | Crowd tags: "sad", "chill", "road trip", "love", genre, decade                           | artist + title               | Free API key                                               |
| MusicBrainz (optional)                                                    | genres, release year                                                                     | ISRC (`external_ids.isrc`) | Free, 1 req/s, needs User-Agent                            |
| LRCLIB (optional, later)                                                  | lyrics → language, theme                                                                | artist + title               | Free                                                       |

- Run as a background job after Pull: queue, concurrency 2, polite delay,
  cache forever in DB, retry only `error`, never block the UI.
- Normalize tags: lowercase, trim, drop tags with weight < 10, map synonyms
  (`sad`/`melancholy`/`melancholic` → `sad`).

**Suggestion score per (track, playlist)** — pure function, unit tested:

1. *Recipe match*: tag overlap + feature-range fit from `playlist_recipes`.
2. *Learn from examples*: once a playlist has ≥ 10 songs, compute its feature
   centroid + tag frequency; score = similarity to that profile. No ML libs,
   no external AI — plain cosine/Jaccard, all local.
3. Final = weighted mix, 0–100. Show top suggestions ≥ 60.

Starter recipes (editable in UI): Sad → valence < 0.35, energy < 0.5, tags
sad/melancholy · Road → energy > 0.65, tempo 100–140, tags driving/rock/road trip ·
For her in the car → valence > 0.5, tags love/romantic/pop, speechiness < 0.2.

### Sync engine (the critical part)

1. **Pull**: read Main, Archive, and every sub-playlist from Spotify → upsert.
   New URIs in Main → `status='inbox'`. Dedupe by URI. If Main is Liked Songs
   (see Data model above), this step reads `GET /me/tracks` instead of
   `GET /playlists/{id}/items` — same upsert/dedupe logic, different source.
2. **Diff**: desired (DB) vs actual (Spotify) → list of operations.
3. **Preview**: UI shows the diff ("+12 to Road, +30 to Archive, −30 from Main").
4. **Apply**, strictly in this order, idempotent, logged in `operations`:
   a. write JSON snapshot to `data/backups/`
   b. create missing playlists
   c. add to sub-playlists
   d. add to Archive
   e. re-read Archive, **verify**
   f. only then remove from Main (only URIs verified in Archive) — **if Main is
      Liked Songs, this is `DELETE /me/tracks` with track IDs (chunked by 50),
      not the playlist-items removal call (chunked by 100, URIs)**
5. Any failure → stop, keep Main untouched, show the log.

`DRY_RUN=true` env flag makes `apply()` log instead of write. Default ON until Phase 6.

### UI

Dark, dense, keyboard-first. Three panes:

- **Left**: Inbox (count), Organized, Skipped · list of sub-playlists with
  emoji/color/count · "+ New playlist" (name + criteria note).
- **Center**: virtualized track table (cover, title, artist, added date,
  playlist chips). Search, filter by artist / untagged / "in N playlists".
  Multi-select + bulk assign.
- **Right / Triage mode**: one song at a time — big cover, play button,
  playlist toggle buttons numbered 1–9. Suggested playlists are pre-highlighted
  with their score and the reason ("valence 0.21 · tag: sad"); `a` accepts all suggestions.
- **Auto-sort view**: per playlist, a ranked list of candidate songs from the
  pool → tick/untick → bulk assign. This is the fast path for hundreds of songs.
- Keys: `j/k` move · `1–9` toggle playlist · `a` accept suggestions ·
  `o` open in Spotify · `space` play on active device (optional) · `enter` done → next · `s` skip · `u` undo · `/` search.
- Top bar: connection status, **Sync** button, pending-changes badge →
  opens Diff Preview → **Apply**.

---

## 5. Phases

### Phase 0 — Manual setup (human, ~10 min)

- [X] Install **Node 24.16.0 or newer** (check with `node -v`; versions below
  24.16.0 have a `node:sqlite` bug that silently truncates text), Git,
  VS Code, Claude Code (`npm i -g @anthropic-ai/claude-code`).
- [X] Spotify app created: **Listify**, Web API, redirect URI
  `http://127.0.0.1:8787/auth/callback` → copy the **Client ID** from the
  app's Settings page.
- [X] In Spotify, create an empty playlist named `Main – Archive`.
- [X] Terminal:
  ``mkdir listify && cd listify git init code .``
- [X] Get a free Last.fm API key: https://www.last.fm/api/account/create
- [X] Copy this `plan.md` into the folder. Create `.env`:
  ``SPOTIFY_CLIENT_ID=xxxx LASTFM_API_KEY=xxxx SPOTIFY_REDIRECT_URI=http://127.0.0.1:8787/auth/callback DRY_RUN=true``
- [X] VS Code terminal → `claude` → "Read plan.md and execute Phase 1."

### Phase 1 — Scaffold

- [X] Create `CLAUDE.md` containing: sections 2, 3 and 4 of this file
  (condensed), plus commands (`npm run dev`, `npm test`), plus rule
  "never write to Spotify outside `sync/apply.ts`".
- [X] npm workspaces, TypeScript strict, ESLint + Prettier, Vitest.
- [X] `package.json` → `"engines": { "node": ">=24.16.0" }` at the repo root.
- [X] DB access wrapped in one module (`server/src/db/index.ts`,
  `import { DatabaseSync } from 'node:sqlite'`). No `better-sqlite3` dependency.
- [X] `apps/server` (Fastify, port 8787) with `/api/health`.
- [X] `apps/web` (Vite + React + Tailwind, port 5173, proxy `/api` and `/auth` → 8787).
- [X] `.gitignore`: `.env`, `data/`, `node_modules`.
- [X] `npm run dev` starts both.

- **Checkpoint:** browser shows a page that displays `/api/health` OK. Commit.

### Phase 2 — Auth

- [X] `/auth/login` → PKCE → `/auth/callback` → store tokens in `settings`.
- [X] Auto-refresh; on failure return 401 `reconnect_required`.
- [X] `/api/me` → display name. UI: Connect / Connected as X.

- **Checkpoint:** login works end to end at `http://127.0.0.1:5173`. Commit.

### Phase 3 — DB + Pull (read-only)

- [X] Migrations for the data model in §4.
- [X] Spotify client: `getMyPlaylists`, `getPlaylistItems` (paginated), zod schemas.
- [X] Setup screen: pick **Main** and **Archive** from the user's playlists.
- [X] `POST /api/sync/pull` implements step 1 of the sync engine.
  Existing playlists the user owns can be "adopted" as sub-playlists.
- [X] Main can be **Liked Songs** instead of a real playlist (`GET /me/tracks`,
  `LIKED_SONGS_SENTINEL`) — appears as an option in the setup screen's Main
  picker; rejected if picked for Archive. Needs `user-library-read` — a user
  who connected before this landed must reconnect for the new scope.
- [X] Unit tests with recorded fixtures (no live calls in tests).

- **Checkpoint:** track count in DB == track count in Spotify Main. Commit.

**Known gap, carried to Phase 4:** the adopt-sub-playlist mechanism
(`POST /api/setup`'s `adopt` field, `pull()`'s handling of `kind='sub'`
playlists) is implemented and unit-tested, but the web UI only exposes
pickers for Main/Archive — there's no "adopt an existing playlist as a
sub-playlist" UI yet. Add that alongside the playlist CRUD in Phase 4's
three-pane layout.

### Phase 3b — Enrichment + suggestion engine

- [X] Add `external_ids.isrc` to the tracks table during Pull.
- [X] Provider interface + ReccoBeats + Last.fm providers (`LASTFM_API_KEY` in `.env`).
- [X] Background queue, status table, `/api/enrich/status` (progress + coverage %).
- [X] Tag normalization + synonym map (JSON file, editable).
- [X] `score(track, playlist)` pure function + tests. Recipes CRUD endpoints.

- [X] **Checkpoint:** reviewed against a real Spotify Liked Songs library (488
  tracks). ReccoBeats coverage 416/488 = 85.2%, Last.fm coverage 469/488 =
  96.1% — both well above the 60% bar, no fallback needed. Commit.

### Phase 4 — Organizer UI

- [ ] Read the `frontend-design` skill first if available. Build the three-pane
  layout from §4, virtualized list, playlist CRUD (local only), assign /
  unassign, multi-select bulk assign, search + filters.
- [ ] Triage mode + all keyboard shortcuts + undo stack.
- [ ] Recipe editor per playlist (tag chips + range sliders), suggestion chips
  with reasons, Auto-sort view, feature columns sortable in the table.
- [ ] "Which song is this?": `Open in Spotify` deep link (`spotify:track:…`).
  Optional: `PUT /me/player/play` on the active device. No in-app player.

- **Checkpoint:** human organizes ~20 real songs, reports friction. Fix. Commit.

### Phase 5 — Diff + Apply (DRY_RUN)

- [ ] `diff()` as a pure function + thorough unit tests (adds, removes,
  shared songs, duplicates, local tracks, already-applied ops).
- [ ] Diff Preview modal. `apply()` per §4 order, chunked by 100, backoff on 429,
  every op logged. With `DRY_RUN=true` only logs.
- [ ] **If Main is Liked Songs** (`isLikedSongs()`), step 4.f's removal must call
  `DELETE /me/tracks` with track IDs chunked by **50** — not the playlist-items
  removal endpoint (URIs, chunked by 100). Cover both paths in `apply()`'s tests.
- [ ] JSON snapshot + `Export JSON` / `Import JSON` of the whole DB.

- **Checkpoint:** human reviews dry-run log for a real batch. Commit.

### Phase 6 — Go live, carefully

- [ ] Human duplicates Main in Spotify as a manual safety copy.
- [ ] `DRY_RUN=false`. Apply a batch of **5 songs**. Verify in Spotify:
  in sub-playlists ✔ in Archive ✔ gone from Main ✔.
- [ ] Then full apply.

- **Checkpoint:** Main contains only un-triaged songs. Commit + tag `v1.0`.

### Phase 7 — Re-organize & monthly flow

- [ ] "Pool" view = Archive + Main: create a new playlist with new criteria
  from already-organized songs; remove a song from a sub-playlist;
  rename/delete playlists (delete = unfollow, behind a confirm).
- [ ] Monthly flow test: add songs to Main in Spotify → Sync → they land in
  Inbox → triage → Apply.
- [ ] Drift handling: if a sub-playlist was edited in the Spotify app, Pull
  shows the difference and asks "keep Spotify's" or "keep local".

- **Checkpoint:** human runs a full monthly cycle. Commit + tag `v1.1`.

### Phase 8 — Optional

- [ ] One-click launcher (`start.cmd`) that runs the server and opens the browser.
- [ ] Tauri wrapper for a desktop icon.
- [ ] LLM-assisted tagging for songs with no external data: **check Spotify
  Developer Terms first** (they restrict feeding Spotify content into AI
  models). Strictly opt-in.
- [ ] Lyrics provider (LRCLIB) → language + theme tags.
- [ ] Stats: songs per playlist, orphans (in Archive but no sub-playlist).

---

## 6. Rules for Claude Code

1. One phase per session; stop at the checkpoint and summarize what to test.
2. Check the live Spotify reference before writing any endpoint call.
3. All Spotify writes go through `sync/apply.ts`. Nothing else may mutate Spotify.
4. Never remove from Main what is not verified in Archive.
5. Tests never hit the live API. Secrets never leave `.env`.
6. Small commits, conventional messages. Update the checkboxes in this file.
