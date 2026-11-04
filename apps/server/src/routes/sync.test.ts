import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerEnrichment } from '../enrich/queue.js';
import { SpotifyAuthError, SpotifyRateLimitError } from '../spotify/errors.js';
import { pull, PullSetupError, type PullSummary } from '../sync/pull.js';
import { syncRoutes } from './sync.js';
import { buildTestApp } from './test-app.js';

vi.mock('../enrich/queue.js', () => ({ triggerEnrichment: vi.fn() }));
vi.mock('../sync/pull.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/pull.js')>()),
  pull: vi.fn(),
}));

const pullMock = vi.mocked(pull);

let app: FastifyInstance;

beforeEach(async () => {
  pullMock.mockReset();
  vi.mocked(triggerEnrichment).mockReset();
  app = await buildTestApp(syncRoutes);
});

afterEach(async () => {
  await app.close();
});

function post() {
  return app.inject({ method: 'POST', url: '/api/sync/pull' });
}

describe('POST /api/sync/pull', () => {
  it('returns the pull summary and kicks off enrichment in the background', async () => {
    const summary: PullSummary = {
      mainTrackCount: 3,
      archiveTrackCount: 1,
      subPlaylists: [{ name: 'Chill', trackCount: 2 }],
      skippedEpisodes: 0,
    };
    pullMock.mockResolvedValue(summary);

    const res = await post();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(summary);
    expect(triggerEnrichment).toHaveBeenCalledTimes(1);
  });

  it('401s with the reason when Spotify auth is missing or expired', async () => {
    pullMock.mockRejectedValue(new SpotifyAuthError('reconnect_required', 'expired'));

    const res = await post();
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'reconnect_required' });
    expect(triggerEnrichment).not.toHaveBeenCalled();
  });

  it('409s with setup_required when Main/Archive are not configured', async () => {
    pullMock.mockRejectedValue(new PullSetupError('pick a Main playlist first'));

    const res = await post();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'setup_required', message: 'pick a Main playlist first' });
  });

  it('503s with rate_limited when Spotify throttles us', async () => {
    pullMock.mockRejectedValue(new SpotifyRateLimitError('quota exceeded'));

    const res = await post();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'rate_limited', message: 'quota exceeded' });
  });

  it('lets unexpected errors become a 500', async () => {
    pullMock.mockRejectedValue(new Error('boom'));
    const res = await post();
    expect(res.statusCode).toBe(500);
  });
});
