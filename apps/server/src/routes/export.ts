import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  exportDatabaseSnapshot,
  importDatabaseSnapshot,
  type DatabaseSnapshot,
} from '../db/export.js';

const snapshotSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  settings: z.record(z.string(), z.string()),
});

/** Whole-DB JSON backup, separate from apply()'s automatic snapshots — plan.md Phase 5. */
export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/export', async (_req, reply) => {
    const snapshot = exportDatabaseSnapshot();
    reply.header(
      'Content-Disposition',
      `attachment; filename="listify-backup-${snapshot.exportedAt.slice(0, 10)}.json"`,
    );
    return snapshot;
  });

  app.post('/api/import', async (req, reply) => {
    const body = snapshotSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', details: body.error.issues });
    }
    try {
      importDatabaseSnapshot(body.data as DatabaseSnapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: 'import_failed', message });
    }
    return reply.code(204).send();
  });
}
