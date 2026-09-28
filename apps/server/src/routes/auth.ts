import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import {
  beginAuthorization,
  clearTokens,
  exchangeCodeForToken,
  storeTokens,
  takePendingAuth,
} from '../spotify/auth.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/auth/login', async (_req, reply) => {
    let authorizeUrl: string;
    try {
      authorizeUrl = beginAuthorization();
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: 'spotify_not_configured' });
    }
    return reply.redirect(authorizeUrl);
  });

  app.get('/auth/callback', async (req, reply) => {
    const query = req.query as { code?: string; state?: string; error?: string };

    if (query.error) {
      return reply.redirect(`${config.webOrigin}/?auth_error=${encodeURIComponent(query.error)}`);
    }

    const codeVerifier = takePendingAuth(query.state);
    if (!codeVerifier || !query.code) {
      return reply.redirect(`${config.webOrigin}/?auth_error=invalid_state`);
    }

    try {
      const tokens = await exchangeCodeForToken(query.code, codeVerifier);
      storeTokens(tokens);
    } catch (err) {
      app.log.error(err);
      return reply.redirect(`${config.webOrigin}/?auth_error=token_exchange_failed`);
    }

    return reply.redirect(config.webOrigin);
  });

  app.post('/auth/disconnect', async (_req, reply) => {
    clearTokens();
    return reply.code(204).send();
  });
}
