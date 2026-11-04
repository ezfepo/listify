import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type PlaylistSuggestion, type PlaylistView, type TrackView } from '../lib/api';
import { TriagePanel, type TriageHotkeys } from './TriagePanel';

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

function setup(overrides: Partial<ComponentProps<typeof TriagePanel>> = {}) {
  const mocks = {
    onAssign: vi.fn(),
    onSkip: vi.fn(),
    onDone: vi.fn(),
    onPlay: vi.fn(),
    registerHotkeys: vi.fn(),
  };
  const props: ComponentProps<typeof TriagePanel> = {
    track,
    queueLength: 12,
    playlists: [playlist(1), playlist(2), playlist(3)],
    ...mocks,
    ...overrides,
  };
  const view = render(<TriagePanel {...props} />);
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

describe('TriagePanel', () => {
  it('shows an empty state and clears hotkeys when there is no track', () => {
    const { mocks } = setup({ track: undefined });
    expect(screen.queryByText(/Inbox is empty/)).not.toBeNull();
    expect(getTrackSuggestions).not.toHaveBeenCalled();
    expect(mocks.registerHotkeys).toHaveBeenLastCalledWith(null);
  });

  it('shows the track, queue length, and fetches suggestions for it', async () => {
    getTrackSuggestions.mockResolvedValue([suggestion(1, 80)]);
    setup();
    expect(screen.queryByText('Song One')).not.toBeNull();
    expect(screen.queryByText('Artist A')).not.toBeNull();
    expect(screen.queryByText(/12 left in inbox/)).not.toBeNull();
    await screen.findByText('PL1');
    expect(getTrackSuggestions).toHaveBeenCalledWith('spotify:track:1');
  });

  it('shows at most 9 numbered suggestions', async () => {
    getTrackSuggestions.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => suggestion(i + 1, 70)),
    );
    setup();
    await screen.findByText('PL9');
    expect(screen.queryByText('PL10')).toBeNull();
  });

  it('clicking a suggestion assigns the track to that playlist and marks it assigned', async () => {
    getTrackSuggestions.mockResolvedValue([suggestion(2, 75)]);
    const { mocks } = setup();
    const button = (await screen.findByText('PL2')).closest('button') as HTMLButtonElement;

    await userEvent.click(button);
    expect(mocks.onAssign).toHaveBeenCalledWith('spotify:track:1', 2);
    expect(button.className).toContain('bg-green-800');
  });

  it('accept-suggestions hotkey assigns only suggestions at or above the threshold (60)', async () => {
    getTrackSuggestions.mockResolvedValue([
      suggestion(1, 90),
      suggestion(2, 60),
      suggestion(3, 59),
    ]);
    const { mocks } = setup();
    await screen.findByText('PL3');
    await flushEffects();

    act(() => lastHotkeys(mocks.registerHotkeys).acceptSuggestions());
    expect(mocks.onAssign.mock.calls).toEqual([
      ['spotify:track:1', 1],
      ['spotify:track:1', 2],
    ]);
  });

  it('number hotkeys toggle the matching suggestion and ignore out-of-range indexes', async () => {
    getTrackSuggestions.mockResolvedValue([suggestion(5, 80), suggestion(6, 10)]);
    const { mocks } = setup();
    await screen.findByText('PL6');
    await flushEffects();

    act(() => lastHotkeys(mocks.registerHotkeys).togglePlaylist(1));
    expect(mocks.onAssign).toHaveBeenCalledWith('spotify:track:1', 6);

    mocks.onAssign.mockClear();
    act(() => lastHotkeys(mocks.registerHotkeys).togglePlaylist(8));
    expect(mocks.onAssign).not.toHaveBeenCalled();
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
    expect(screen.queryByText(/Create a playlist in the left pane/)).not.toBeNull();
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

    const view = setup();
    view.rerender(<TriagePanel {...view.props} track={{ ...track, uri: 'spotify:track:2' }} />);
    await screen.findByText('PL2');

    await act(async () => resolveFirst([suggestion(1, 99)]));
    await waitFor(() => expect(screen.queryByText('PL1')).toBeNull());
  });
});
