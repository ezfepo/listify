import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { currentRevision, resetRevision } from './revision.js';

let app: FastifyInstance;

beforeEach(async () => {
  resetRevision();
  app = await buildApp({ logger: false });
});

afterEach(async () => {
  await app.close();
});

const setup = { mainSpotifyId: 'a', archiveSpotifyId: 'b', adopt: [] };

describe('revision counter', () => {
  it('starts at 0 and is readable', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/revision' });
    expect(res.json()).toEqual({ revision: 0 });
  });

  it('a successful change bumps it and returns it in a header', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/setup', payload: setup });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-listify-revision']).toBe('1');
    expect(currentRevision()).toBe(1);

    const again = await app.inject({ method: 'POST', url: '/api/setup', payload: setup });
    expect(again.headers['x-listify-revision']).toBe('2');
  });

  it('reads and failed changes leave it alone', async () => {
    const read = await app.inject({ method: 'GET', url: '/api/library' });
    expect(read.headers['x-listify-revision']).toBeUndefined();

    const bad = await app.inject({ method: 'POST', url: '/api/setup', payload: {} });
    expect(bad.statusCode).toBe(400);
    expect(bad.headers['x-listify-revision']).toBeUndefined();
    expect(currentRevision()).toBe(0);
  });

  it('counts disconnecting Spotify as a change', async () => {
    await app.inject({ method: 'POST', url: '/auth/disconnect' });
    expect(currentRevision()).toBe(1);
  });
});

describe('GET /api/events', () => {
  it('streams the current revision, then every new one', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    const base = `http://127.0.0.1:${port}`;

    const controller = new AbortController();
    const res = await fetch(`${base}/api/events`, { signal: controller.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const readRevision = async () => {
      const { value } = await reader.read();
      const text = decoder.decode(value);
      return JSON.parse(text.replace(/^data: /, '').trim()).revision as number;
    };

    expect(await readRevision()).toBe(0);
    await fetch(`${base}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(setup),
    });
    expect(await readRevision()).toBe(1);

    controller.abort();
  });

  it('does not keep the server from shutting down while a client is still connected', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}/api/events`);
    await res.body!.getReader().read(); // connected, stream left open

    await expect(app.close()).resolves.toBeUndefined();
  });
});
