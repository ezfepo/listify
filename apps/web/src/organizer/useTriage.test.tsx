import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type PlaylistSuggestion, type PlaylistView, type TrackView } from '../lib/api';
import { MAX_TARGETS, SUGGESTION_THRESHOLD, useTriage, type TriageHotkeys } from './useTriage';

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  api: { getTrackSuggestions: vi.fn() },
}));

const getTrackSuggestions = vi.mocked(api.getTrackSuggestions);

function track(overrides: Partial<TrackView> = {}): TrackView {
  return {
    uri: 'spotify:track:1',
    name: 'Song',
    artists: 'Artist',
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
    ...overrides,
  };
}

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

function setup(
  options: {
    track?: TrackView | undefined;
    playlists?: PlaylistView[];
  } = {},
) {
  const handlers = {
    onAssign: vi.fn(),
    onUnassign: vi.fn(),
    onSkip: vi.fn(),
    onDone: vi.fn(),
    onPlay: vi.fn(),
    registerHotkeys: vi.fn(),
  };
  const hook = renderHook(() =>
    useTriage({
      track: 'track' in options ? options.track : track(),
      playlists: options.playlists ?? [],
      ...handlers,
    }),
  );
  return { ...hook, ...handlers };
}

function hotkeys(registerHotkeys: ReturnType<typeof vi.fn>): TriageHotkeys {
  const registered = registerHotkeys.mock.calls.at(-1)?.[0] as TriageHotkeys | null | undefined;
  if (!registered) throw new Error('hotkeys not registered');
  return registered;
}

beforeEach(() => {
  getTrackSuggestions.mockReset();
  getTrackSuggestions.mockResolvedValue([]);
});

describe('useTriage targets', () => {
  it('orders suggestions best first, then fills with the remaining sub-playlists at score 0', async () => {
    getTrackSuggestions.mockResolvedValue([suggestion(1, 20), suggestion(3, 90)]);
    const { result } = setup({
      playlists: [
        playlist(1),
        playlist(2),
        playlist(3),
        playlist(4, 'main'),
        playlist(5, 'archive'),
      ],
    });

    await waitFor(() => expect(result.current.targets[0]?.playlistId).toBe(3));
    expect(result.current.targets.map((t) => t.playlistId)).toEqual([3, 1, 2]);
    expect(result.current.targets[2]).toMatchObject({ score: 0, reason: '' });
  });

  it(`never offers more than ${MAX_TARGETS}`, async () => {
    getTrackSuggestions.mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => suggestion(i + 1, 50 + i)),
    );
    const { result } = setup({ playlists: Array.from({ length: 15 }, (_, i) => playlist(i + 1)) });
    await waitFor(() => expect(result.current.targets[0]?.playlistId).toBe(15));
    expect(result.current.targets).toHaveLength(MAX_TARGETS);
  });

  it('has no targets and fetches nothing without a track', () => {
    const { result } = setup({ track: undefined });
    expect(getTrackSuggestions).not.toHaveBeenCalled();
    expect(result.current.targets).toEqual([]);
  });

  it('refetches when the track changes', async () => {
    getTrackSuggestions.mockResolvedValue([suggestion(1, 80)]);
    const handlers = {
      onAssign: vi.fn(),
      onUnassign: vi.fn(),
      onSkip: vi.fn(),
      onDone: vi.fn(),
      onPlay: vi.fn(),
      registerHotkeys: vi.fn(),
    };
    const { rerender } = renderHook(
      ({ uri }) => useTriage({ track: track({ uri }), playlists: [playlist(1)], ...handlers }),
      { initialProps: { uri: 'spotify:track:1' } },
    );
    await waitFor(() => expect(getTrackSuggestions).toHaveBeenCalledWith('spotify:track:1'));
    rerender({ uri: 'spotify:track:2' });
    await waitFor(() => expect(getTrackSuggestions).toHaveBeenCalledWith('spotify:track:2'));
  });
});

describe('useTriage actions', () => {
  it('toggle assigns when absent and unassigns when the track is already in the playlist', () => {
    const absent = setup();
    act(() => absent.result.current.toggle(5));
    expect(absent.onAssign).toHaveBeenCalledWith('spotify:track:1', 5);

    const present = setup({ track: track({ playlists: [{ id: 5, name: 'PL5' }] }) });
    expect(present.result.current.assignedIds.has(5)).toBe(true);
    act(() => present.result.current.toggle(5));
    expect(present.onUnassign).toHaveBeenCalledWith('spotify:track:1', 5);
    expect(present.onAssign).not.toHaveBeenCalled();
  });

  it('toggle and acceptSuggestions do nothing without a track', () => {
    const { result, onAssign, onUnassign } = setup({ track: undefined });
    act(() => {
      result.current.toggle(1);
      result.current.acceptSuggestions();
    });
    expect(onAssign).not.toHaveBeenCalled();
    expect(onUnassign).not.toHaveBeenCalled();
  });

  it(`acceptSuggestions assigns targets scoring ${SUGGESTION_THRESHOLD}+ that are not already assigned`, async () => {
    getTrackSuggestions.mockResolvedValue([
      suggestion(1, 90),
      suggestion(2, 60),
      suggestion(3, 59),
      suggestion(4, 95),
    ]);
    const { result, onAssign } = setup({
      track: track({ playlists: [{ id: 4, name: 'PL4' }] }),
      playlists: [playlist(1), playlist(2), playlist(3), playlist(4)],
    });
    // wait for the suggestions themselves, not just the filler playlists
    await waitFor(() => expect(result.current.targets[0]?.score).toBe(95));

    act(() => result.current.acceptSuggestions());

    expect(onAssign.mock.calls).toEqual([
      ['spotify:track:1', 1],
      ['spotify:track:1', 2],
    ]);
  });
});

describe('useTriage hotkeys', () => {
  it('registers none without a track, and unregisters on unmount', () => {
    const none = setup({ track: undefined });
    expect(none.registerHotkeys).toHaveBeenLastCalledWith(null);

    const { registerHotkeys, unmount } = setup();
    expect(hotkeys(registerHotkeys)).toBeTruthy();
    unmount();
    expect(registerHotkeys).toHaveBeenLastCalledWith(null);
  });

  it('skip, done and play use the current track', () => {
    const { registerHotkeys, onSkip, onDone, onPlay } = setup();
    const keys = hotkeys(registerHotkeys);
    keys.skip();
    keys.markDone();
    keys.play();
    expect(onSkip).toHaveBeenCalledWith('spotify:track:1');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith('spotify:track:1');
  });

  it('number keys past the last target do nothing', async () => {
    getTrackSuggestions.mockResolvedValue([suggestion(1, 80)]);
    const { result, registerHotkeys, onAssign } = setup({ playlists: [playlist(1)] });
    await waitFor(() => expect(result.current.targets[0]?.score).toBe(80));

    act(() => hotkeys(registerHotkeys).togglePlaylist(4));
    expect(onAssign).not.toHaveBeenCalled();
    act(() => hotkeys(registerHotkeys).togglePlaylist(0));
    expect(onAssign).toHaveBeenCalledWith('spotify:track:1', 1);
  });
});
