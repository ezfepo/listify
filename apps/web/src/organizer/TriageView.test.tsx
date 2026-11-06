import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type PlaylistSuggestion, type PlaylistView, type TrackView } from '../lib/api';
import { TriageView, type TriageHotkeys } from './TriageView';

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  api: { getTrackSuggestions: vi.fn() },
}));

const getTrackSuggestions = vi.mocked(api.getTrackSuggestions);

const track: TrackView = {
  uri: 'spotify:track:1',
  name: 'Song One',
  artists: 'Artist A',
  album: null,
  imageUrl: null,
  durationMs: null,
  addedAt: null,
  isrc: null,
  status: 'inbox',
  inMain: true,
  inArchive: false,
  features: null,
  tags: [],
  enrichment: [],
  playlists: [],
};

function playlist(id: number, kind: PlaylistView['kind'] = 'sub'): PlaylistView {
  return {
    id,
    spotifyId: null,
    name: `PL${id}`,
    kind,
    criteriaNote: null,
    emoji: null,
    color: null,
    sortOrder: id,
    trackCount: 0,
  };
}

function suggestion(playlistId: number, score: number): PlaylistSuggestion {
  return { playlistId, playlistName: `PL${playlistId}`, score, reason: 'because' };
}

function setup(overrides: Partial<ComponentProps<typeof TriageView>> = {}) {
  const mocks = {
    onUndo: vi.fn(),
    onSelectTrack: vi.fn(),
    onAssign: vi.fn(),
    onUnassign: vi.fn(),
    onSkip: vi.fn(),
    onDone: vi.fn(),
    onPlay: vi.fn(),
    registerHotkeys: vi.fn(),
  };
  const props: ComponentProps<typeof TriageView> = {
    track,
    upNext: [],
    queueLength: 12,
    playlists: [],
    history: [],
    ...mocks,
    ...overrides,
  };
  const view = render(<TriageView {...props} />);
  return { props, mocks, ...view };
}

// findBy* resolves once the DOM commits, but hotkeys are registered in a passive effect
// that may not have flushed yet; wait for it before reading the latest handlers.
async function flushEffects() {
  await act(async () => {});
}

function lastHotkeys(registerHotkeys: ReturnType<typeof vi.fn>): TriageHotkeys {
  const handlers = registerHotkeys.mock.calls.at(-1)?.[0] as TriageHotkeys | null | undefined;
  if (!handlers) throw new Error('hotkeys not registered');
  return handlers;
}

beforeEach(() => {
  getTrackSuggestions.mockReset();
  getTrackSuggestions.mockResolvedValue([]);
});

describe('TriageView stage', () => {
  it('shows an empty state and clears hotkeys when there is no track', () => {
    const { mocks } = setup({ track: undefined });
    expect(screen.queryByText(/Inbox is empty/)).not.toBeNull();
    expect(getTrackSuggestions).not.toHaveBeenCalled();
    expect(mocks.registerHotkeys).toHaveBeenLastCalledWith(null);
  });

  it('shows the track, queue length, and fetches suggestions for it', async () => {
    getTrackSuggestions.mockResolvedValue([suggestion(1, 80)]);
    setup({ playlists: [playlist(1)] });
    expect(screen.queryByText('Song One')).not.toBeNull();
    expect(screen.queryByText('Artist A')).not.toBeNull();
    expect(screen.queryByText(/12 left in inbox/)).not.toBeNull();
    await screen.findByText('PL1');
    expect(getTrackSuggestions).toHaveBeenCalledWith('spotify:track:1');
  });

  it('shows audio facts and tags when the song has them', () => {
    setup({
      track: {
        ...track,
        album: 'The Album',
        features: { energy: 0.75, tempo: 128 },
        tags: [{ tag: 'dance', weight: 1, source: 'lastfm' }],
      },
    });
    expect(screen.queryByText('The Album')).not.toBeNull();
    expect(screen.queryByText('0.75')).not.toBeNull();
    expect(screen.queryByText('128.00')).not.toBeNull();
    expect(screen.queryByText('dance')).not.toBeNull();
  });

  it('shows the track length next to the album', () => {
    setup({ track: { ...track, album: 'The Album', durationMs: 65000 } });
    expect(screen.queryByText('1:05')).not.toBeNull();
  });

  it('says so when there are no audio features or tags yet', () => {
    setup();
    expect(screen.queryByText('No audio features yet.')).not.toBeNull();
    expect(screen.queryByText('No tags yet.')).not.toBeNull();
  });

  it('skip, done and play buttons call their handlers with the current track', async () => {
    const { mocks } = setup();
    await userEvent.click(screen.getByRole('button', { name: /Skip/ }));
    await userEvent.click(screen.getByRole('button', { name: /Done/ }));
    await userEvent.click(screen.getByRole('button', { name: /Play/ }));
    expect(mocks.onSkip).toHaveBeenCalledWith('spotify:track:1');
    expect(mocks.onDone).toHaveBeenCalledTimes(1);
    expect(mocks.onPlay).toHaveBeenCalledWith('spotify:track:1');
  });

  it('prompts to create a playlist when there are no sub-playlists', () => {
    setup({ playlists: [playlist(1, 'main'), playlist(2, 'archive')] });
    expect(screen.queryByText(/Create a playlist in Organize/)).not.toBeNull();
  });
});

describe('TriageView target grid', () => {
  it('shows at most 9 numbered targets, best match first', async () => {
    getTrackSuggestions.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => suggestion(i + 1, 50 + i)),
    );
    setup({ playlists: Array.from({ length: 12 }, (_, i) => playlist(i + 1)) });
    await screen.findByText('PL12');
    expect(screen.queryByText('PL4')).not.toBeNull();
    expect(screen.queryByText('PL3')).toBeNull();
    const tiles = screen.getAllByRole('button', { pressed: false }).map((b) => b.textContent ?? '');
    expect(tiles[0]).toContain('PL12');
    expect(tiles).toHaveLength(9);
  });

  it('fills the grid with unsuggested playlists after the scored ones', async () => {
    getTrackSuggestions.mockResolvedValue([suggestion(2, 80)]);
    setup({ playlists: [playlist(1), playlist(2), playlist(3)] });
    await screen.findByText('PL2');
    const labels = screen
      .getAllByRole('button', { pressed: false })
      .map((b) => b.textContent ?? '');
    expect(labels.map((l) => l.match(/PL\d/)?.[0])).toEqual(['PL2', 'PL1', 'PL3']);
  });

  it('clicking a target assigns the track to that playlist', async () => {
    getTrackSuggestions.mockResolvedValue([suggestion(2, 75)]);
    const { mocks } = setup({ playlists: [playlist(2)] });
    const button = (await screen.findByText('PL2')).closest('button') as HTMLButtonElement;

    await userEvent.click(button);
    expect(mocks.onAssign).toHaveBeenCalledWith('spotify:track:1', 2);
    expect(mocks.onUnassign).not.toHaveBeenCalled();
  });

  it('shows a target as assigned from the track itself, and clicking it again unassigns', async () => {
    getTrackSuggestions.mockResolvedValue([suggestion(2, 75)]);
    const { mocks } = setup({
      playlists: [playlist(2)],
      track: { ...track, playlists: [{ id: 2, name: 'PL2' }] },
    });
    const button = (await screen.findByText('PL2')).closest('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.className).toContain('bg-done-soft');

    await userEvent.click(button);
    expect(mocks.onUnassign).toHaveBeenCalledWith('spotify:track:1', 2);
    expect(mocks.onAssign).not.toHaveBeenCalled();
  });

  it('Accept 60+ skips playlists the track is already in', async () => {
    getTrackSuggestions.mockResolvedValue([suggestion(1, 90), suggestion(2, 80)]);
    const { mocks } = setup({
      playlists: [playlist(1), playlist(2)],
      track: { ...track, playlists: [{ id: 1, name: 'PL1' }] },
    });
    await screen.findByText('PL2');
    await userEvent.click(screen.getByRole('button', { name: /Accept 60\+/ }));
    expect(mocks.onAssign.mock.calls).toEqual([['spotify:track:1', 2]]);
  });

  it('the Accept 60+ button assigns only targets at or above the threshold', async () => {
    getTrackSuggestions.mockResolvedValue([
      suggestion(1, 90),
      suggestion(2, 60),
      suggestion(3, 59),
    ]);
    const { mocks } = setup({ playlists: [playlist(1), playlist(2), playlist(3)] });
    await screen.findByText('PL3');

    await userEvent.click(screen.getByRole('button', { name: /Accept 60\+/ }));
    expect(mocks.onAssign.mock.calls).toEqual([
      ['spotify:track:1', 1],
      ['spotify:track:1', 2],
    ]);
  });
});

describe('TriageView hotkeys', () => {
  it('accept-suggestions assigns only suggestions at or above the threshold (60)', async () => {
    getTrackSuggestions.mockResolvedValue([
      suggestion(1, 90),
      suggestion(2, 60),
      suggestion(3, 59),
    ]);
    const { mocks } = setup({ playlists: [playlist(1), playlist(2), playlist(3)] });
    await screen.findByText('PL3');
    await flushEffects();

    act(() => lastHotkeys(mocks.registerHotkeys).acceptSuggestions());
    expect(mocks.onAssign.mock.calls).toEqual([
      ['spotify:track:1', 1],
      ['spotify:track:1', 2],
    ]);
  });

  it('number hotkeys assign the matching target and ignore out-of-range indexes', async () => {
    getTrackSuggestions.mockResolvedValue([suggestion(5, 80), suggestion(6, 10)]);
    const { mocks } = setup({ playlists: [playlist(5), playlist(6)] });
    await screen.findByText('PL6');
    await flushEffects();

    act(() => lastHotkeys(mocks.registerHotkeys).togglePlaylist(1));
    expect(mocks.onAssign).toHaveBeenCalledWith('spotify:track:1', 6);

    mocks.onAssign.mockClear();
    act(() => lastHotkeys(mocks.registerHotkeys).togglePlaylist(8));
    expect(mocks.onAssign).not.toHaveBeenCalled();
  });

  it('skip, done and play hotkeys call their handlers', async () => {
    const { mocks } = setup();
    await flushEffects();
    const hotkeys = lastHotkeys(mocks.registerHotkeys);
    act(() => {
      hotkeys.skip();
      hotkeys.markDone();
      hotkeys.play();
    });
    expect(mocks.onSkip).toHaveBeenCalledWith('spotify:track:1');
    expect(mocks.onDone).toHaveBeenCalledTimes(1);
    expect(mocks.onPlay).toHaveBeenCalledWith('spotify:track:1');
  });

  it('open-in-spotify opens the track URI in a new tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { mocks } = setup();
    await flushEffects();
    act(() => lastHotkeys(mocks.registerHotkeys).openInSpotify());
    expect(open).toHaveBeenCalledWith('spotify:track:1', '_blank');
    open.mockRestore();
  });

  it('unregisters hotkeys on unmount', () => {
    const { mocks, unmount } = setup();
    unmount();
    expect(mocks.registerHotkeys).toHaveBeenLastCalledWith(null);
  });

  it('ignores a stale suggestions response after the track changes', async () => {
    let resolveFirst: (v: PlaylistSuggestion[]) => void = () => {};
    getTrackSuggestions
      .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce([suggestion(2, 80)]);

    const view = setup({ playlists: [playlist(1), playlist(2)] });
    view.rerender(<TriageView {...view.props} track={{ ...track, uri: 'spotify:track:2' }} />);
    await screen.findByText('PL2');

    await act(async () => resolveFirst([suggestion(1, 99)]));
    // PL1 is only ever shown as an unscored filler (no reason), never as the 99 suggestion
    await waitFor(() => expect(screen.queryByText('99 · because')).toBeNull());
  });
});

describe('TriageView queue and history', () => {
  const next = { ...track, uri: 'spotify:track:2', name: 'Song Two', artists: 'Artist B' };

  it('lists the up-next songs and selects one when clicked', async () => {
    const { mocks } = setup({ upNext: [next] });
    await userEvent.click(screen.getByRole('button', { name: /Song Two/ }));
    expect(mocks.onSelectTrack).toHaveBeenCalledWith('spotify:track:2');
  });

  it('says when nothing is queued', () => {
    setup();
    expect(screen.queryByText('Nothing queued.')).not.toBeNull();
  });

  it('shows the session history newest first, and Undo calls through', async () => {
    const { mocks } = setup({
      history: [
        { label: 'Assign to Chill', at: new Date(2026, 0, 1, 10, 0).getTime() },
        { label: 'Mark skipped', at: new Date(2026, 0, 1, 10, 5).getTime() },
      ],
    });
    const items = screen
      .getAllByRole('listitem')
      .map((li) => li.textContent ?? '')
      .filter((t) => /Assign to|Mark/.test(t));
    expect(items[0]).toContain('Mark skipped');
    expect(items[1]).toContain('Assign to Chill');

    await userEvent.click(screen.getByRole('button', { name: /Undo/ }));
    expect(mocks.onUndo).toHaveBeenCalledTimes(1);
  });

  it('disables Undo while the history is empty', () => {
    setup();
    expect((screen.getByRole('button', { name: /Undo/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('No actions yet.')).not.toBeNull();
  });
});

describe('TriageView covers', () => {
  it('shows cover art for the current song and the queue when available', () => {
    const { container } = setup({
      track: { ...track, imageUrl: 'http://img/1.jpg' },
      upNext: [{ ...track, uri: 'spotify:track:2', name: 'Two', imageUrl: 'http://img/2.jpg' }],
    });
    const sources = Array.from(container.querySelectorAll('img')).map((i) => i.getAttribute('src'));
    expect(sources).toEqual(expect.arrayContaining(['http://img/1.jpg', 'http://img/2.jpg']));
  });
});
