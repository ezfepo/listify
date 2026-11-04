import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isEnrichmentRunning, triggerEnrichment } from '../enrich/queue.js';
import { enrichRoutes } from './enrich.js';
import { buildTestApp } from './test-app.js';

vi.mock('../enrich/queue.js', () => ({
  isEnrichmentRunning: vi.fn(),
  triggerEnrichment: vi.fn(),
}));
vi.mock('../db/enrichment.js', () => ({
  getEnrichmentCoverage: vi.fn(() => ({ total: 10, withFeatures: 4, withTags: 6 })),
}));

let app: FastifyInstance;

beforeEach(async () => {
  vi.mocked(isEnrichmentRunning).mockReset();
  vi.mocked(triggerEnrichment).mockReset();
  app = await buildTestApp(enrichRoutes);
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/enrich/status', () => {
  it('reports whether the queue is running together with coverage', async () => {
    vi.mocked(isEnrichmentRunning).mockReturnValue(true);

    const res = await app.inject('/api/enrich/status');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      running: true,
      coverage: { total: 10, withFeatures: 4, withTags: 6 },
    });
  });
});

describe('POST /api/enrich/run', () => {
  it('starts enrichment in the background and answers 202 immediately', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/enrich/run' });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'started' });
    expect(triggerEnrichment).toHaveBeenCalledTimes(1);
    expect(triggerEnrichment).toHaveBeenCalledWith(expect.any(Function));
  });
});
