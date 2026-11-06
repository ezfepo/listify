import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';

/**
 * A counter bumped by every request that changes data, plus a Server-Sent Events stream
 * of it. Every browser/tab on this machine sees the same server, so this is how a client
 * learns that someone else changed something (and refreshes, instead of acting on stale data).
 */
let revision = 0;
const subscribers = new Set<(revision: number) => void>();
const openStreams = new Set<ServerResponse>();

export function currentRevision(): number {
  return revision;
}

export function bumpRevision(): number {
  revision += 1;
  for (const notify of subscribers) notify(revision);
  return revision;
}

/** Test helper. */
export function resetRevision(): void {
  revision = 0;
  subscribers.clear();
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const REVISION_HEADER = 'x-listify-revision';
const HEARTBEAT_MS = 25_000;

function changesData(method: string, url: string): boolean {
  if (!MUTATING.has(method)) return false;
  const path = url.split('?')[0] ?? url;
  return path.startsWith('/api/') || path === '/auth/disconnect';
}

/**
 * Registered on the root instance (before the route plugins) so the hook covers every route.
 * A successful mutating response bumps the revision and carries it back in a header, which
 * lets the client tell its own changes from other clients' changes.
 */
export function registerRevisionHook(app: FastifyInstance): void {
  app.addHook('onSend', async (req, reply, payload) => {
    if (changesData(req.method, req.url) && reply.statusCode < 400) {
      reply.header(REVISION_HEADER, String(bumpRevision()));
    }
    return payload;
  });
}

export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  // Hijacked streams never end by themselves; without this, app.close() waits on them forever.
  app.addHook('onClose', async () => {
    for (const res of openStreams) res.end();
    openStreams.clear();
  });

  app.get('/api/revision', async () => ({ revision }));

  app.get('/api/events', (_req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (rev: number) => {
      if (!res.destroyed) res.write(`data: ${JSON.stringify({ revision: rev })}\n\n`);
    };
    send(revision);
    subscribers.add(send);
    openStreams.add(res);
    const heartbeat = setInterval(() => {
      if (!res.destroyed) res.write(': keep-alive\n\n');
    }, HEARTBEAT_MS);
    heartbeat.unref();

    res.on('close', () => {
      clearInterval(heartbeat);
      subscribers.delete(send);
      openStreams.delete(res);
    });
  });
}
