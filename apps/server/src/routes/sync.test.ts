import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerEnrichment } from '../enrich/queue.js';
import { SpotifyAuthError, SpotifyRateLimitError } from '../spotify/errors.js';
import { apply, ApplySetupError, previewDiff, type ApplySummary } from '../sync/apply.js';
import type { DiffResult } from '../sync/diff.js';
import { pull, PullSetupError, type PullSummary } from '../sync/pull.js';
import { syncRoutes } from './sync.js';
import { buildTestApp } from './test-app.js';

vi.mock('../enrich/queue.js', () => ({ triggerEnrichment: vi.fn() }));
vi.mock('../sync/pull.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/pull.js')>()),
  pull: vi.fn(),
}));
vi.mock('../sync/apply.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/apply.js')>()),
  previewDiff: vi.fn(),
  apply: vi.fn(),
}));

const pullMock = vi.mocked(pull);
const previewDiffMock = vi.mocked(previewDiff);
const applyMock = vi.mocked(apply);

let app: FastifyInstance;

beforeEach(async () => {
  pullMock.mockReset();
  previewDiffMock.mockReset();
  applyMock.mockReset();
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

describe('GET /api/sync/diff', () => {
  function get() {
    return app.inject({ method: 'GET', url: '/api/sync/diff' });
  }

  it('returns the diff preview', async () => {
    const preview: DiffResult = {
      operations: [{ kind: 'addToArchive', uris: ['spotify:track:1'] }],
      skippedLocalUris: [],
    };
    previewDiffMock.mockResolvedValue(preview);

    const res = await get();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(preview);
  });

  it('401s with the reason when Spotify auth is missing or expired', async () => {
    previewDiffMock.mockRejectedValue(new SpotifyAuthError('reconnect_required', 'expired'));
    const res = await get();
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'reconnect_required' });
  });

  it('409s with setup_required when Main/Archive are not configured', async () => {
    previewDiffMock.mockRejectedValue(new ApplySetupError('pick a Main playlist first'));
    const res = await get();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'setup_required', message: 'pick a Main playlist first' });
  });

  it('503s with rate_limited when Spotify throttles us', async () => {
    previewDiffMock.mockRejectedValue(new SpotifyRateLimitError('quota exceeded'));
    const res = await get();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'rate_limited', message: 'quota exceeded' });
  });

  it('lets unexpected errors become a 500', async () => {
    previewDiffMock.mockRejectedValue(new Error('boom'));
    const res = await get();
    expect(res.statusCode).toBe(500);
  });
});

describe('POST /api/sync/apply', () => {
  function post() {
    return app.inject({ method: 'POST', url: '/api/sync/apply' });
  }

  it('returns the apply summary', async () => {
    const summary: ApplySummary = {
      dryRun: true,
      batchId: 'batch-1',
      backupPath: '/data/backups/backup-1.json',
      operations: [],
      skippedLocalUris: [],
    };
    applyMock.mockResolvedValue(summary);

    const res = await post();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(summary);
  });

  it('401s with the reason when Spotify auth is missing or expired', async () => {
    applyMock.mockRejectedValue(new SpotifyAuthError('reconnect_required', 'expired'));
    const res = await post();
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'reconnect_required' });
  });

  it('409s with setup_required when Main/Archive are not configured', async () => {
    applyMock.mockRejectedValue(new ApplySetupError('pick a Main playlist first'));
    const res = await post();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'setup_required', message: 'pick a Main playlist first' });
  });

  it('503s with rate_limited when Spotify throttles us', async () => {
    applyMock.mockRejectedValue(new SpotifyRateLimitError('quota exceeded'));
    const res = await post();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'rate_limited', message: 'quota exceeded' });
  });

  it('lets unexpected errors become a 500', async () => {
    applyMock.mockRejectedValue(new Error('boom'));
    const res = await post();
    expect(res.statusCode).toBe(500);
  });
});
