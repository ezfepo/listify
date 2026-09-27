import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpotifyPlaylistItemEntry, SpotifySimplifiedPlaylist } from '../spotify/schemas.js';

const FIXTURE_PLAYLISTS: SpotifySimplifiedPlaylist[] = [
  { id: 'main123', name: 'Main', owner: { id: 'me', display_name: 'Me' }, items: { total: 2 } },
  {
    id: 'archive456',
    name: 'Main – Archive',
    owner: { id: 'me', display_name: 'Me' },
    items: { total: 1 },
  },
];

const FIXTURE_ITEMS: Record<string, SpotifyPlaylistItemEntry[]> = {
  main123: [
    {
      added_at: '2026-01-01T00:00:00Z',
      is_local: false,
      item: {
        type: 'track',
        uri: 'spotify:track:1',
        id: '1',
        name: 'Song One',
        duration_ms: 200000,
        is_local: false,
        artists: [{ name: 'Artist A' }],
        album: { name: 'Album A', images: [{ url: 'https://img/1.jpg' }] },
      },
    },
    {
      added_at: '2026-01-02T00:00:00Z',
      is_local: false,
      item: {
        type: 'track',
        uri: 'spotify:track:2',
        id: '2',
        name: 'Song Two',
        duration_ms: 210000,
        is_local: false,
        artists: [{ name: 'Artist B' }],
        album: { name: 'Album B' },
      },
    },
    // Podcast episode mixed into Main — should be skipped entirely.
    {
      added_at: '2026-01-03T00:00:00Z',
      is_local: false,
      item: {
        type: 'episode',
        uri: 'spotify:episode:1',
        id: 'e1',
        name: 'Some Podcast',
        is_local: false,
      },
    },
    // A track that's no longer available — item is null, should be skipped.
    { added_at: null, is_local: false, item: null },
  ],
  archive456: [
    {
      added_at: '2025-06-01T00:00:00Z',
      is_local: false,
      item: {
        type: 'track',
        uri: 'spotify:track:3',
        id: '3',
        name: 'Song Three',
        duration_ms: 180000,
        is_local: false,
        artists: [{ name: 'Artist C' }],
        album: { name: 'Album C' },
      },
    },
  ],
  sub789: [
    {
      added_at: '2026-01-05T00:00:00Z',
      is_local: true,
      item: {
        type: 'track',
        uri: 'spotify:local:artist:album:song:123',
        id: null,
        name: 'Local Song',
        is_local: true,
        artists: [{ name: 'Local Artist' }],
      },
    },
  ],
};

vi.mock('../spotify/auth.js', () => ({
  getValidAccessToken: vi.fn(async () => 'fake-token'),
}));

vi.mock('../spotify/client.js', () => ({
  getMyPlaylists: vi.fn(async () => FIXTURE_PLAYLISTS),
  getPlaylistItems: vi.fn(async (_token: string, playlistId: string) => FIXTURE_ITEMS[playlistId] ?? []),
}));

const { db } = await import('../db/index.js');
const { setSetting } = await import('../db/settings.js');
const { upsertPlaylist } = await import('../db/playlists.js');
const { pull, PullSetupError } = await import('./pull.js');
const { getPlaylistItems } = await import('../spotify/client.js');

beforeEach(() => {
  db.exec('DELETE FROM playlist_tracks; DELETE FROM tracks; DELETE FROM playlists; DELETE FROM settings;');
});

describe('pull', () => {
  it('requires Main and Archive to be configured first', async () => {
    await expect(pull()).rejects.toBeInstanceOf(PullSetupError);
  });

  it('mirrors Main and Archive track counts into the DB', async () => {
    setSetting('main_playlist_spotify_id', 'main123');
    setSetting('archive_playlist_spotify_id', 'archive456');

    const summary = await pull();

    expect(summary.mainTrackCount).toBe(2);
    expect(summary.archiveTrackCount).toBe(1);
    expect(summary.skippedEpisodes).toBe(1);
  });

  it('adopts sub-playlists and links their tracks, flagging local tracks', async () => {
    setSetting('main_playlist_spotify_id', 'main123');
    setSetting('archive_playlist_spotify_id', 'archive456');
    upsertPlaylist('sub789', 'Road', 'sub');

    const summary = await pull();

    expect(summary.subPlaylists).toEqual([{ name: 'Road', trackCount: 1 }]);

    const row = db
      .prepare('SELECT is_local FROM tracks WHERE uri = ?')
      .get('spotify:local:artist:album:song:123') as { is_local: number };
    expect(row.is_local).toBe(1);
  });

  it('gives new Main tracks inbox status and Archive-only tracks organized status', async () => {
    setSetting('main_playlist_spotify_id', 'main123');
    setSetting('archive_playlist_spotify_id', 'archive456');

    await pull();

    const mainTrack = db.prepare('SELECT status FROM tracks WHERE uri = ?').get('spotify:track:1') as {
      status: string;
    };
    const archiveTrack = db
      .prepare('SELECT status FROM tracks WHERE uri = ?')
      .get('spotify:track:3') as { status: string };

    expect(mainTrack.status).toBe('inbox');
    expect(archiveTrack.status).toBe('organized');
  });

  it('re-pulling clears in_main for tracks no longer in Spotify Main', async () => {
    setSetting('main_playlist_spotify_id', 'main123');
    setSetting('archive_playlist_spotify_id', 'archive456');
    await pull();

    const trimmedMain = (FIXTURE_ITEMS.main123 ?? []).filter(
      (e) => e.item?.uri !== 'spotify:track:2',
    );
    vi.mocked(getPlaylistItems).mockImplementationOnce(async () => trimmedMain);
    vi.mocked(getPlaylistItems).mockImplementationOnce(async () => FIXTURE_ITEMS.archive456 ?? []);
    await pull();

    const row = db.prepare('SELECT in_main FROM tracks WHERE uri = ?').get('spotify:track:2') as {
      in_main: number;
    };
    expect(row.in_main).toBe(0);
  });
});
