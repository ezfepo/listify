import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PlaylistView } from '../lib/api';
import { BulkBar } from './BulkBar';

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

function setup(overrides: Partial<ComponentProps<typeof BulkBar>> = {}) {
  const mocks = {
    onBulkAssign: vi.fn(),
    onBulkUnassign: vi.fn(),
    onSetStatus: vi.fn(),
    onClearSelection: vi.fn(),
  };
  const props: ComponentProps<typeof BulkBar> = {
    selection: new Set(['spotify:track:1', 'spotify:track:3']),
    playlists: [
      playlist(1, 'main', 'Main'),
      playlist(2, 'sub', 'Chill'),
      playlist(3, 'sub', 'Gym'),
    ],
    ...mocks,
    ...overrides,
  };
  render(<BulkBar {...props} />);
  return { props, mocks };
}

describe('BulkBar', () => {
  it('renders nothing until something is selected', () => {
    setup({ selection: new Set() });
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('shows the selection count and keeps Assign/Unassign disabled until a playlist is picked', () => {
    setup();
    expect(screen.queryByText('2 selected')).not.toBeNull();
    expect((screen.getByRole('button', { name: 'Assign' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Unassign' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('offers only sub-playlists as targets', () => {
    setup();
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Playlist…', 'Chill', 'Gym']);
  });

  it('bulk-assigns the selected URIs to the chosen playlist, then resets the picker', async () => {
    const { mocks } = setup();
    const picker = screen.getByLabelText('Target playlist') as HTMLSelectElement;

    await userEvent.selectOptions(picker, 'Chill');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));

    expect(mocks.onBulkAssign).toHaveBeenCalledWith(['spotify:track:1', 'spotify:track:3'], 2);
    expect(picker.value).toBe('');
  });

  it('bulk-unassigns from the chosen playlist', async () => {
    const { mocks } = setup();
    await userEvent.selectOptions(screen.getByLabelText('Target playlist'), 'Gym');
    await userEvent.click(screen.getByRole('button', { name: 'Unassign' }));
    expect(mocks.onBulkUnassign).toHaveBeenCalledWith(['spotify:track:1', 'spotify:track:3'], 3);
  });

  it('Skip marks every selected track skipped and clears the selection', async () => {
    const { mocks } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(mocks.onSetStatus.mock.calls).toEqual([
      ['spotify:track:1', 'skipped'],
      ['spotify:track:3', 'skipped'],
    ]);
    expect(mocks.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('Reset sends every selected track back to inbox and clears the selection', async () => {
    const { mocks } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(mocks.onSetStatus.mock.calls).toEqual([
      ['spotify:track:1', 'inbox'],
      ['spotify:track:3', 'inbox'],
    ]);
    expect(mocks.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('Clear clears the selection without changing anything', async () => {
    const { mocks } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(mocks.onClearSelection).toHaveBeenCalledTimes(1);
    expect(mocks.onSetStatus).not.toHaveBeenCalled();
  });
});

describe('BulkBar target picker', () => {
  it('goes back to disabled when the placeholder is chosen again', async () => {
    setup();
    const picker = screen.getByLabelText('Target playlist');
    await userEvent.selectOptions(picker, 'Chill');
    expect((screen.getByRole('button', { name: 'Assign' }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    await userEvent.selectOptions(picker, 'Playlist…');
    expect((screen.getByRole('button', { name: 'Assign' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
