import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaylistView } from '../lib/api';
import { PlaylistShelf } from './PlaylistShelf';

function playlist(
  id: number,
  kind: PlaylistView['kind'],
  name: string,
  extra: Partial<PlaylistView> = {},
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
    trackCount: 0,
    ...extra,
  };
}

function setup(overrides: Partial<ComponentProps<typeof PlaylistShelf>> = {}) {
  const mocks = {
    onSelectPlaylist: vi.fn(),
    onCreatePlaylist: vi.fn(),
    onDeletePlaylist: vi.fn(),
    onEditRecipe: vi.fn(),
  };
  const props: ComponentProps<typeof PlaylistShelf> = {
    playlists: [
      playlist(1, 'main', 'Main', { trackCount: 100 }),
      playlist(2, 'archive', 'Main – Archive', { trackCount: 900 }),
      playlist(3, 'sub', 'Chill', { trackCount: 7, emoji: '😌' }),
      playlist(4, 'sub', 'Workout', { trackCount: 9 }),
    ],
    selectedPlaylistId: null,
    ...mocks,
    ...overrides,
  };
  const view = render(<PlaylistShelf {...props} />);
  return { props, mocks, ...view };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PlaylistShelf library', () => {
  it('shows Main and Archive with their counts and selects them', async () => {
    const { mocks } = setup();
    const main = screen.getByRole('button', { name: /^Main\s*100$/ });
    const archive = screen.getByRole('button', { name: /Archive/ });
    expect(archive.textContent).toContain('900');

    await userEvent.click(main);
    await userEvent.click(archive);
    expect(mocks.onSelectPlaylist.mock.calls).toEqual([['main'], ['archive']]);
  });

  it('omits Main/Archive rows that do not exist yet', () => {
    setup({ playlists: [playlist(3, 'sub', 'Chill')] });
    expect(screen.queryByRole('button', { name: /Archive/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Main/ })).toBeNull();
  });
});

describe('PlaylistShelf sub-playlists', () => {
  it('lists only sub-playlists, with emoji and count', () => {
    setup();
    const chill = screen.getByRole('button', { name: /Chill/ });
    expect(chill.textContent).toContain('😌');
    expect(chill.textContent).toContain('7');
    expect(screen.getByRole('button', { name: /Workout/ })).toBeTruthy();
  });

  it('selects a playlist, and clicking the selected one deselects it', async () => {
    const { mocks, rerender, props } = setup();
    await userEvent.click(screen.getByRole('button', { name: /Chill/ }));
    expect(mocks.onSelectPlaylist).toHaveBeenLastCalledWith(3);

    rerender(<PlaylistShelf {...props} selectedPlaylistId={3} />);
    await userEvent.click(screen.getByRole('button', { name: /Chill/ }));
    expect(mocks.onSelectPlaylist).toHaveBeenLastCalledWith(null);
  });

  it('opens the recipe editor for that playlist', async () => {
    const { mocks } = setup();
    const row = screen.getByRole('button', { name: /Workout/ }).parentElement as HTMLElement;
    await userEvent.click(within(row).getByTitle('Edit recipe'));
    expect(mocks.onEditRecipe).toHaveBeenCalledWith(4);
  });

  it('deletes only after the user confirms', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { mocks } = setup();
    const row = screen.getByRole('button', { name: /Chill/ }).parentElement as HTMLElement;

    await userEvent.click(within(row).getByTitle('Delete playlist'));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Delete "Chill"?'));
    expect(mocks.onDeletePlaylist).toHaveBeenCalledWith(3);
  });

  it('does nothing when the user cancels the delete confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { mocks } = setup();
    const row = screen.getByRole('button', { name: /Chill/ }).parentElement as HTMLElement;

    await userEvent.click(within(row).getByTitle('Delete playlist'));
    expect(mocks.onDeletePlaylist).not.toHaveBeenCalled();
  });
});

describe('PlaylistShelf new playlist form', () => {
  it('creates a playlist with the trimmed name and clears the input', async () => {
    const { mocks } = setup();
    const input = screen.getByPlaceholderText('New playlist…') as HTMLInputElement;

    await userEvent.type(input, '  Road trip  ');
    await userEvent.click(screen.getByRole('button', { name: 'Create playlist' }));

    expect(mocks.onCreatePlaylist).toHaveBeenCalledWith('Road trip');
    expect(input.value).toBe('');
  });

  it('submits with Enter', async () => {
    const { mocks } = setup();
    await userEvent.type(screen.getByPlaceholderText('New playlist…'), 'Study{Enter}');
    expect(mocks.onCreatePlaylist).toHaveBeenCalledWith('Study');
  });

  it('ignores an empty or whitespace-only name', async () => {
    const { mocks } = setup();
    await userEvent.type(screen.getByPlaceholderText('New playlist…'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Create playlist' }));
    expect(mocks.onCreatePlaylist).not.toHaveBeenCalled();
  });
});

describe('PlaylistShelf selection state', () => {
  it('marks only the selected tile as pressed', () => {
    setup({ selectedPlaylistId: 4 });
    expect(screen.getByRole('button', { name: /Workout/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: /Chill/ }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('keeps Main and Archive read-only: no edit or delete controls on them', () => {
    setup();
    expect(screen.getAllByTitle('Edit recipe')).toHaveLength(2);
  });
});
