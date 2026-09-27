import Fastify from 'fastify';
import { apiRoutes } from './routes/api.js';
import { authRoutes } from './routes/auth.js';

const PORT = 8787;
const HOST = '127.0.0.1';

const app = Fastify({ logger: true });

await app.register(apiRoutes);
await app.register(authRoutes);

app.listen({ port: PORT, host: HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
