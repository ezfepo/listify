import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PlaylistView, TrackView } from '../lib/api';
import { CenterTable } from './CenterTable';

// jsdom has no layout, so the real virtualizer would render zero rows. Render them all
// instead: this file tests CenterTable's own sorting/selection/bulk logic, not the library.
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

function track(n: number, overrides: Partial<TrackView> = {}): TrackView {
  return {
    uri: `spotify:track:${n}`,
    name: `Track ${n}`,
    artists: `Artist ${n}`,
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

function setup(overrides: Partial<ComponentProps<typeof CenterTable>> = {}) {
  const mocks = {
    onToggleSelect: vi.fn(),
    onClearSelection: vi.fn(),
    onSelectAll: vi.fn(),
    onSearchChange: vi.fn(),
    onAssign: vi.fn(),
    onUnassign: vi.fn(),
    onBulkAssign: vi.fn(),
    onBulkUnassign: vi.fn(),
    onSetStatus: vi.fn(),
    onPlay: vi.fn(),
    onFocusTrack: vi.fn(),
  };
  const props: ComponentProps<typeof CenterTable> = {
    tracks: [track(1), track(2), track(3)],
    selection: new Set<string>(),
    search: '',
    playlists: [
      playlist(1, 'main', 'Main'),
      playlist(2, 'sub', 'Chill'),
      playlist(3, 'sub', 'Gym'),
    ],
    ...mocks,
    ...overrides,
  };
  const view = render(<CenterTable {...props} />);
  return { props, mocks, ...view };
}

function rowNames(): string[] {
  return screen
    .getAllByTitle('View in Triage')
    .map((b) => b.querySelector('div')?.textContent ?? '');
}

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest('[style*="position: absolute"]') as HTMLElement;
}

describe('CenterTable rows', () => {
  it('renders one row per track with title and artist', () => {
    setup();
    expect(rowNames()).toEqual(['Track 1', 'Track 2', 'Track 3']);
    expect(screen.queryByText('Artist 2')).not.toBeNull();
  });

  it('shows features with two decimals and a dash for missing values', () => {
    setup({ tracks: [track(1, { features: { energy: 0.5, valence: 0.123 } })] });
    const row = rowFor('Track 1');
    expect(within(row).queryByText('0.50')).not.toBeNull();
    expect(within(row).queryByText('0.12')).not.toBeNull();
    expect(within(row).getAllByText('—')).toHaveLength(6);
  });

  it('shows a dash for every feature when a track has no features at all', () => {
    setup({ tracks: [track(1)] });
    expect(within(rowFor('Track 1')).getAllByText('—')).toHaveLength(8);
  });

  it('shows the playlists a track belongs to, and clicking one unassigns it', async () => {
    const { mocks } = setup({
      tracks: [track(1, { playlists: [{ id: 2, name: 'Chill' }] })],
    });
    await userEvent.click(within(rowFor('Track 1')).getByTitle('Click to unassign'));
    expect(mocks.onUnassign).toHaveBeenCalledWith('spotify:track:1', 2);
  });

  it('links to Spotify, plays, and focuses the track in triage', async () => {
    const { mocks } = setup({ tracks: [track(1)] });
    const row = rowFor('Track 1');

    expect(within(row).getByTitle('Open in Spotify').getAttribute('href')).toBe('spotify:track:1');
    await userEvent.click(within(row).getByTitle('Play on active device'));
    await userEvent.click(within(row).getByTitle('View in Triage'));

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
});

describe('CenterTable sorting', () => {
  const tracks = [
    track(1, { name: 'Bravo', features: { energy: 0.2 } }),
    track(2, { name: 'Alpha', features: { energy: 0.9 } }),
    track(3, { name: 'Charlie' }), // no features
    track(4, { name: 'Delta', features: { energy: 0.5 } }),
  ];

  it('cycles name sort: descending, ascending, then back to original order', async () => {
    setup({ tracks });
    const header = screen.getByRole('button', { name: /Title \/ Artist/ });

    await userEvent.click(header);
    expect(rowNames()).toEqual(['Delta', 'Charlie', 'Bravo', 'Alpha']);
    expect(header.textContent).toContain('▾');

    await userEvent.click(header);
    expect(rowNames()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
    expect(header.textContent).toContain('▴');

    await userEvent.click(header);
    expect(rowNames()).toEqual(['Bravo', 'Alpha', 'Charlie', 'Delta']);
    expect(header.textContent).not.toMatch(/[▾▴]/);
  });

  it('sorts by a feature, always putting tracks without that feature last', async () => {
    setup({ tracks });
    const energy = screen.getByTitle('energy');

    await userEvent.click(energy); // descending
    expect(rowNames()).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie']);

    await userEvent.click(energy); // ascending
    expect(rowNames()).toEqual(['Bravo', 'Delta', 'Alpha', 'Charlie']);
  });

  it('switching to another column starts again at descending', async () => {
    setup({ tracks });
    await userEvent.click(screen.getByTitle('energy'));
    await userEvent.click(screen.getByTitle('energy')); // now ascending
    await userEvent.click(screen.getByRole('button', { name: /Title \/ Artist/ }));
    expect(rowNames()).toEqual(['Delta', 'Charlie', 'Bravo', 'Alpha']);
  });

  it('does not mutate the tracks prop when sorting', async () => {
    const { props } = setup({ tracks });
    await userEvent.click(screen.getByRole('button', { name: /Title \/ Artist/ }));
    expect(props.tracks.map((t) => t.name)).toEqual(['Bravo', 'Alpha', 'Charlie', 'Delta']);
  });
});

describe('CenterTable search', () => {
  it('reports typed text, and forwards its ref to the input', async () => {
    const ref = createRef<HTMLInputElement>();
    const mocks = { onSearchChange: vi.fn() };
    render(
      <CenterTable
        ref={ref}
        tracks={[]}
        selection={new Set()}
        onToggleSelect={vi.fn()}
        onClearSelection={vi.fn()}
        onSelectAll={vi.fn()}
        search=""
        onSearchChange={mocks.onSearchChange}
        playlists={[]}
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
        onBulkAssign={vi.fn()}
        onBulkUnassign={vi.fn()}
        onSetStatus={vi.fn()}
        onPlay={vi.fn()}
        onFocusTrack={vi.fn()}
      />,
    );

    await userEvent.type(screen.getByPlaceholderText(/Search name or artist/), 'a');
    expect(mocks.onSearchChange).toHaveBeenCalledWith('a');
    expect(ref.current).toBe(screen.getByPlaceholderText(/Search name or artist/));
  });
});

describe('CenterTable selection and bulk actions', () => {
  it('toggles selection through the row checkbox and reflects selected state', async () => {
    const { mocks } = setup({ selection: new Set(['spotify:track:2']) });

    // boxes[0] is the "select all" header checkbox; row checkboxes follow.
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.slice(1).map((b) => b.checked)).toEqual([false, true, false]);

    await userEvent.click(boxes[1]!);
    expect(mocks.onToggleSelect).toHaveBeenCalledWith('spotify:track:1');
  });

  it('select-all checks every row and selects every visible track', async () => {
    const { mocks } = setup({ selection: new Set() });
    const selectAll = screen.getByTitle('Select all') as HTMLInputElement;
    expect(selectAll.checked).toBe(false);

    await userEvent.click(selectAll);

    expect(mocks.onSelectAll).toHaveBeenCalledWith([
      'spotify:track:1',
      'spotify:track:2',
      'spotify:track:3',
    ]);
  });

  it('select-all shows checked when every visible track is already selected, and clears on uncheck', async () => {
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
    const selectAll = screen.getByTitle('Select all') as HTMLInputElement;
    expect(selectAll.indeterminate).toBe(true);
  });

  it('hides the bulk bar until something is selected', () => {
    setup();
    expect(screen.queryByText(/selected/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('shows the selection count and keeps Assign/Unassign disabled until a playlist is picked', () => {
    setup({ selection: new Set(['spotify:track:1', 'spotify:track:2']) });
    expect(screen.queryByText('2 selected')).not.toBeNull();
    expect((screen.getByRole('button', { name: 'Assign' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Unassign' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('bulk-assigns the selected URIs to the chosen playlist, then resets the picker', async () => {
    const { mocks } = setup({ selection: new Set(['spotify:track:1', 'spotify:track:3']) });
    const picker = screen.getByDisplayValue('Playlist…') as HTMLSelectElement;

    await userEvent.selectOptions(picker, 'Chill');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));

    expect(mocks.onBulkAssign).toHaveBeenCalledWith(['spotify:track:1', 'spotify:track:3'], 2);
    expect(picker.value).toBe('');
  });

  it('bulk-unassigns from the chosen playlist', async () => {
    const { mocks } = setup({ selection: new Set(['spotify:track:2']) });

    await userEvent.selectOptions(screen.getByDisplayValue('Playlist…'), 'Gym');
    await userEvent.click(screen.getByRole('button', { name: 'Unassign' }));

    expect(mocks.onBulkUnassign).toHaveBeenCalledWith(['spotify:track:2'], 3);
  });

  it('bulk Skip marks every selected track skipped and clears the selection', async () => {
    const { mocks } = setup({ selection: new Set(['spotify:track:1', 'spotify:track:2']) });

    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));

    expect(mocks.onSetStatus.mock.calls).toEqual([
      ['spotify:track:1', 'skipped'],
      ['spotify:track:2', 'skipped'],
    ]);
    expect(mocks.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('bulk Reset sends every selected track back to inbox and clears the selection', async () => {
    const { mocks } = setup({ selection: new Set(['spotify:track:1', 'spotify:track:2']) });

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(mocks.onSetStatus.mock.calls).toEqual([
      ['spotify:track:1', 'inbox'],
      ['spotify:track:2', 'inbox'],
    ]);
    expect(mocks.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('Clear clears the selection without changing anything', async () => {
    const { mocks } = setup({ selection: new Set(['spotify:track:1']) });
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(mocks.onClearSelection).toHaveBeenCalledTimes(1);
    expect(mocks.onSetStatus).not.toHaveBeenCalled();
  });
});

describe('CenterTable row actions', () => {
  it('the per-row reset button sends that track back to inbox without needing a selection', async () => {
    const { mocks } = setup();
    const resetButtons = screen.getAllByTitle(
      'Reset: unassign from everything and send back to Inbox',
    );
    await userEvent.click(resetButtons[0]!);
    expect(mocks.onSetStatus).toHaveBeenCalledWith('spotify:track:1', 'inbox');
  });
});
