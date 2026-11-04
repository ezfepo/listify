import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type TrackSuggestion } from '../lib/api';
import { AutoSortPanel } from './AutoSortPanel';

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  api: { getPlaylistSuggestions: vi.fn() },
}));

const getPlaylistSuggestions = vi.mocked(api.getPlaylistSuggestions);

function candidate(n: number): TrackSuggestion {
  return {
    uri: `spotify:track:${n}`,
    name: `Track ${n}`,
    artists: 'Someone',
    score: 50 + n,
    reason: 'tags',
  };
}

function setup() {
  const onBulkAssign = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AutoSortPanel playlistId={4} playlistName="Focus" onBulkAssign={onBulkAssign} />
    </QueryClientProvider>,
  );
  return { onBulkAssign };
}

function assignButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Assign/ }) as HTMLButtonElement;
}

beforeEach(() => {
  getPlaylistSuggestions.mockReset();
});

describe('AutoSortPanel', () => {
  it('asks for 100 candidates for the playlist and shows a loading state first', async () => {
    getPlaylistSuggestions.mockResolvedValue([candidate(1)]);
    setup();
    expect(screen.queryByText(/Scoring candidates/)).not.toBeNull();
    await screen.findByText('Track 1');
    expect(getPlaylistSuggestions).toHaveBeenCalledWith(4, 100);
  });

  it('explains when nothing scores above zero', async () => {
    getPlaylistSuggestions.mockResolvedValue([]);
    setup();
    await screen.findByText(/No unassigned candidates/);
  });

  it('disables the assign button until something is checked', async () => {
    getPlaylistSuggestions.mockResolvedValue([candidate(1)]);
    setup();
    await screen.findByText('Track 1');
    expect(assignButton().disabled).toBe(true);

    await userEvent.click(screen.getByRole('checkbox'));
    expect(assignButton().disabled).toBe(false);
    expect(assignButton().textContent).toBe('Assign 1 to Focus');
  });

  it('assigns only the checked tracks, then clears the selection', async () => {
    getPlaylistSuggestions.mockResolvedValue([candidate(1), candidate(2), candidate(3)]);
    const { onBulkAssign } = setup();
    await screen.findByText('Track 1');

    const boxes = screen.getAllByRole('checkbox');
    await userEvent.click(boxes[0]!);
    await userEvent.click(boxes[2]!);
    await userEvent.click(screen.getByRole('button', { name: /Assign 2 to Focus/ }));

    expect(onBulkAssign).toHaveBeenCalledWith(['spotify:track:1', 'spotify:track:3'], 4);
    expect(assignButton().disabled).toBe(true);
  });

  it('select all checks every candidate', async () => {
    getPlaylistSuggestions.mockResolvedValue([candidate(1), candidate(2)]);
    const { onBulkAssign } = setup();
    await screen.findByText('Track 1');

    await userEvent.click(screen.getByRole('button', { name: 'Select all' }));
    await userEvent.click(screen.getByRole('button', { name: /Assign 2 to Focus/ }));
    expect(onBulkAssign).toHaveBeenCalledWith(['spotify:track:1', 'spotify:track:2'], 4);
  });

  it('unchecking a track removes it from the selection', async () => {
    getPlaylistSuggestions.mockResolvedValue([candidate(1), candidate(2)]);
    const { onBulkAssign } = setup();
    await screen.findByText('Track 1');

    await userEvent.click(screen.getByRole('button', { name: 'Select all' }));
    await userEvent.click(screen.getAllByRole('checkbox')[0]!);
    await userEvent.click(screen.getByRole('button', { name: /Assign 1 to Focus/ }));
    expect(onBulkAssign).toHaveBeenCalledWith(['spotify:track:2'], 4);
  });
});
