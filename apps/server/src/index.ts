import Fastify from 'fastify';

const PORT = 8787;
const HOST = '127.0.0.1';

const app = Fastify({ logger: true });

app.get('/api/health', async () => {
  return { status: 'ok' };
});

app.listen({ port: PORT, host: HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
