import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';

/** Builds a Fastify instance with a single route plugin registered, for `app.inject()` tests. */
export async function buildTestApp(plugin: FastifyPluginAsync): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(plugin);
  await app.ready();
  return app;
}
