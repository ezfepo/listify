import Fastify, { type FastifyInstance } from 'fastify';
import { registerRevisionHook, eventsRoutes } from './revision.js';
import { apiRoutes } from './routes/api.js';
import { authRoutes } from './routes/auth.js';
import { enrichRoutes } from './routes/enrich.js';
import { exportRoutes } from './routes/export.js';
import { libraryRoutes } from './routes/library.js';
import { recipeRoutes } from './routes/recipes.js';
import { setupRoutes } from './routes/setup.js';
import { syncRoutes } from './routes/sync.js';
import { trackRoutes } from './routes/tracks.js';
import { SyncBusyError } from './sync/lock.js';

/** Builds the API server with every route registered; does not start listening. */
export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  // forceCloseConnections: long-lived SSE streams (see revision.ts) must not block shutdown.
  const app = Fastify({ logger: options.logger ?? true, forceCloseConnections: true });

  registerRevisionHook(app);
  // A sync-level operation is already running (see sync/lock.ts): tell the caller, don't queue.
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof SyncBusyError) {
      return reply
        .code(409)
        .send({ error: 'sync_in_progress', message: err.message, operation: err.operation });
    }
    return reply.send(err);
  });

  await app.register(eventsRoutes);
  await app.register(apiRoutes);
  await app.register(authRoutes);
  await app.register(setupRoutes);
  await app.register(syncRoutes);
  await app.register(enrichRoutes);
  await app.register(libraryRoutes);
  await app.register(recipeRoutes);
  await app.register(trackRoutes);
  await app.register(exportRoutes);

  return app;
}
