import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, type LibraryResponse, type PlaylistView, type TrackView } from '../lib/api';
import { connectServerEvents, resetServerEvents } from '../lib/serverEvents';
import { Organizer, type WorkspaceMode } from './Organizer';
import { UndoIndicatorDisplay, UndoIndicatorProvider } from './UndoIndicator';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 44,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 44,
        size: 44,
      })),
  }),
}));

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>();
  return {
    ...original,
    api: {
      getLibrary: vi.fn(),
      getTracks: vi.fn(),
      createPlaylist: vi.fn(),
      deletePlaylist: vi.fn(),
      assignTrack: vi.fn(),
      unassignTrack: vi.fn(),
      setTrackStatus: vi.fn(),
      bulkAssign: vi.fn(),
      bulkUnassign: vi.fn(),
      getTrackSuggestions: vi.fn(),
      getPlaylistSuggestions: vi.fn(),
      getRecipe: vi.fn(),
      putRecipe: vi.fn(),
      playTrack: vi.fn(),
    },
  };
});

const mocked = vi.mocked(api);

function track(n: number, overrides: Partial<TrackView> = {}): TrackView {
  return {
    uri: `spotify:track:${n}`,
    name: `Track ${n}`,
    artists: `Artist ${n}`,
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

function playlist(
  id: number,
  kind: PlaylistView['kind'],
  name: string,
  trackCount = 0,
): PlaylistView {
  return {
    id,
    spotifyId: null,
    name,
    kind,
    criteriaNote: null,
    emoji: null,
    color: null,
    sortOrder: id,
    trackCount,
  };
}

const T1 = track(1);
const T2 = track(2);
const T3 = track(3, {
  status: 'organized',
  inMain: false,
  inArchive: true,
  playlists: [{ id: 10, name: 'Chill' }],
});
const ALL = [T1, T2, T3];

const LIBRARY: LibraryResponse = {
  playlists: [
    playlist(1, 'main', 'Main', 2),
    playlist(2, 'archive', 'Main – Archive', 1),
    playlist(10, 'sub', 'Chill', 1),
    playlist(11, 'sub', 'Gym', 0),
  ],
  statusCounts: { inbox: 2, organized: 1, skipped: 0 },
};

function Harness({ initialMode }: { initialMode: WorkspaceMode }) {
  const [mode, setMode] = useState<WorkspaceMode>(initialMode);
  return <Organizer mode={mode} onModeChange={setMode} />;
}

function tree(client: QueryClient, withOrganizer = true, initialMode: WorkspaceMode = 'organize') {
  return (
    <QueryClientProvider client={client}>
      <UndoIndicatorProvider>
        <UndoIndicatorDisplay />
        {withOrganizer && <Harness initialMode={initialMode} />}
      </UndoIndicatorProvider>
    </QueryClientProvider>
  );
}

function renderOrganizer(initialMode: WorkspaceMode = 'organize') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(tree(client, true, initialMode));
  return { ...view, removeOrganizer: () => view.rerender(tree(client, false)) };
}

/** Playlist tiles live in the shelf; table rows also have playlist chips with the same names. */
function shelfButton(name: RegExp): HTMLElement {
  return within(screen.getByRole('group', { name: 'Playlists' })).getByRole('button', { name });
}

function tableRow(name: string): HTMLElement {
  const button = screen.getAllByTitle('Inspect song').find((b) => b.textContent?.includes(name));
  if (!button) throw new Error(`no table row for ${name}`);
  return button.closest('[style*="position: absolute"]') as HTMLElement;
}

function tableNames(): string[] {
  return screen.getAllByTitle('Inspect song').map((b) => b.querySelector('div')?.textContent ?? '');
}

async function loaded() {
  await screen.findByText('Main – Archive');
  await waitFor(() => expect(screen.queryAllByTitle('Inspect song').length).toBeGreaterThan(0));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocked.getLibrary.mockResolvedValue(LIBRARY);
  mocked.getTracks.mockImplementation(async (params = {}) => {
    const items = ALL.filter((t) => !params.status || t.status === params.status).filter(
      (t) => !params.q || t.name.toLowerCase().includes(params.q.toLowerCase()),
    );
    return { total: items.length, items };
  });
  mocked.getTrackSuggestions.mockResolvedValue([]);
  mocked.getPlaylistSuggestions.mockResolvedValue([]);
  mocked.getRecipe.mockResolvedValue({
    playlistId: 10,
    includeTags: [],
    excludeTags: [],
    featureRanges: {},
  });
  mocked.assignTrack.mockResolvedValue(undefined);
  mocked.unassignTrack.mockResolvedValue(undefined);
  mocked.bulkAssign.mockResolvedValue(undefined);
  mocked.bulkUnassign.mockResolvedValue(undefined);
  mocked.setTrackStatus.mockResolvedValue(undefined);
  mocked.createPlaylist.mockResolvedValue(playlist(12, 'sub', 'New'));
  mocked.deletePlaylist.mockResolvedValue(undefined);
  mocked.playTrack.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Organizer loading and layout', () => {
  it('shows a loading message, then the library and tracks', async () => {
    renderOrganizer();
    expect(screen.queryByText(/Loading your library/)).not.toBeNull();

    await loaded();
    expect(tableNames()).toEqual(['Track 1', 'Track 2', 'Track 3']);
  });

  it('shows the progress card from the library status counts (1 of 3 organized = 33%)', async () => {
    renderOrganizer();
    await loaded();
    expect(screen.queryByText('33%')).not.toBeNull();
    expect(
      screen.getByRole('progressbar', { name: 'Organized' }).getAttribute('aria-valuenow'),
    ).toBe('33');
  });

  it('triage mode starts on the first inbox track', async () => {
    renderOrganizer('triage');
    await screen.findByText(/2 left in inbox/);
    expect(screen.getByRole('heading', { name: 'Track 1' })).toBeTruthy();
  });
});

describe('Organizer filtering', () => {
  it('a status tab requests only that status', async () => {
    renderOrganizer();
    await loaded();

    await userEvent.click(screen.getByRole('button', { name: /Organized/ }));

    await waitFor(() => expect(tableNames()).toEqual(['Track 3']));
    expect(mocked.getTracks).toHaveBeenCalledWith({ status: 'organized', q: undefined });
  });

  it('selecting a sub-playlist shows its tracks regardless of status, and drops the status filter', async () => {
    renderOrganizer();
    await loaded();

    await userEvent.click(screen.getByRole('button', { name: /Inbox/ }));
    await waitFor(() => expect(tableNames()).toEqual(['Track 1', 'Track 2']));

    await userEvent.click(shelfButton(/^Chill/));
    await waitFor(() => expect(tableNames()).toEqual(['Track 3']));
    expect(mocked.getTracks).toHaveBeenLastCalledWith({ status: undefined, q: undefined });
  });

  it('Main and Archive filter by membership', async () => {
    renderOrganizer();
    await loaded();

    await userEvent.click(shelfButton(/^Main\s*2$/));
    expect(tableNames()).toEqual(['Track 1', 'Track 2']);

    await userEvent.click(shelfButton(/Archive/));
    expect(tableNames()).toEqual(['Track 3']);
  });

  it('clicking the selected playlist again returns to the full list', async () => {
    renderOrganizer();
    await loaded();
    const chill = shelfButton(/^Chill/);

    await userEvent.click(chill);
    await userEvent.click(chill);
    await waitFor(() => expect(tableNames()).toHaveLength(3));
  });

  it('searching passes the query to the API', async () => {
    renderOrganizer();
    await loaded();

    await userEvent.type(screen.getByPlaceholderText(/Search name or artist/), 'Track 2');

    await waitFor(() => expect(tableNames()).toEqual(['Track 2']));
    expect(mocked.getTracks).toHaveBeenCalledWith({ status: undefined, q: 'Track 2' });
  });
});

describe('Organizer assign / unassign with undo', () => {
  it('assigns from a row, refreshes data, and shows the undoable action in the header', async () => {
    renderOrganizer();
    await loaded();
    const libraryCalls = mocked.getLibrary.mock.calls.length;

    await userEvent.selectOptions(within(tableRow('Track 1')).getByRole('combobox'), 'Gym');

    await waitFor(() => expect(mocked.assignTrack).toHaveBeenCalledWith('spotify:track:1', 11));
    await screen.findByText(/Last action: Assign to Gym/);
    await waitFor(() => expect(mocked.getLibrary.mock.calls.length).toBeGreaterThan(libraryCalls));
  });

  it('pressing u undoes the last assignment', async () => {
    renderOrganizer();
    await loaded();
    await userEvent.selectOptions(within(tableRow('Track 1')).getByRole('combobox'), 'Gym');
    await screen.findByText(/Last action: Assign to Gym/);

    await userEvent.keyboard('u');

    await waitFor(() => expect(mocked.unassignTrack).toHaveBeenCalledWith('spotify:track:1', 11));
    await waitFor(() => expect(screen.queryByText(/Last action/)).toBeNull());
  });

  it('unassigning a chip can be undone by re-assigning', async () => {
    renderOrganizer();
    await loaded();

    await userEvent.click(within(tableRow('Track 3')).getByTitle('Click to unassign'));
    await waitFor(() => expect(mocked.unassignTrack).toHaveBeenCalledWith('spotify:track:3', 10));
    await screen.findByText(/Last action: Unassign/);

    await userEvent.keyboard('u');
    await waitFor(() => expect(mocked.assignTrack).toHaveBeenCalledWith('spotify:track:3', 10));
  });

  it('bulk assign uses the selected rows, clears the selection, and undoes with bulkUnassign', async () => {
    renderOrganizer();
    await loaded();

    await userEvent.click(within(tableRow('Track 1')).getByRole('checkbox'));
    await userEvent.click(within(tableRow('Track 2')).getByRole('checkbox'));
    expect(screen.queryByText('2 selected')).not.toBeNull();

    await userEvent.selectOptions(screen.getByLabelText('Target playlist'), 'Gym');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() =>
      expect(mocked.bulkAssign).toHaveBeenCalledWith(['spotify:track:1', 'spotify:track:2'], 11),
    );
    await screen.findByText(/Last action: Assign 2 to Gym/);
    await waitFor(() => expect(screen.queryByText(/selected/)).toBeNull());

    await userEvent.keyboard('u');
    await waitFor(() =>
      expect(mocked.bulkUnassign).toHaveBeenCalledWith(['spotify:track:1', 'spotify:track:2'], 11),
    );
  });

  it('undo does nothing when there is nothing to undo', async () => {
    renderOrganizer();
    await loaded();
    await userEvent.keyboard('u');
    expect(mocked.unassignTrack).not.toHaveBeenCalled();
    expect(mocked.assignTrack).not.toHaveBeenCalled();
  });
});

describe('Organizer skipping', () => {
  it('skipping from triage marks the track skipped', async () => {
    renderOrganizer('triage');
    await screen.findByText(/2 left in inbox/);

    await userEvent.click(screen.getByRole('button', { name: /^Skip/ }));

    await waitFor(() =>
      expect(mocked.setTrackStatus).toHaveBeenCalledWith('spotify:track:1', 'skipped'),
    );
    await screen.findByText(/Last action: Mark skipped/);
  });

  it('undoing a skip restores the playlists it was removed from and the previous status', async () => {
    mocked.setTrackStatus.mockResolvedValueOnce({ removedFromPlaylistIds: [10, 11] });
    renderOrganizer();
    await loaded();

    await userEvent.click(within(tableRow('Track 3')).getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Skip' })); // bulk skip
    await screen.findByText(/Last action: Mark skipped/);

    await userEvent.keyboard('u');

    await waitFor(() => expect(mocked.setTrackStatus).toHaveBeenCalledTimes(2));
    expect(mocked.assignTrack.mock.calls).toEqual([
      ['spotify:track:3', 10],
      ['spotify:track:3', 11],
    ]);
    expect(mocked.setTrackStatus).toHaveBeenLastCalledWith('spotify:track:3', 'organized');
  });
});

describe('Organizer keyboard shortcuts', () => {
  it('"/" focuses the search box', async () => {
    renderOrganizer();
    await loaded();

    await userEvent.keyboard('/');
    expect(document.activeElement).toBe(screen.getByPlaceholderText(/Search name or artist/));
  });

  it('ignores shortcuts while typing in an input', async () => {
    renderOrganizer();
    await loaded();
    await userEvent.selectOptions(within(tableRow('Track 1')).getByRole('combobox'), 'Gym');
    await screen.findByText(/Last action: Assign to Gym/);

    await userEvent.type(screen.getByPlaceholderText(/Search name or artist/), 'u');

    expect(mocked.unassignTrack).not.toHaveBeenCalled();
  });

  it('j / k move through the inbox queue in triage', async () => {
    renderOrganizer('triage');
    await screen.findByText(/left in inbox/);
    const panelTitle = () => screen.getAllByText(/^Track \d$/).map((n) => n.textContent);
    expect(panelTitle()).toContain('Track 1');

    await userEvent.keyboard('j');
    await waitFor(() =>
      expect(mocked.getTrackSuggestions).toHaveBeenLastCalledWith('spotify:track:2'),
    );

    await userEvent.keyboard('j'); // clamps at the end of a 2-track queue
    expect(mocked.getTrackSuggestions).toHaveBeenLastCalledWith('spotify:track:2');

    await userEvent.keyboard('k');
    await waitFor(() =>
      expect(mocked.getTrackSuggestions).toHaveBeenLastCalledWith('spotify:track:1'),
    );
  });

  it('"s" skips the current triage track and "Enter" advances back to the start', async () => {
    renderOrganizer('triage');
    await screen.findByText(/left in inbox/);
    await userEvent.keyboard('j');

    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(mocked.getTrackSuggestions).toHaveBeenLastCalledWith('spotify:track:1'),
    );

    await userEvent.keyboard('s');
    await waitFor(() =>
      expect(mocked.setTrackStatus).toHaveBeenCalledWith('spotify:track:1', 'skipped'),
    );
  });

  it('number keys assign the matching suggestion', async () => {
    mocked.getTrackSuggestions.mockResolvedValue([
      { playlistId: 11, playlistName: 'Gym', score: 90, reason: 'tags' },
    ]);
    renderOrganizer('triage');
    await screen.findByText(/left in inbox/);
    await screen.findByText(/90 · tags/);

    await userEvent.keyboard('1');

    await waitFor(() => expect(mocked.assignTrack).toHaveBeenCalledWith('spotify:track:1', 11));
  });

  it('"o" opens the current track in Spotify', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderOrganizer('triage');
    await screen.findByText(/left in inbox/);
    await waitFor(() => expect(mocked.getTrackSuggestions).toHaveBeenCalled());

    await userEvent.keyboard('o');
    expect(open).toHaveBeenCalledWith('spotify:track:1', '_blank');
    open.mockRestore();
  });

  it('space plays the current track', async () => {
    renderOrganizer('triage');
    await screen.findByText(/left in inbox/);
    await waitFor(() => expect(mocked.getTrackSuggestions).toHaveBeenCalled());

    await userEvent.keyboard(' ');
    await waitFor(() => expect(mocked.playTrack).toHaveBeenCalledWith('spotify:track:1'));
  });

  it('triage hotkeys do nothing in Organize', async () => {
    renderOrganizer();
    await loaded();
    await userEvent.keyboard('j');
    await userEvent.keyboard('s');
    await userEvent.keyboard(' ');
    expect(mocked.setTrackStatus).not.toHaveBeenCalled();
    expect(mocked.playTrack).not.toHaveBeenCalled();
  });

  it('"a" accepts every suggestion at or above 60 in triage', async () => {
    mocked.getTrackSuggestions.mockResolvedValue([
      { playlistId: 10, playlistName: 'Chill', score: 80, reason: 'tags' },
      { playlistId: 11, playlistName: 'Gym', score: 40, reason: 'energy' },
    ]);
    renderOrganizer('triage');
    await screen.findByText(/80 · tags/);

    await userEvent.keyboard('a');

    await waitFor(() => expect(mocked.assignTrack).toHaveBeenCalledWith('spotify:track:1', 10));
    expect(mocked.assignTrack).not.toHaveBeenCalledWith('spotify:track:1', 11);
  });
});

describe('Organizer views: inspector and hand-off', () => {
  it('clicking a row focuses it in the inspector', async () => {
    renderOrganizer();
    await loaded();
    expect(screen.queryByRole('button', { name: 'Open in Triage' })).toBeNull();

    await userEvent.click(within(tableRow('Track 3')).getByTitle('Inspect song'));

    await screen.findByRole('button', { name: 'Open in Triage' });
    expect(mocked.getTrackSuggestions).toHaveBeenCalledWith('spotify:track:3');
  });

  it('Open in Triage starts triage on the focused song', async () => {
    renderOrganizer();
    await loaded();
    await userEvent.click(within(tableRow('Track 3')).getByTitle('Inspect song'));
    await userEvent.click(await screen.findByRole('button', { name: 'Open in Triage' }));

    expect(screen.getByRole('heading', { name: 'Track 3' })).toBeTruthy();
  });

  it('"Triage the next song" starts on the first inbox song even if another was focused', async () => {
    renderOrganizer();
    await loaded();
    await userEvent.click(within(tableRow('Track 3')).getByTitle('Inspect song'));

    await userEvent.click(screen.getByRole('button', { name: /Triage the next song/ }));

    expect(screen.getByRole('heading', { name: 'Track 1' })).toBeTruthy();
  });

  it('"t" toggles between Organize and Triage', async () => {
    renderOrganizer();
    await loaded();

    await userEvent.keyboard('t');
    expect(screen.getByRole('heading', { name: 'Track 1' })).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Search name or artist/)).toBeNull();

    await userEvent.keyboard('t');
    await loaded();
    expect(screen.queryByPlaceholderText(/Search name or artist/)).not.toBeNull();
  });

  it('"t" is ignored while typing in an input', async () => {
    renderOrganizer();
    await loaded();
    await userEvent.type(screen.getByPlaceholderText(/Search name or artist/), 't');
    expect(screen.queryByPlaceholderText(/Search name or artist/)).not.toBeNull();
  });

  it('leaving Triage returns to Organize with the triaged song focused', async () => {
    renderOrganizer('triage');
    await screen.findByText(/2 left in inbox/);
    await userEvent.keyboard('j'); // now on Track 2

    await userEvent.keyboard('t');

    await loaded();
    // the inspector is showing a song, and it is Track 2
    await screen.findByRole('button', { name: 'Open in Triage' });
    expect(mocked.getTrackSuggestions).toHaveBeenLastCalledWith('spotify:track:2');
  });

  it('shows the floating bulk bar only while rows are selected', async () => {
    renderOrganizer();
    await loaded();
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull();

    await userEvent.click(within(tableRow('Track 1')).getByRole('checkbox'));
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull();
  });

  it('the triage history column lists session actions and Undo reverses the last one', async () => {
    mocked.getTrackSuggestions.mockResolvedValue([
      { playlistId: 10, playlistName: 'Chill', score: 80, reason: 'tags' },
    ]);
    renderOrganizer('triage');
    await screen.findByText(/80 · tags/);

    await userEvent.keyboard('s');
    const history = screen.getByRole('complementary', { name: 'Session history' });
    await within(history).findByText('Mark skipped');

    await userEvent.click(within(history).getByRole('button', { name: /Undo/ }));
    await waitFor(() =>
      expect(mocked.setTrackStatus).toHaveBeenLastCalledWith('spotify:track:1', 'inbox'),
    );
    await waitFor(() => expect(within(history).queryByText('Mark skipped')).toBeNull());
  });
});

describe('Organizer errors and toasts', () => {
  it('shows the API error message when an assignment fails', async () => {
    mocked.assignTrack.mockRejectedValue(new ApiError(404, 'Playlist not found'));
    renderOrganizer();
    await loaded();

    await userEvent.selectOptions(within(tableRow('Track 1')).getByRole('combobox'), 'Gym');

    await screen.findByText('Playlist not found');
    expect(screen.queryByText(/Last action/)).toBeNull(); // nothing to undo
  });

  it('shows a generic message for unexpected errors', async () => {
    mocked.assignTrack.mockRejectedValue(new Error('network down'));
    renderOrganizer();
    await loaded();

    await userEvent.selectOptions(within(tableRow('Track 1')).getByRole('combobox'), 'Gym');
    await screen.findByText('Something went wrong');
  });

  it('tells the user when there is no active device to play on', async () => {
    mocked.playTrack.mockRejectedValue(new ApiError(404, 'no device'));
    renderOrganizer();
    await loaded();

    await userEvent.click(within(tableRow('Track 1')).getByTitle('Play on active device'));
    await screen.findByText('No active Spotify device to play on.');
  });

  it('dismisses a toast after 3 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocked.assignTrack.mockRejectedValue(new Error('x'));
    renderOrganizer();
    await loaded();

    await userEvent.selectOptions(within(tableRow('Track 1')).getByRole('combobox'), 'Gym');
    await screen.findByText('Something went wrong');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });
});

describe('Organizer playlist management', () => {
  it('creates a playlist and refreshes the library', async () => {
    renderOrganizer();
    await loaded();
    const calls = mocked.getLibrary.mock.calls.length;

    await userEvent.type(screen.getByPlaceholderText('New playlist…'), 'Road trip{Enter}');

    await waitFor(() => expect(mocked.createPlaylist).toHaveBeenCalledWith({ name: 'Road trip' }));
    await waitFor(() => expect(mocked.getLibrary.mock.calls.length).toBeGreaterThan(calls));
  });

  it('deleting the selected playlist deselects it', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderOrganizer();
    await loaded();
    await userEvent.click(shelfButton(/^Chill/));
    await waitFor(() => expect(tableNames()).toEqual(['Track 3']));

    const row = shelfButton(/^Chill/).parentElement as HTMLElement;
    await userEvent.click(within(row).getByTitle('Delete playlist'));

    await waitFor(() => expect(mocked.deletePlaylist).toHaveBeenCalledWith(10));
    await waitFor(() => expect(tableNames()).toHaveLength(3));
  });

  it('opens the recipe editor for a playlist and closes it again', async () => {
    renderOrganizer();
    await loaded();
    const row = shelfButton(/^Chill/).parentElement as HTMLElement;

    await userEvent.click(within(row).getByTitle('Edit recipe'));
    await screen.findByText('Recipe: Chill');
    expect(mocked.getRecipe).toHaveBeenCalledWith(10);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Recipe: Chill')).toBeNull());
  });
});

describe('Organizer auto-sort', () => {
  it('is disabled until a sub-playlist is selected, then shows the auto-sort panel', async () => {
    mocked.getPlaylistSuggestions.mockResolvedValue([
      { uri: 'spotify:track:2', name: 'Track 2', artists: 'Artist 2', score: 77, reason: 'tags' },
    ]);
    renderOrganizer();
    await loaded();
    const tab = screen.getByRole('button', { name: 'Auto-sort' }) as HTMLButtonElement;
    expect(tab.disabled).toBe(true);

    // Main is a library entry, not a sub-playlist: still disabled
    await userEvent.click(shelfButton(/^Main\s*2$/));
    expect(tab.disabled).toBe(true);

    await userEvent.click(shelfButton(/^Gym/));
    expect(tab.disabled).toBe(false);

    await userEvent.click(tab);
    await screen.findByText('Auto-sort: Gym');
    expect(mocked.getPlaylistSuggestions).toHaveBeenCalledWith(11, 100);
  });

  it('bulk-assigns from the auto-sort panel', async () => {
    mocked.getPlaylistSuggestions.mockResolvedValue([
      { uri: 'spotify:track:2', name: 'Cand', artists: 'Artist', score: 77, reason: 'tags' },
    ]);
    renderOrganizer();
    await loaded();
    await userEvent.click(shelfButton(/^Gym/));
    await userEvent.click(screen.getByRole('button', { name: 'Auto-sort' }));
    await screen.findByText('Cand');

    await userEvent.click(screen.getByRole('checkbox', { name: /Cand/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Assign 1 to Gym/ }));

    await waitFor(() => expect(mocked.bulkAssign).toHaveBeenCalledWith(['spotify:track:2'], 11));
  });
});

describe('Organizer cleanup', () => {
  it('clears the header undo label when the Organizer unmounts, so it does not linger elsewhere', async () => {
    const { removeOrganizer } = renderOrganizer();
    await loaded();
    await userEvent.selectOptions(within(tableRow('Track 1')).getByRole('combobox'), 'Gym');
    await screen.findByText(/Last action/);

    removeOrganizer();

    await waitFor(() => expect(screen.queryByText(/Last action/)).toBeNull());
  });
});

describe('Organizer triage flow robustness', () => {
  /** Makes assign/unassign behave like the server: assigning moves a track out of the inbox. */
  function statefulServer() {
    const memberships = new Map<string, number[]>();
    const view = (t: TrackView): TrackView => {
      const ids = memberships.get(t.uri) ?? [];
      return {
        ...t,
        status: ids.length ? 'organized' : t.status,
        playlists: ids.map((id) => ({ id, name: id === 10 ? 'Chill' : 'Gym' })),
      };
    };
    mocked.getTracks.mockImplementation(async (params = {}) => {
      const items = ALL.map(view).filter((t) => !params.status || t.status === params.status);
      return { total: items.length, items };
    });
    mocked.assignTrack.mockImplementation(async (uri, id) => {
      memberships.set(uri, [...(memberships.get(uri) ?? []), id]);
    });
    mocked.unassignTrack.mockImplementation(async (uri, id) => {
      memberships.set(
        uri,
        (memberships.get(uri) ?? []).filter((x) => x !== id),
      );
    });
  }

  const TWO = [
    { playlistId: 10, playlistName: 'Chill', score: 90, reason: 'tags' },
    { playlistId: 11, playlistName: 'Gym', score: 80, reason: 'energy' },
  ];

  const tile = (name: RegExp) => screen.getByRole('button', { name, pressed: undefined });

  it('keeps the song on stage after the first assignment, so a second key lands on the same song', async () => {
    statefulServer();
    mocked.getTrackSuggestions.mockResolvedValue(TWO);
    renderOrganizer('triage');
    await screen.findByText(/90 · tags/);

    await userEvent.keyboard('1');
    await waitFor(() => expect(tile(/^Chill/).getAttribute('aria-pressed')).toBe('true'));
    await userEvent.keyboard('2');

    await waitFor(() => expect(mocked.assignTrack).toHaveBeenCalledTimes(2));
    expect(mocked.assignTrack.mock.calls).toEqual([
      ['spotify:track:1', 10],
      ['spotify:track:1', 11],
    ]);
    expect(screen.getByRole('heading', { name: 'Track 1' })).toBeTruthy();
  });

  it('pressing the same number again takes the song out of that playlist', async () => {
    statefulServer();
    mocked.getTrackSuggestions.mockResolvedValue(TWO);
    renderOrganizer('triage');
    await screen.findByText(/90 · tags/);

    await userEvent.keyboard('1');
    await waitFor(() => expect(tile(/^Chill/).getAttribute('aria-pressed')).toBe('true'));
    await userEvent.keyboard('1');

    await waitFor(() => expect(mocked.unassignTrack).toHaveBeenCalledWith('spotify:track:1', 10));
  });

  it('records triage assignments in the session history, and undo clears the tile', async () => {
    statefulServer();
    mocked.getTrackSuggestions.mockResolvedValue(TWO);
    renderOrganizer('triage');
    await screen.findByText(/90 · tags/);

    await userEvent.keyboard('1');
    const history = screen.getByRole('complementary', { name: 'Session history' });
    await within(history).findByText('Assign to Chill');

    await userEvent.keyboard('u');
    await waitFor(() => expect(mocked.unassignTrack).toHaveBeenCalledWith('spotify:track:1', 10));
    await waitFor(() => expect(tile(/^Chill/).getAttribute('aria-pressed')).toBe('false'));
  });

  it('Enter on a focused button activates that button instead of the Done hotkey', async () => {
    renderOrganizer('triage');
    await screen.findByText(/left in inbox/);
    await userEvent.keyboard('j'); // now on Track 2
    await waitFor(() =>
      expect(mocked.getTrackSuggestions).toHaveBeenLastCalledWith('spotify:track:2'),
    );
    const play = screen.getByRole('button', { name: /Play/ });
    play.focus();

    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(mocked.playTrack).toHaveBeenCalledWith('spotify:track:2'));
    // Done would have reset to Track 1
    expect(screen.getByRole('heading', { name: 'Track 2' })).toBeTruthy();
  });

  it('ignores global hotkeys while the recipe editor is open', async () => {
    renderOrganizer();
    await loaded();
    await userEvent.click(
      within(shelfButton(/^Chill/).parentElement as HTMLElement).getByTitle('Edit recipe'),
    );
    await screen.findByText('Recipe: Chill');

    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard('t');

    expect(screen.queryByPlaceholderText(/Search name or artist/)).not.toBeNull();
  });

  it('falls back to the inspector when the playlist behind Auto-sort is deselected', async () => {
    renderOrganizer();
    await loaded();
    await userEvent.click(shelfButton(/^Gym/));
    await userEvent.click(screen.getByRole('button', { name: 'Auto-sort' }));
    await screen.findByText('Auto-sort: Gym');

    await userEvent.click(shelfButton(/^Gym/)); // deselect

    expect(screen.queryByText('Auto-sort: Gym')).toBeNull();
    expect(screen.queryByText(/Select a song/)).not.toBeNull();
    expect((screen.getByRole('button', { name: 'Auto-sort' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe('Organizer: remaining paths', () => {
  it('shows a toast when each kind of change fails', async () => {
    mocked.unassignTrack.mockRejectedValue(new ApiError(500, 'unassign failed'));
    mocked.bulkAssign.mockRejectedValue(new ApiError(500, 'bulk assign failed'));
    mocked.bulkUnassign.mockRejectedValue(new ApiError(500, 'bulk unassign failed'));
    mocked.setTrackStatus.mockRejectedValue(new ApiError(500, 'status failed'));
    mocked.createPlaylist.mockRejectedValue(new ApiError(500, 'create failed'));
    mocked.deletePlaylist.mockRejectedValue(new ApiError(500, 'delete failed'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderOrganizer();
    await loaded();

    await userEvent.click(within(tableRow('Track 3')).getByTitle('Click to unassign'));
    await screen.findByText('unassign failed');

    await userEvent.click(within(tableRow('Track 1')).getByTitle(/Reset: unassign/));
    await screen.findByText('status failed');

    await userEvent.type(screen.getByPlaceholderText('New playlist…'), 'X{Enter}');
    await screen.findByText('create failed');

    await userEvent.click(
      within(shelfButton(/^Gym/).parentElement as HTMLElement).getByTitle('Delete playlist'),
    );
    await screen.findByText('delete failed');

    await userEvent.click(within(tableRow('Track 1')).getByRole('checkbox'));
    await userEvent.selectOptions(screen.getByLabelText('Target playlist'), 'Gym');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await screen.findByText('bulk assign failed');

    await userEvent.selectOptions(screen.getByLabelText('Target playlist'), 'Gym');
    await userEvent.click(screen.getByRole('button', { name: 'Unassign' }));
    await screen.findByText('bulk unassign failed');
  });

  it('bulk unassign removes the selection from the playlist and undo puts it back', async () => {
    renderOrganizer();
    await loaded();
    await userEvent.click(within(tableRow('Track 1')).getByRole('checkbox'));
    await userEvent.click(within(tableRow('Track 2')).getByRole('checkbox'));

    await userEvent.selectOptions(screen.getByLabelText('Target playlist'), 'Chill');
    await userEvent.click(screen.getByRole('button', { name: 'Unassign' }));

    await waitFor(() =>
      expect(mocked.bulkUnassign).toHaveBeenCalledWith(['spotify:track:1', 'spotify:track:2'], 10),
    );
    await screen.findByText(/Last action: Unassign 2 from Chill/);
    await waitFor(() => expect(screen.queryByText(/selected/)).toBeNull());

    await userEvent.keyboard('u');
    await waitFor(() =>
      expect(mocked.bulkAssign).toHaveBeenCalledWith(['spotify:track:1', 'spotify:track:2'], 10),
    );
  });

  it('a row can be selected and deselected, and the header checkbox selects every row', async () => {
    renderOrganizer();
    await loaded();
    const box = within(tableRow('Track 1')).getByRole('checkbox');

    await userEvent.click(box);
    expect(screen.queryByText('1 selected')).not.toBeNull();
    await userEvent.click(box);
    expect(screen.queryByText(/selected/)).toBeNull();

    await userEvent.click(screen.getByTitle('Select all'));
    expect(screen.queryByText('3 selected')).not.toBeNull();
    await userEvent.click(screen.getByTitle('Select all'));
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it('switches between the Inspector and Auto-sort tabs', async () => {
    renderOrganizer();
    await loaded();
    await userEvent.click(shelfButton(/^Gym/));
    await userEvent.click(screen.getByRole('button', { name: 'Auto-sort' }));
    await screen.findByText('Auto-sort: Gym');

    await userEvent.click(screen.getByRole('button', { name: 'Inspector' }));

    expect(screen.queryByText('Auto-sort: Gym')).toBeNull();
    expect(screen.queryByText(/Select a song/)).not.toBeNull();
  });

  it('handles key presses dispatched on the window itself (not an element)', async () => {
    renderOrganizer();
    await loaded();
    fireEvent.keyDown(window, { key: 't' });
    expect(screen.queryByPlaceholderText(/Search name or artist/)).toBeNull();
  });

  it('ignores shortcuts combined with Ctrl, Meta or Alt', async () => {
    renderOrganizer();
    await loaded();
    await userEvent.keyboard('{Control>}t{/Control}');
    expect(screen.queryByPlaceholderText(/Search name or artist/)).not.toBeNull();
  });
});

describe('Organizer: changes made from another window', () => {
  const source: { handler: ((event: { data: string }) => void) | null } = { handler: null };
  const send = (revision: number) =>
    (source.handler as ((event: { data: string }) => void) | null)?.({
      data: JSON.stringify({ revision }),
    });
  let stop: () => void = () => {};

  beforeEach(() => {
    resetServerEvents();
    source.handler = null;
    class FakeSource {
      set onmessage(fn: (event: { data: string }) => void) {
        source.handler = fn;
      }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeSource);
    stop = connectServerEvents(() => {});
    send(1); // baseline
  });

  afterEach(() => {
    stop();
    vi.unstubAllGlobals();
  });

  it('clears the undo history and says why, so undo cannot overwrite the other change', async () => {
    renderOrganizer();
    await loaded();
    await userEvent.selectOptions(within(tableRow('Track 1')).getByRole('combobox'), 'Gym');
    await screen.findByText(/Last action: Assign to Gym/);

    act(() => send(2));

    await screen.findByText(/Changed from another window/);
    await waitFor(() => expect(screen.queryByText(/Last action/)).toBeNull());
    await userEvent.keyboard('u');
    expect(mocked.unassignTrack).not.toHaveBeenCalled();
  });

  it('stays quiet when there was nothing to undo anyway', async () => {
    renderOrganizer();
    await loaded();
    act(() => send(2));
    expect(screen.queryByText(/Changed from another window/)).toBeNull();
  });
});
