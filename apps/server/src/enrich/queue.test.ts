import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrichProvider } from './types.js';

const fakeReccobeats: EnrichProvider = {
  name: 'reccobeats',
  isConfigured: vi.fn(() => true),
  enrich: vi.fn(),
};

const fakeLastfm: EnrichProvider = {
  name: 'lastfm',
  isConfigured: vi.fn(() => true),
  enrich: vi.fn(),
};

vi.mock('./reccobeats.js', () => ({ reccobeatsProvider: fakeReccobeats }));
vi.mock('./lastfm.js', () => ({ lastfmProvider: fakeLastfm }));

const { db } = await import('../db/index.js');
const { upsertTrack } = await import('../db/tracks.js');
const { getEnrichmentCoverage } = await import('../db/enrichment.js');
const { runEnrichmentQueue } = await import('./queue.js');

function track(uri: string) {
  return {
    uri,
    name: 'Song',
    artists: 'Artist',
    album: null,
    imageUrl: null,
    durationMs: null,
    addedAt: null,
    isLocal: false,
    isrc: null,
  };
}

beforeEach(() => {
  db.exec(
    'DELETE FROM enrichment_status; DELETE FROM track_features; DELETE FROM track_tags; DELETE FROM tracks;',
  );
  vi.mocked(fakeReccobeats.isConfigured).mockReturnValue(true);
  vi.mocked(fakeLastfm.isConfigured).mockReturnValue(true);
  vi.mocked(fakeReccobeats.enrich).mockReset();
  vi.mocked(fakeLastfm.enrich).mockReset();
});

describe('runEnrichmentQueue', () => {
  it('records ok/not_found/error per track and skips unconfigured providers', async () => {
    upsertTrack(track('spotify:track:1'), 'inbox');
    upsertTrack(track('spotify:track:2'), 'inbox');
    upsertTrack(track('spotify:track:3'), 'inbox');

    vi.mocked(fakeReccobeats.enrich).mockImplementation(async (t) => {
      if (t.uri === 'spotify:track:1') return { features: { valence: 0.5 } };
      if (t.uri === 'spotify:track:2') return null; // not_found
      throw new Error('boom'); // track 3 -> error
    });
    vi.mocked(fakeLastfm.isConfigured).mockReturnValue(false);

    await runEnrichmentQueue();

    const statuses = db
      .prepare(
        "SELECT track_uri, status FROM enrichment_status WHERE source = 'reccobeats' ORDER BY track_uri",
      )
      .all() as { track_uri: string; status: string }[];
    expect(statuses).toEqual([
      { track_uri: 'spotify:track:1', status: 'ok' },
      { track_uri: 'spotify:track:2', status: 'not_found' },
      { track_uri: 'spotify:track:3', status: 'error' },
    ]);

    const lastfmStatuses = db
      .prepare("SELECT * FROM enrichment_status WHERE source = 'lastfm'")
      .all();
    expect(lastfmStatuses).toEqual([]);

    const features = db
      .prepare('SELECT valence FROM track_features WHERE track_uri = ?')
      .get('spotify:track:1') as { valence: number };
    expect(features.valence).toBe(0.5);
  });

  it('retries tracks whose last attempt errored, but not ok/not_found ones', async () => {
    upsertTrack(track('spotify:track:1'), 'inbox');
    upsertTrack(track('spotify:track:2'), 'inbox');
    vi.mocked(fakeLastfm.isConfigured).mockReturnValue(false);

    vi.mocked(fakeReccobeats.enrich).mockImplementation(async (t) => {
      if (t.uri === 'spotify:track:1') throw new Error('transient');
      return null;
    });
    await runEnrichmentQueue();

    vi.mocked(fakeReccobeats.enrich).mockReset();
    vi.mocked(fakeReccobeats.enrich).mockResolvedValue({ features: { energy: 0.9 } });
    await runEnrichmentQueue();

    // Only the previously-errored track should have been retried.
    expect(fakeReccobeats.enrich).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fakeReccobeats.enrich).mock.calls[0]?.[0].uri).toBe('spotify:track:1');

    const status = db
      .prepare(
        "SELECT status FROM enrichment_status WHERE track_uri = 'spotify:track:1' AND source = 'reccobeats'",
      )
      .get() as { status: string };
    expect(status.status).toBe('ok');
  });

  it('reports coverage across sources', async () => {
    upsertTrack(track('spotify:track:1'), 'inbox');
    upsertTrack(track('spotify:track:2'), 'inbox');
    vi.mocked(fakeLastfm.isConfigured).mockReturnValue(false);
    vi.mocked(fakeReccobeats.enrich).mockImplementation(async (t) =>
      t.uri === 'spotify:track:1' ? { features: { valence: 0.5 } } : null,
    );

    await runEnrichmentQueue();

    const coverage = getEnrichmentCoverage();
    expect(coverage).toEqual([{ source: 'reccobeats', ok: 1, notFound: 1, error: 0, pending: 0 }]);
  });

  it('does not run two queues concurrently', async () => {
    upsertTrack(track('spotify:track:1'), 'inbox');
    vi.mocked(fakeLastfm.isConfigured).mockReturnValue(false);

    let resolveEnrich!: () => void;
    vi.mocked(fakeReccobeats.enrich).mockImplementation(
      () => new Promise((resolve) => (resolveEnrich = () => resolve(null))),
    );

    const first = runEnrichmentQueue();
    const second = runEnrichmentQueue();
    resolveEnrich();
    await Promise.all([first, second]);

    expect(fakeReccobeats.enrich).toHaveBeenCalledTimes(1);
  });
});
