import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/controller.js';
import { searchDocuments } from '../../indexers/opensearch.js';
import { paginationQuerySchema } from '../../shared/pagination.js';

const searchQuerySchema = paginationQuerySchema.extend({
  q: z.string().default(''),
  category: z.string().optional(),
  type: z.string().optional(),
  element: z.string().optional(),
  rarity: z.coerce.number().int().optional(),
  level: z.coerce.number().int().optional(),
  biome: z.string().optional(),
  work: z.string().optional(),
});

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/', {
    schema: {
      tags: ['Search'],
      summary: 'Full-text search across indexed entities',
      security: [{ bearerAuth: [] }],
    },
    handler: async (req, reply) => {
      const query = searchQuerySchema.parse(req.query);
      const result = await searchDocuments({
        q: query.q,
        category: query.category,
        type: query.type,
        element: query.element,
        rarity: query.rarity,
        level: query.level,
        biome: query.biome,
        work: query.work,
        from: (query.page - 1) * query.limit,
        size: query.limit,
      });
      return reply.send(result);
    },
  });
}
