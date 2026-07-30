import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../prisma/client.js';
import { createEntityModule } from '../../shared/entity-module.js';
import { authenticate } from '../auth/controller.js';
import { listQuerySchema } from '../../shared/query.js';

const base = createEntityModule({
  name: 'Item',
  tag: 'Items',
  prefix: 'items',
  getDelegate: () => prisma.item as never,
  defaultSort: 'name',
  allowedSorts: ['name', 'rarity', 'price', 'weight', 'createdAt'],
});

export async function itemsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/', {
    schema: { tags: ['Items'], security: [{ bearerAuth: [] }] },
    handler: async (req, reply) => {
      const query = listQuerySchema.parse(req.query);
      return reply.send(await base.listCached(query));
    },
  });

  app.get('/:idOrSlug', {
    schema: { tags: ['Items'], security: [{ bearerAuth: [] }] },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const params = req.params as { idOrSlug: string };
      const query = listQuerySchema.pick({ gameVersion: true }).parse(req.query);
      const data = await base.getByIdOrSlug(params.idOrSlug, query.gameVersion);
      return reply.send({ data });
    },
  });

  app.get('/:idOrSlug/recipes', {
    schema: { tags: ['Items'], security: [{ bearerAuth: [] }] },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const params = req.params as { idOrSlug: string };
      const query = listQuerySchema.pick({ gameVersion: true }).parse(req.query);
      const item = (await base.getByIdOrSlug(
        params.idOrSlug,
        query.gameVersion,
      )) as { id: string };
      const data = await prisma.recipe.findMany({
        where: {
          OR: [
            { resultItemId: item.id },
            { ingredients: { some: { itemId: item.id } } },
          ],
        },
        include: {
          resultItem: true,
          ingredients: { include: { item: true } },
        },
      });
      return reply.send({ data });
    },
  });
}
