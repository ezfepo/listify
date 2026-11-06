import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackView } from '../lib/api';
import {
  COLUMN_DEFS,
  DEFAULT_COLUMNS,
  gridLayout,
  loadColumns,
  saveColumns,
  type ColumnKey,
} from './columns';

const STORAGE_KEY = 'listify.columns';

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

function cell(key: ColumnKey, t: TrackView, onUnassign = vi.fn()) {
  const def = COLUMN_DEFS.find((c) => c.key === key)!;
  return render(<>{def.cell(t, { onUnassign })}</>);
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('column definitions', () => {
  it('has unique keys and the documented defaults', () => {
    const keys = COLUMN_DEFS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(DEFAULT_COLUMNS).toEqual(['album', 'playlists', 'suggested', 'energy', 'tempo', 'time']);
  });
});

describe('loadColumns / saveColumns', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadColumns()).toEqual(DEFAULT_COLUMNS);
  });

  it('round-trips a saved choice, including an empty one', () => {
    saveColumns(['tags', 'status']);
    expect(loadColumns()).toEqual(['tags', 'status']);
    saveColumns([]);
    expect(loadColumns()).toEqual([]);
  });

  it('drops keys that no longer exist', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['tags', 'gone', 42, null]));
    expect(loadColumns()).toEqual(['tags']);
  });

  it('falls back to the defaults for stored data that is not a list or not JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tags: true }));
    expect(loadColumns()).toEqual(DEFAULT_COLUMNS);
    window.localStorage.setItem(STORAGE_KEY, '{nope');
    expect(loadColumns()).toEqual(DEFAULT_COLUMNS);
  });

  it('survives storage being unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(loadColumns()).toEqual(DEFAULT_COLUMNS);
    expect(() => saveColumns(['tags'])).not.toThrow();
  });
});

describe('gridLayout', () => {
  const defs = (keys: ColumnKey[]) => COLUMN_DEFS.filter((c) => keys.includes(c.key));

  it('always has the fixed tracks: select, cover, title and actions', () => {
    const { template } = gridLayout([]);
    expect(template.split(' ')).toEqual(['1.5rem', '2rem', 'minmax(11rem,2fr)', '10rem']);
  });

  it('adds one track per column, flexible ones as minmax and fixed ones as plain rem', () => {
    const { template } = gridLayout(defs(['album', 'time']));
    const tracks = template.split(' ');
    expect(tracks).toHaveLength(6);
    expect(tracks).toContain('minmax(7rem,1fr)'); // album
    expect(tracks).toContain('3.5rem'); // time
  });

  it('grows the minimum width with every column added', () => {
    const none = gridLayout([]).minWidthRem;
    const some = gridLayout(defs(['album'])).minWidthRem;
    const more = gridLayout(defs(['album', 'tags', 'added'])).minWidthRem;
    expect(some).toBeGreaterThan(none);
    expect(more).toBeGreaterThan(some);
  });
});

describe('column cells', () => {
  it('album: the name, or a dash', () => {
    cell('album', track({ album: 'Alb' }));
    expect(screen.queryByText('Alb')).not.toBeNull();
    cell('album', track());
    expect(screen.queryByText('—')).not.toBeNull();
  });

  it('playlists: one chip per playlist, clicking unassigns', () => {
    const onUnassign = vi.fn();
    cell(
      'playlists',
      track({
        playlists: [
          { id: 1, name: 'Chill' },
          { id: 2, name: 'Gym' },
        ],
      }),
      onUnassign,
    );
    screen.getByText('Gym').click();
    expect(onUnassign).toHaveBeenCalledWith('spotify:track:1', 2);
  });

  it('audio features: tempo is rounded, loudness has its unit, the rest have two decimals', () => {
    const t = track({
      features: {
        tempo: 127.6,
        loudness: -7.46,
        valence: 0.5,
        danceability: 0.123,
        acousticness: 0.9,
        instrumentalness: 0.01,
        speechiness: 0.045,
        energy: 0.8,
      },
    });
    for (const key of [
      'tempo',
      'loudness',
      'valence',
      'danceability',
      'acousticness',
      'instrumentalness',
      'speechiness',
      'energy',
    ] as const) {
      cell(key, t);
    }
    for (const text of ['128', '-7.5 dB', '0.50', '0.12', '0.90', '0.01', '0.04', '0.80']) {
      expect(screen.queryAllByText(text).length, text).toBeGreaterThan(0);
    }
  });

  it('audio features: a dash when the song has none', () => {
    cell('valence', track());
    expect(screen.queryByText('—')).not.toBeNull();
  });

  it('time: m:ss, or a dash', () => {
    cell('time', track({ durationMs: 215000 }));
    expect(screen.queryByText('3:35')).not.toBeNull();
    cell('time', track());
    expect(screen.queryByText('—')).not.toBeNull();
  });

  it('tags: at most three, without repeating a tag from two sources; a dash when none', () => {
    cell(
      'tags',
      track({
        tags: [
          { tag: 'pop', weight: 9, source: 'a' },
          { tag: 'pop', weight: 8, source: 'b' },
          { tag: 'dance', weight: 7, source: 'a' },
          { tag: 'indie', weight: 6, source: 'a' },
          { tag: 'extra', weight: 5, source: 'a' },
        ],
      }),
    );
    expect(screen.getAllByText('pop')).toHaveLength(1);
    expect(screen.queryByText('indie')).not.toBeNull();
    expect(screen.queryByText('extra')).toBeNull();

    cell('tags', track());
    expect(screen.queryByText('—')).not.toBeNull();
  });

  it('added: the date part only, or a dash', () => {
    cell('added', track({ addedAt: '2026-03-04T10:11:12Z' }));
    expect(screen.queryByText('2026-03-04')).not.toBeNull();
    cell('added', track());
    expect(screen.queryByText('—')).not.toBeNull();
  });

  it('status: a labelled chip for each status', () => {
    cell('status', track({ status: 'inbox' }));
    cell('status', track({ status: 'organized' }));
    cell('status', track({ status: 'skipped' }));
    expect(screen.queryByText('Inbox')).not.toBeNull();
    expect(screen.queryByText('Organized')).not.toBeNull();
    expect(screen.queryByText('Skipped')).not.toBeNull();
  });
});
