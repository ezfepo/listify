import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

describe('buildApp', () => {
  it('registers every route group without starting a listener', async () => {
    app = await buildApp({ logger: false });
    await app.ready();

    expect(app.server.listening).toBe(false);

    const expected: [Method, string][] = [
      ['GET', '/api/health'],
      ['GET', '/api/me'],
      ['GET', '/auth/login'],
      ['GET', '/auth/callback'],
      ['POST', '/auth/disconnect'],
      ['GET', '/api/playlists'],
      ['GET', '/api/setup'],
      ['POST', '/api/setup'],
      ['POST', '/api/sync/pull'],
      ['GET', '/api/enrich/status'],
      ['POST', '/api/enrich/run'],
      ['GET', '/api/library'],
      ['POST', '/api/playlists'],
      ['PATCH', '/api/playlists/:id'],
      ['DELETE', '/api/playlists/:id'],
      ['GET', '/api/playlists/:id/suggestions'],
      ['GET', '/api/playlists/:id/recipe'],
      ['PUT', '/api/playlists/:id/recipe'],
      ['GET', '/api/tracks'],
      ['POST', '/api/tracks/bulk/assign'],
      ['POST', '/api/tracks/bulk/unassign'],
      ['POST', '/api/tracks/:uri/play'],
    ];
    for (const [method, url] of expected) {
      expect(app.hasRoute({ method, url }), `${method} ${url}`).toBe(true);
    }
  });

  it('serves requests through the assembled app', async () => {
    app = await buildApp({ logger: false });

    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });

    expect((await app.inject('/api/library')).statusCode).toBe(200);
    expect((await app.inject('/no/such/route')).statusCode).toBe(404);
  });

  it('has no route conflict between /api/tracks/bulk/* and /api/tracks/:uri/*', async () => {
    app = await buildApp({ logger: false });

    const res = await app.inject({
      method: 'POST',
      url: '/api/tracks/bulk/assign',
      payload: { uris: [], playlistId: 1 },
    });
    // 400 from the bulk route's own validation, not a 404 from /:uri/assign swallowing it.
    expect(res.statusCode).toBe(400);
  });
});
