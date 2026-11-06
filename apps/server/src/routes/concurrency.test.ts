import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { resetRevision } from '../revision.js';
import { apply, type ApplySummary } from '../sync/apply.js';
import { pull, PullBlockedError, type PullSummary } from '../sync/pull.js';

vi.mock('../enrich/queue.js', () => ({ triggerEnrichment: vi.fn() }));
vi.mock('../sync/pull.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/pull.js')>()),
  pull: vi.fn(),
}));
vi.mock('../sync/apply.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/apply.js')>()),
  apply: vi.fn(),
}));

const pullMock = vi.mocked(pull);
const applyMock = vi.mocked(apply);

const SUMMARY: ApplySummary = {
  dryRun: true,
  batchId: 'b',
  backupPath: 'x',
  operations: [],
  skippedLocalUris: [],
};
const PULL_SUMMARY: PullSummary = {
  mainTrackCount: 0,
  archiveTrackCount: 0,
  subPlaylists: [],
  skippedEpisodes: 0,
};

let app: FastifyInstance;

beforeEach(async () => {
  pullMock.mockReset();
  applyMock.mockReset();
  resetRevision();
  app = await buildApp({ logger: false });
});

afterEach(async () => {
  await app.close();
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const post = (url: string, payload?: object) => app.inject({ method: 'POST', url, payload });

describe('one sync-level operation at a time', () => {
  it('rejects a second apply while the first is running, then allows another afterwards', async () => {
    const gate = deferred<ApplySummary>();
    applyMock.mockReturnValueOnce(gate.promise);
    const first = post('/api/sync/apply');
    await vi.waitFor(() => expect(applyMock).toHaveBeenCalledTimes(1));

    const second = await post('/api/sync/apply');
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: 'sync_in_progress', operation: 'apply' });
    expect(applyMock).toHaveBeenCalledTimes(1); // the second one never ran

    gate.resolve(SUMMARY);
    expect((await first).statusCode).toBe(200);

    applyMock.mockResolvedValueOnce(SUMMARY);
    expect((await post('/api/sync/apply')).statusCode).toBe(200);
  });

  it('rejects pull, import and setup changes while an apply is running', async () => {
    const gate = deferred<ApplySummary>();
    applyMock.mockReturnValueOnce(gate.promise);
    const running = post('/api/sync/apply');
    await vi.waitFor(() => expect(applyMock).toHaveBeenCalled());

    const pulled = await post('/api/sync/pull');
    const imported = await post('/api/import', {
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      tables: {},
      settings: {},
    });
    const setup = await post('/api/setup', {
      mainSpotifyId: 'a',
      archiveSpotifyId: 'b',
      adopt: [],
    });

    for (const res of [pulled, imported, setup]) {
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'sync_in_progress', operation: 'apply' });
    }
    expect(pullMock).not.toHaveBeenCalled();

    gate.resolve(SUMMARY);
    await running;
  });

  it('releases the lock when the operation fails', async () => {
    applyMock.mockRejectedValueOnce(new Error('boom'));
    expect((await post('/api/sync/apply')).statusCode).toBe(500);

    applyMock.mockResolvedValueOnce(SUMMARY);
    expect((await post('/api/sync/apply')).statusCode).toBe(200);
  });

  it('still lets ordinary edits through while a sync operation is running', async () => {
    const gate = deferred<ApplySummary>();
    applyMock.mockReturnValueOnce(gate.promise);
    const running = post('/api/sync/apply');
    await vi.waitFor(() => expect(applyMock).toHaveBeenCalled());

    const library = await app.inject({ method: 'GET', url: '/api/library' });
    expect(library.statusCode).toBe(200);

    gate.resolve(SUMMARY);
    await running;
  });
});

describe('pull with unapplied local assignments', () => {
  it('409s with pending_local_changes and the per-playlist counts', async () => {
    pullMock.mockRejectedValue(new PullBlockedError([{ playlistId: 3, name: 'Road', count: 2 }]));

    const res = await post('/api/sync/pull');

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: 'pending_local_changes',
      pending: [{ playlistId: 3, name: 'Road', count: 2 }],
    });
  });

  it('only discards local changes when ?force=true is passed', async () => {
    pullMock.mockResolvedValue(PULL_SUMMARY);

    await post('/api/sync/pull');
    expect(pullMock).toHaveBeenLastCalledWith({ discardLocalChanges: false });

    await post('/api/sync/pull?force=true');
    expect(pullMock).toHaveBeenLastCalledWith({ discardLocalChanges: true });
  });
});
