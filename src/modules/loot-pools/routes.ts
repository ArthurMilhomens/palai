import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/controller.js';
import { getLootPoolDetail } from './service.js';

const paramsSchema = z.object({
  poolId: z.string().min(1),
});

const querySchema = z.object({
  lang: z.string().optional(),
  gameVersion: z.string().optional(),
});

export async function lootPoolsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/:poolId', {
    schema: {
      tags: ['Loot pools'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['poolId'],
        properties: { poolId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          lang: { type: 'string' },
          gameVersion: { type: 'string' },
        },
      },
    },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const params = paramsSchema.parse(req.params);
      const query = querySchema.parse(req.query);
      const data = await getLootPoolDetail({
        poolId: decodeURIComponent(params.poolId),
        lang: query.lang,
        gameVersion: query.gameVersion,
        acceptLanguage: req.headers['accept-language'],
      });
      return reply.send({ data });
    },
  });
}
