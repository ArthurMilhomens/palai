import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/controller.js';
import { breedingService } from './service.js';

const predictQuerySchema = z.object({
  parentA: z.string().min(1),
  parentB: z.string().min(1),
  gameVersion: z.string().optional(),
});

export async function breedingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/predict', {
    schema: {
      tags: ['Breeding'],
      summary: 'Predict offspring from two parents',
      security: [{ bearerAuth: [] }],
    },
    handler: async (req, reply) => {
      const query = predictQuerySchema.parse(req.query);
      const data = await breedingService.predict(
        query.parentA,
        query.parentB,
        query.gameVersion,
      );
      return reply.send({ data });
    },
  });

  app.get('/parents/:palId', {
    schema: {
      tags: ['Breeding'],
      summary: 'List possible parents for a child Pal',
      security: [{ bearerAuth: [] }],
    },
    handler: async (req, reply) => {
      const params = req.params as { palId: string };
      const query = z
        .object({ gameVersion: z.string().optional() })
        .parse(req.query);
      const data = await breedingService.parentsFor(params.palId, query.gameVersion);
      return reply.send({ data });
    },
  });
}
