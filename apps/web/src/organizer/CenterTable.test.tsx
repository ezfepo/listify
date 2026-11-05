import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type PlaylistView, type TrackView } from '../lib/api';
import { CenterTable } from './CenterTable';

// jsdom has no layout, so the real virtualizer would render zero rows. Render them all
// instead: this file tests CenterTable's own sorting/selection logic, not the library.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 48,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 48,
        size: 48,
      })),
  }),
}));

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  api: { getTrackSuggestions: vi.fn() },
}));

const getTrackSuggestions = vi.mocked(api.getTrackSuggestions);

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

function playlist(id: number, kind: PlaylistView['kind'], name: string): PlaylistView {
  return {
    id,
    spotifyId: null,
    name,
    kind,
    criteriaNote: null,
    emoji: null,
    color: null,
    sortOrder: id,
    trackCount: 0,
  };
}

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function setup(overrides: Partial<ComponentProps<typeof CenterTable>> = {}) {
  const mocks = {
    onStatusFilterChange: vi.fn(),
    onToggleSelect: vi.fn(),
    onClearSelection: vi.fn(),
    onSelectAll: vi.fn(),
    onSearchChange: vi.fn(),
    onAssign: vi.fn(),
    onUnassign: vi.fn(),
    onSetStatus: vi.fn(),
    onPlay: vi.fn(),
    onFocusTrack: vi.fn(),
  };
  const props: ComponentProps<typeof CenterTable> = {
    tracks: [track(1), track(2), track(3)],
    statusCounts: { inbox: 12, organized: 34, skipped: 5 },
    statusFilter: null,
    selection: new Set<string>(),
    search: '',
    focusedUri: null,
    playlists: [
      playlist(1, 'main', 'Main'),
      playlist(2, 'sub', 'Chill'),
      playlist(3, 'sub', 'Gym'),
    ],
    ...mocks,
    ...overrides,
  };
  const view = render(wrap(<CenterTable {...props} />));
  return { props, mocks, ...view };
}

function rowNames(): string[] {
  return screen.getAllByTitle('Inspect song').map((b) => b.querySelector('div')?.textContent ?? '');
}

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest('[style*="position: absolute"]') as HTMLElement;
}

beforeEach(() => {
  window.localStorage.clear();
  getTrackSuggestions.mockReset();
  getTrackSuggestions.mockResolvedValue([]);
});

describe('CenterTable rows', () => {
  it('renders one row per track with title and artist', () => {
    setup();
    expect(rowNames()).toEqual(['Track 1', 'Track 2', 'Track 3']);
    expect(screen.queryByText('Artist 2')).not.toBeNull();
  });

  it('shows album, energy (two decimals) and rounded BPM, with dashes when missing', () => {
    setup({
      tracks: [track(1, { album: 'Album One', features: { energy: 0.5, tempo: 120.4 } }), track(2)],
    });
    const row = rowFor('Track 1');
    expect(within(row).queryByText('Album One')).not.toBeNull();
    expect(within(row).queryByText('0.50')).not.toBeNull();
    expect(within(row).queryByText('120')).not.toBeNull();
    // album, suggested, energy and bpm are all empty for the bare track
    expect(within(rowFor('Track 2')).getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('shows the track length as m:ss', () => {
    setup({ tracks: [track(1, { durationMs: 215000 })] });
    expect(within(rowFor('Track 1')).queryByText('3:35')).not.toBeNull();
  });

  it('shows the playlists a track belongs to, and clicking one unassigns it', async () => {
    const { mocks } = setup({
      tracks: [track(1, { playlists: [{ id: 2, name: 'Chill' }] })],
    });
    await userEvent.click(within(rowFor('Track 1')).getByTitle('Click to unassign'));
    expect(mocks.onUnassign).toHaveBeenCalledWith('spotify:track:1', 2);
  });

  it('links to Spotify, plays, and focuses the track for inspection', async () => {
    const { mocks } = setup({ tracks: [track(1)] });
    const row = rowFor('Track 1');

    expect(within(row).getByTitle('Open in Spotify').getAttribute('href')).toBe('spotify:track:1');
    await userEvent.click(within(row).getByTitle('Play on active device'));
    await userEvent.click(within(row).getByTitle('Inspect song'));

    expect(mocks.onPlay).toHaveBeenCalledWith('spotify:track:1');
    expect(mocks.onFocusTrack).toHaveBeenCalledWith('spotify:track:1');
  });

  it('assigns from the per-row "Add to…" menu, offering only sub-playlists', async () => {
    const { mocks } = setup({ tracks: [track(1)] });
    const select = within(rowFor('Track 1')).getByRole('combobox') as HTMLSelectElement;

    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['+ Add to…', 'Chill', 'Gym']);

    await userEvent.selectOptions(select, 'Gym');
    expect(mocks.onAssign).toHaveBeenCalledWith('spotify:track:1', 3);
    expect(select.value).toBe(''); // resets so the same playlist can be picked again
  });

  it('the per-row reset button sends that track back to inbox without needing a selection', async () => {
    const { mocks } = setup();
    const resetButtons = screen.getAllByTitle(
      'Reset: unassign from everything and send back to Inbox',
    );
    await userEvent.click(resetButtons[0]!);
    expect(mocks.onSetStatus).toHaveBeenCalledWith('spotify:track:1', 'inbox');
  });

  it('highlights the focused row', () => {
    setup({ focusedUri: 'spotify:track:2' });
    expect(rowFor('Track 2').className).toContain('bg-raise');
    expect(rowFor('Track 1').className).not.toContain('bg-raise');
  });
});

describe('CenterTable suggested column', () => {
  it('shows the best suggestion the track is not already in', async () => {
    getTrackSuggestions.mockResolvedValue([
      { playlistId: 2, playlistName: 'Chill', score: 90, reason: 'tags' },
      { playlistId: 3, playlistName: 'Gym', score: 70, reason: 'energy' },
    ]);
    setup({ tracks: [track(1, { playlists: [{ id: 2, name: 'Chill' }] })] });
    await waitFor(() => expect(within(rowFor('Track 1')).queryByText('Gym 70')).not.toBeNull());
    expect(within(rowFor('Track 1')).queryByText('Chill 90')).toBeNull();
  });

  it('shows a dash when nothing scores above zero', async () => {
    getTrackSuggestions.mockResolvedValue([
      { playlistId: 2, playlistName: 'Chill', score: 0, reason: '' },
    ]);
    setup({ tracks: [track(1)] });
    await waitFor(() => expect(getTrackSuggestions).toHaveBeenCalled());
    expect(within(rowFor('Track 1')).queryByText(/^Chill \d/)).toBeNull();
  });
});

describe('CenterTable status control', () => {
  it('shows each status with its count', () => {
    setup();
    expect(screen.getByRole('button', { name: /Inbox/ }).textContent).toContain('12');
    expect(screen.getByRole('button', { name: /Organized/ }).textContent).toContain('34');
    expect(screen.getByRole('button', { name: /Skipped/ }).textContent).toContain('5');
  });

  it('picking a status filters by it, and All clears the filter', async () => {
    const { mocks } = setup();
    await userEvent.click(screen.getByRole('button', { name: /Organized/ }));
    expect(mocks.onStatusFilterChange).toHaveBeenLastCalledWith('organized');
    await userEvent.click(screen.getByRole('button', { name: /^All/ }));
    expect(mocks.onStatusFilterChange).toHaveBeenLastCalledWith(null);
  });

  it('marks only the active status as pressed (All when there is no filter)', () => {
    setup({ statusFilter: 'skipped' });
    expect(screen.getByRole('button', { name: /Skipped/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: /Inbox/ }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(screen.getByRole('button', { name: /^All/ }).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('CenterTable sorting', () => {
  const tracks = [
    track(1, { name: 'Bravo', features: { energy: 0.2 } }),
    track(2, { name: 'Alpha', features: { energy: 0.9 } }),
    track(3, { name: 'Charlie' }), // no features
    track(4, { name: 'Delta', features: { energy: 0.5 } }),
  ];

  it('keeps the original order by default', () => {
    setup({ tracks });
    expect(rowNames()).toEqual(['Bravo', 'Alpha', 'Charlie', 'Delta']);
  });

  it('sorts by title ascending, and the direction button flips it', async () => {
    setup({ tracks });
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'Title');
    expect(rowNames()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);

    await userEvent.click(screen.getByRole('button', { name: /Sort direction/ }));
    expect(rowNames()).toEqual(['Delta', 'Charlie', 'Bravo', 'Alpha']);
  });

  it('sorts by a feature descending, always putting tracks without that feature last', async () => {
    setup({ tracks });
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'Energy');
    expect(rowNames()).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie']);

    await userEvent.click(screen.getByRole('button', { name: /Sort direction/ }));
    expect(rowNames()).toEqual(['Bravo', 'Delta', 'Alpha', 'Charlie']);
  });

  it('going back to Default order restores the original order', async () => {
    setup({ tracks });
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'Title');
    await userEvent.selectOptions(screen.getByLabelText('Sort'), '');
    expect(rowNames()).toEqual(['Bravo', 'Alpha', 'Charlie', 'Delta']);
  });

  it('does not mutate the tracks prop when sorting', async () => {
    const { props } = setup({ tracks });
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'Title');
    expect(props.tracks.map((t) => t.name)).toEqual(['Bravo', 'Alpha', 'Charlie', 'Delta']);
  });
});

describe('CenterTable search', () => {
  it('reports typed text, and forwards its ref to the input', async () => {
    const ref = createRef<HTMLInputElement>();
    const onSearchChange = vi.fn();
    render(
      wrap(
        <CenterTable
          ref={ref}
          tracks={[]}
          statusCounts={{ inbox: 0, organized: 0, skipped: 0 }}
          statusFilter={null}
          onStatusFilterChange={vi.fn()}
          selection={new Set()}
          onToggleSelect={vi.fn()}
          onClearSelection={vi.fn()}
          onSelectAll={vi.fn()}
          search=""
          onSearchChange={onSearchChange}
          playlists={[]}
          focusedUri={null}
          onAssign={vi.fn()}
          onUnassign={vi.fn()}
          onSetStatus={vi.fn()}
          onPlay={vi.fn()}
          onFocusTrack={vi.fn()}
        />,
      ),
    );

    await userEvent.type(screen.getByPlaceholderText(/Search name or artist/), 'a');
    expect(onSearchChange).toHaveBeenCalledWith('a');
    expect(ref.current).toBe(screen.getByPlaceholderText(/Search name or artist/));
  });
});

describe('CenterTable selection', () => {
  it('toggles selection through the row checkbox and reflects selected state', async () => {
    const { mocks } = setup({ selection: new Set(['spotify:track:2']) });

    const boxes = screen.getAllByRole('checkbox', { name: /^Select Track/ }) as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([false, true, false]);

    await userEvent.click(boxes[0]!);
    expect(mocks.onToggleSelect).toHaveBeenCalledWith('spotify:track:1');
  });

  it('select-all selects every visible track', async () => {
    const { mocks } = setup();
    const selectAll = screen.getByTitle('Select all') as HTMLInputElement;
    expect(selectAll.checked).toBe(false);

    await userEvent.click(selectAll);

    expect(mocks.onSelectAll).toHaveBeenCalledWith([
      'spotify:track:1',
      'spotify:track:2',
      'spotify:track:3',
    ]);
  });

  it('select-all shows checked when every visible track is selected, and clears on uncheck', async () => {
    const { mocks } = setup({
      selection: new Set(['spotify:track:1', 'spotify:track:2', 'spotify:track:3']),
    });
    const selectAll = screen.getByTitle('Select all') as HTMLInputElement;
    expect(selectAll.checked).toBe(true);

    await userEvent.click(selectAll);

    expect(mocks.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('select-all shows indeterminate when only some visible tracks are selected', () => {
    setup({ selection: new Set(['spotify:track:2']) });
    expect((screen.getByTitle('Select all') as HTMLInputElement).indeterminate).toBe(true);
  });
});

describe('CenterTable columns', () => {
  const rich = track(1, {
    album: 'Alb',
    durationMs: 200000,
    addedAt: '2026-03-04T10:00:00Z',
    status: 'organized',
    features: { valence: 0.11, danceability: 0.22, loudness: -7.46 },
    tags: [
      { tag: 'pop', weight: 90, source: 'lastfm' },
      { tag: 'pop', weight: 50, source: 'other' },
      { tag: 'dance', weight: 40, source: 'lastfm' },
    ],
  });

  async function pick(label: string) {
    await userEvent.click(screen.getByText('Columns'));
    await userEvent.click(screen.getByRole('checkbox', { name: label }));
  }

  it('hides the extra columns by default', () => {
    setup({ tracks: [rich] });
    expect(within(rowFor('Track 1')).queryByText('0.11')).toBeNull();
    expect(within(rowFor('Track 1')).queryByText('2026-03-04')).toBeNull();
  });

  it('lets you add feature columns, tags, date added and status', async () => {
    setup({ tracks: [rich] });
    await pick('Valence');
    await pick('Danceability');
    await pick('Loudness');
    await pick('Tags');
    await pick('Added');
    await pick('Status');

    const row = within(rowFor('Track 1'));
    expect(row.queryByText('0.11')).not.toBeNull();
    expect(row.queryByText('0.22')).not.toBeNull();
    expect(row.queryByText('-7.5 dB')).not.toBeNull();
    expect(row.queryByText('2026-03-04')).not.toBeNull();
    expect(row.queryByText('Organized')).not.toBeNull();
    expect(row.getAllByText('pop')).toHaveLength(1); // de-duplicated across sources
    expect(row.queryByText('dance')).not.toBeNull();
  });

  it('can hide a default column, and remembers the choice', async () => {
    const first = setup({ tracks: [rich] });
    expect(within(rowFor('Track 1')).queryByText('Alb')).not.toBeNull();
    await pick('Album');
    expect(within(rowFor('Track 1')).queryByText('Alb')).toBeNull();
    first.unmount();

    setup({ tracks: [rich] });
    expect(within(rowFor('Track 1')).queryByText('Alb')).toBeNull();
  });

  it('falls back to the defaults when the stored choice is unreadable', () => {
    window.localStorage.setItem('listify.columns', '{not json');
    setup({ tracks: [rich] });
    expect(within(rowFor('Track 1')).queryByText('Alb')).not.toBeNull();
  });

  it('sorts by duration and by date added', async () => {
    const tracks = [
      track(1, { name: 'A', durationMs: 100000, addedAt: '2026-01-01T00:00:00Z' }),
      track(2, { name: 'B', durationMs: 300000, addedAt: '2025-01-01T00:00:00Z' }),
      track(3, { name: 'C' }),
    ];
    setup({ tracks });
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'Time');
    expect(rowNames()).toEqual(['B', 'A', 'C']);
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'Date added');
    expect(rowNames()).toEqual(['A', 'B', 'C']);
  });
});
