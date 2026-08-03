import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../prisma/client.js';
import { createEntityModule } from '../../shared/entity-module.js';
import { authenticate } from '../auth/controller.js';
import { listQuerySchema } from '../../shared/query.js';
import {
  craftTreeQuerySchema,
  getItemCraftTree,
  getItemDetail,
  listItems,
} from './service.js';

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
    schema: {
      tags: ['Items'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          sort: { type: 'string' },
          order: { type: 'string', enum: ['asc', 'desc'] },
          rarity: { type: 'integer' },
          lang: { type: 'string' },
          gameVersion: { type: 'string' },
        },
      },
    },
    handler: async (req, reply) => {
      const query = listQuerySchema.parse(req.query);
      const result = await listItems({
        q: query.q ?? query.name,
        page: query.page,
        limit: query.limit,
        sort: query.sort,
        order: query.order,
        rarity: query.rarity,
        lang: query.lang,
        gameVersion: query.gameVersion,
        acceptLanguage: req.headers['accept-language'],
      });
      return reply.send(result);
    },
  });

  /**
   * Nested bill-of-materials for crafting an item.
   * Lookup is case-insensitive by id, internalName, name, or EN/PT translation.
   *
   * Example: GET /v1/items/craft-tree?q=computador&quantity=5&lang=pt-BR
   */
  app.get('/craft-tree', {
    schema: {
      tags: ['Items'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string' },
          quantity: { type: 'integer', minimum: 1, default: 1 },
          rarity: { type: 'integer', minimum: 0, maximum: 4 },
          lang: { type: 'string' },
          gameVersion: { type: 'string' },
        },
      },
    },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const query = craftTreeQuerySchema.parse(req.query);
      const data = await getItemCraftTree({
        q: query.q,
        quantity: query.quantity,
        rarity: query.rarity,
        lang: query.lang,
        gameVersion: query.gameVersion,
        acceptLanguage: req.headers['accept-language'],
      });
      return reply.send({ data });
    },
  });

  app.get('/:idOrSlug', {
    schema: {
      tags: ['Items'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          rarity: { type: 'integer', minimum: 0, maximum: 4 },
          lang: { type: 'string' },
          gameVersion: { type: 'string' },
        },
      },
    },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const params = req.params as { idOrSlug: string };
      const query = listQuerySchema
        .pick({ gameVersion: true, lang: true })
        .extend({
          rarity: z.coerce.number().int().min(0).max(4).optional(),
        })
        .parse(req.query);
      const data = await getItemDetail({
        idOrSlug: params.idOrSlug,
        rarity: query.rarity,
        lang: query.lang,
        gameVersion: query.gameVersion,
        acceptLanguage: req.headers['accept-language'],
      });
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

  app.get('/:idOrSlug/craft-tree', {
    schema: {
      tags: ['Items'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          quantity: { type: 'integer', minimum: 1, default: 1 },
          rarity: { type: 'integer', minimum: 0, maximum: 4 },
          lang: { type: 'string' },
          gameVersion: { type: 'string' },
        },
      },
    },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const params = req.params as { idOrSlug: string };
      const query = craftTreeQuerySchema.omit({ q: true }).parse(req.query);
      const data = await getItemCraftTree({
        q: params.idOrSlug,
        quantity: query.quantity,
        rarity: query.rarity,
        lang: query.lang,
        gameVersion: query.gameVersion,
        acceptLanguage: req.headers['accept-language'],
      });
      return reply.send({ data });
    },
  });
}
