import Fastify from 'fastify';
import { apiRoutes } from './routes/api.js';
import { authRoutes } from './routes/auth.js';
import { enrichRoutes } from './routes/enrich.js';
import { libraryRoutes } from './routes/library.js';
import { recipeRoutes } from './routes/recipes.js';
import { setupRoutes } from './routes/setup.js';
import { syncRoutes } from './routes/sync.js';
import { trackRoutes } from './routes/tracks.js';

const PORT = 8787;
const HOST = '127.0.0.1';

const app = Fastify({ logger: true });

await app.register(apiRoutes);
await app.register(authRoutes);
await app.register(setupRoutes);
await app.register(syncRoutes);
await app.register(enrichRoutes);
await app.register(libraryRoutes);
await app.register(recipeRoutes);
await app.register(trackRoutes);

app.listen({ port: PORT, host: HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
