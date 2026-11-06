import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type TrackView } from '../lib/api';
import { Inspector } from './Inspector';

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
  features: { energy: 0.8 },
  tags: [{ tag: 'upbeat', weight: 1, source: 'lastfm' }],
  enrichment: [],
  playlists: [],
};

beforeEach(() => {
  getTrackSuggestions.mockReset();
  getTrackSuggestions.mockResolvedValue([]);
});

describe('Inspector', () => {
  it('prompts to select a song when nothing is focused', () => {
    render(<Inspector track={undefined} onPlay={vi.fn()} onOpenInTriage={vi.fn()} />);
    expect(screen.queryByText(/Select a song/)).not.toBeNull();
    expect(getTrackSuggestions).not.toHaveBeenCalled();
  });

  it('shows the song with its suggestions, features and tags', async () => {
    getTrackSuggestions.mockResolvedValue([
      { playlistId: 2, playlistName: 'Gym', score: 88, reason: 'energy' },
    ]);
    render(<Inspector track={track} onPlay={vi.fn()} onOpenInTriage={vi.fn()} />);
    expect(screen.queryByText('Song One')).not.toBeNull();
    expect(screen.queryByText('0.80')).not.toBeNull();
    expect(screen.queryByText('upbeat')).not.toBeNull();
    await screen.findByText('Gym');
    expect(getTrackSuggestions).toHaveBeenCalledWith('spotify:track:1');
  });

  it('shows the track length', () => {
    render(
      <Inspector
        track={{ ...track, durationMs: 185000 }}
        onPlay={vi.fn()}
        onOpenInTriage={vi.fn()}
      />,
    );
    expect(screen.queryByText('3:05')).not.toBeNull();
  });

  it('plays, links to Spotify and opens the song in Triage', async () => {
    const onPlay = vi.fn();
    const onOpenInTriage = vi.fn();
    render(<Inspector track={track} onPlay={onPlay} onOpenInTriage={onOpenInTriage} />);

    await userEvent.click(screen.getByRole('button', { name: /Play/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Open in Triage' }));

    expect(onPlay).toHaveBeenCalledWith('spotify:track:1');
    expect(onOpenInTriage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: /Open in Spotify/ }).getAttribute('href')).toBe(
      'spotify:track:1',
    );
  });
});

describe('Inspector cover', () => {
  it('shows the cover art when the song has one', () => {
    const { container } = render(
      <Inspector
        track={{ ...track, imageUrl: 'http://img/1.jpg' }}
        onPlay={vi.fn()}
        onOpenInTriage={vi.fn()}
      />,
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe('http://img/1.jpg');
  });
});
