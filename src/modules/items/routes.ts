import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../prisma/client.js';
import { createEntityModule } from '../../shared/entity-module.js';
import { authenticate } from '../auth/controller.js';
import { listQuerySchema } from '../../shared/query.js';
import { resolveLocale, pickTranslation } from '../../shared/i18n.js';
import { resolveActiveGameVersionId } from '../../shared/version.js';
import { craftTreeQuerySchema, getItemCraftTree } from './service.js';

const base = createEntityModule({
  name: 'Item',
  tag: 'Items',
  prefix: 'items',
  getDelegate: () => prisma.item as never,
  defaultSort: 'name',
  allowedSorts: ['name', 'rarity', 'price', 'weight', 'createdAt'],
});

async function withItemNames<T extends { id: string; name: string }>(
  items: T[],
  gameVersionId: string,
  locale: string,
): Promise<Array<T & { names: { en: string; 'pt-BR': string } }>> {
  if (items.length === 0) return [];
  const ids = items.map((i) => i.id);
  const translations = await prisma.translation.findMany({
    where: {
      gameVersionId,
      entityType: 'item',
      field: 'name',
      entityId: { in: ids },
    },
    select: { entityId: true, locale: true, field: true, value: true },
  });

  return items.map((item) => {
    const forItem = translations
      .filter((t) => t.entityId === item.id)
      .map((t) => ({ locale: t.locale, field: t.field, value: t.value }));
    const names = {
      en: pickTranslation(forItem, 'name', 'en', item.name) ?? item.name,
      'pt-BR':
        pickTranslation(forItem, 'name', 'pt-BR', item.name) ?? item.name,
    };
    return {
      ...item,
      name: pickTranslation(forItem, 'name', locale, item.name) ?? item.name,
      names,
    };
  });
}

export async function itemsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/', {
    schema: { tags: ['Items'], security: [{ bearerAuth: [] }] },
    handler: async (req, reply) => {
      const query = listQuerySchema.parse(req.query);
      const locale = resolveLocale(req, query.lang);
      const result = await base.listCached(query);
      const gameVersionId = await resolveActiveGameVersionId(query.gameVersion);
      const data = await withItemNames(
        result.data as Array<{ id: string; name: string }>,
        gameVersionId,
        locale,
      );
      return reply.send({ ...result, data });
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
        lang: query.lang,
        gameVersion: query.gameVersion,
        acceptLanguage: req.headers['accept-language'],
      });
      return reply.send({ data });
    },
  });

  app.get('/:idOrSlug', {
    schema: { tags: ['Items'], security: [{ bearerAuth: [] }] },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const params = req.params as { idOrSlug: string };
      const query = listQuerySchema
        .pick({ gameVersion: true, lang: true })
        .parse(req.query);
      const locale = resolveLocale(req, query.lang);
      const raw = (await base.getByIdOrSlug(
        params.idOrSlug,
        query.gameVersion,
      )) as { id: string; name: string };
      const gameVersionId = await resolveActiveGameVersionId(query.gameVersion);
      const [data] = await withItemNames([raw], gameVersionId, locale);
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
        lang: query.lang,
        gameVersion: query.gameVersion,
        acceptLanguage: req.headers['accept-language'],
      });
      return reply.send({ data });
    },
  });
}
