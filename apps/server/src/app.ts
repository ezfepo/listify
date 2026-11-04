import Fastify, { type FastifyInstance } from 'fastify';
import { apiRoutes } from './routes/api.js';
import { authRoutes } from './routes/auth.js';
import { enrichRoutes } from './routes/enrich.js';
import { libraryRoutes } from './routes/library.js';
import { recipeRoutes } from './routes/recipes.js';
import { setupRoutes } from './routes/setup.js';
import { syncRoutes } from './routes/sync.js';
import { trackRoutes } from './routes/tracks.js';

/** Builds the API server with every route registered; does not start listening. */
export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true });

  await app.register(apiRoutes);
  await app.register(authRoutes);
  await app.register(setupRoutes);
  await app.register(syncRoutes);
  await app.register(enrichRoutes);
  await app.register(libraryRoutes);
  await app.register(recipeRoutes);
  await app.register(trackRoutes);

  return app;
}
