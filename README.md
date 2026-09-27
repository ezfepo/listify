# Listify

Listify is a local-only web app that splits one big Spotify playlist ("Main")
into many mood/context playlists — "for her in the car", "sad", "road trip",
and so on — using only songs already in your library, and handles new songs
arriving in monthly batches.

It's a personal tool, not a hosted service: everything runs on your own
machine, your listening data stays in a local SQLite file, and Spotify is
only ever a sync *target*, never the source of truth.

## How it works

1. **Pull** — reads your "Main" playlist (and any playlists you've adopted
   as sub-playlists) from Spotify into a local database.
2. **Enrich** — fetches audio features (ReccoBeats) and crowd tags (Last.fm)
   for each track to power suggestions. All optional, all cached locally.
3. **Organize** — a keyboard-first triage UI suggests which mood/context
   playlists a song fits, you confirm with one keypress.
4. **Sync** — a diff/preview/apply flow pushes your organizing decisions
   back to Spotify: tracks get added to the right sub-playlists and an
   archive, and only then removed from Main. Every step is logged and
   reversible until applied.

See [plan.md](plan.md) for the full design and build phases.

## Requirements

- **Node.js 24.16.0+** (earlier versions have a `node:sqlite` bug that
  silently truncates text)
- A **Spotify Premium** account and a [Spotify Developer](https://developer.spotify.com/dashboard)
  app (redirect URI `http://127.0.0.1:8787/auth/callback`)
- A free [Last.fm API key](https://www.last.fm/api/account/create)

## Setup

```sh
git clone https://github.com/ezfepo/listify.git
cd listify
npm install
```

Create a `.env` file in the repo root:

```sh
SPOTIFY_CLIENT_ID=your-client-id
LASTFM_API_KEY=your-lastfm-key
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8787/auth/callback
DRY_RUN=true
```

Run both the API and the web UI:

```sh
npm run dev
```

Then open `http://127.0.0.1:5173`.

## Project structure

```
apps/
  server/   Fastify API — auth, Spotify client, sync engine, SQLite
  web/      React + Vite + Tailwind UI
data/       app.db + JSON backups (gitignored, created at runtime)
```

`server/src/spotify/` is the only place that talks to the Spotify API, and
`server/src/sync/apply.ts` is the only place that writes to it — every
change is chunked, retried, and logged before Main is ever touched.

## Development

```sh
npm run dev     # start server (8787) + web (5173)
npm test        # run tests across all workspaces
npm run lint    # ESLint
npm run format  # Prettier
```

`DRY_RUN=true` (the default) makes the sync engine log what it *would* do
to Spotify instead of writing anything — safe to explore with before going
live.

## License

[MIT](LICENSE)
